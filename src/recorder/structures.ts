/**
 * Linked data structures for the recorder: objects that record their own pointer changes.
 *
 * `heap.node({ val: 3, next: null })` returns the same plain object with its properties turned
 * into accessors, so `node.next = other` in the algorithm is recorded as one slot changing its
 * value and one arrow moving, with no call from the author. A property that holds an object or
 * `null` is a pointer slot; any other property is a value slot. Reading a property records a read
 * of its slot. Objects keep their identity and shape, so the code that runs is the code that is
 * shown.
 *
 * The result is an ordinary `graph` pane: record nodes (`slots`) and edges that start at slots
 * (`from: "n1.next"`). Moving a pointer is a removed edge and an added one, and every edge that
 * ever existed is declared, so the JSON loads with no recorder. This file knows panel shapes by
 * their ids and fields only; it imports no panel and no React.
 */
import type { Recorder } from './recorder';

export type Pointee = object | null;
type Scalar = string | number;

export interface RecordsOptions {
  title?: string;
  /** `RIGHT` or `DOWN`. A tree reads best `DOWN`; a chain of nodes `RIGHT`. */
  direction?: 'RIGHT' | 'DOWN';
  /** `tree` places nodes as a tree, children in the order of the slots they hang from. */
  layout?: 'layered' | 'tree';
  role?: 'fixed' | 'focus';
  /** Prefix of the ids given to nodes that do not name one. Default `n`. */
  prefix?: string;
  /** What an empty pointer shows. Default `null`. */
  empty?: string;
  /** Show node labels as captions above the slots (default true). */
  head?: boolean;
  /** Show slot names beside their values (default true). */
  names?: boolean;
}

export interface NodeOptions {
  /** The node's id. Defaults to `<prefix><n>`. */
  id?: string;
  /** Shown on the card, and as the caption. Defaults to the id. */
  label?: string;
  arrange?: 'row' | 'column';
  head?: boolean;
  names?: boolean;
  /** Pin the node's place. Pin every node, or none. */
  x?: number;
  y?: number;
}

interface SlotRecord {
  id: string;
  pointer: boolean;
  /** The id of the node a pointer slot points at, or null. */
  target: string | null;
  /** What a value slot shows. */
  value: string;
}

interface NodeRecord {
  id: string;
  slots: Map<string, SlotRecord>;
}

interface EdgeDecl {
  id?: string;
  from: string;
  to: string;
  /** False for an arrow that is a reference (a variable), not a link of the structure. */
  tree?: boolean;
  initial: boolean;
}

interface NodeDecl {
  id: string;
  label: string;
  slots: { id: string; value: string; label?: string }[];
  arrange?: 'row' | 'column';
  head?: boolean;
  names?: boolean;
  x?: number;
  y?: number;
  initial: boolean;
}

const pick = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };

const INDEX = /^(0|[1-9]\d*)$/;
const isPointee = (value: unknown): value is Pointee =>
  value === null || (typeof value === 'object' && value !== null);
const isScalar = (value: unknown): value is Scalar =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

export class Records {
  private readonly ids = new WeakMap<object, string>();
  private readonly nodes = new Map<string, NodeRecord>();
  private readonly content: {
    initial: boolean;
    direction: 'RIGHT' | 'DOWN';
    layout?: 'layered' | 'tree';
    nodes: NodeDecl[];
    edges: EdgeDecl[];
  };
  private count = 0;

  constructor(
    private readonly rec: Recorder,
    readonly pane: string,
    private readonly options: RecordsOptions = {},
  ) {
    this.content = {
      initial: false,
      direction: options.direction ?? 'RIGHT',
      ...(options.layout === undefined ? {} : { layout: options.layout }),
      nodes: [],
      edges: [],
    };
    rec.pane(pane, 'graph', this.content, {
      title: options.title ?? pane,
      ...(options.role === undefined ? {} : { role: options.role }),
    });
  }

  // ---- Making things ----

  /**
   * Turns a plain object into a tracked node, in place, and returns it. Every own property
   * becomes a slot, in order. Do this on a line of its own right after the object is made; before
   * the first `at()` it is setup and the node is there from the start.
   */
  node<T extends object>(item: T, options: NodeOptions = {}): T {
    if (this.ids.has(item)) throw new Error('this object is already tracked');
    const id = options.id ?? this.freshId();
    this.claim(id);
    const record: NodeRecord = { id, slots: new Map() };
    if (this.rec.phase === 'done')
      throw new Error('finish() has been called: nothing more is recorded');
    const running = this.rec.phase === 'running';
    const slots: NodeDecl['slots'] = [];
    for (const [key, value] of Object.entries(item)) {
      if (!isPointee(value) && !isScalar(value)) {
        throw new TypeError(
          `"${key}" holds ${String(value)}: slots hold text, numbers or pointers`,
        );
      }
      const pointer = isPointee(value);
      const target = pointer ? this.idOf(value) : null;
      const shown = pointer ? (target === null ? this.empty : '') : String(value);
      record.slots.set(key, { id: key, pointer, target, value: shown });
      slots.push({ id: key, value: shown });
    }
    this.nodes.set(id, record);
    this.ids.set(item, id);
    const decl: NodeDecl = {
      id,
      label: options.label ?? id,
      slots,
      ...(options.arrange === undefined ? {} : { arrange: options.arrange }),
      ...pick('head', options.head ?? this.options.head),
      ...pick('names', options.names ?? this.options.names),
      ...(options.x === undefined ? {} : { x: options.x }),
      ...(options.y === undefined ? {} : { y: options.y }),
      initial: !running,
    };
    this.content.nodes.push(decl);
    if (running) this.rec.add(this.pane, id);
    for (const slot of record.slots.values()) {
      if (slot.target !== null) this.pointAt(record, slot, null, slot.target, running);
    }
    for (const key of record.slots.keys()) this.accessor(item, record, key);
    return item;
  }

  /**
   * A node whose slots are the cells of an array of pointers or values, such as the buckets of a
   * hash table. Returns a real array; `buckets[i] = entry` records the pointer move.
   */
  slots<T extends Pointee | Scalar>(id: string, cells: T[], options: NodeOptions = {}): T[] {
    const fields = Object.fromEntries(cells.map((cell, index) => [String(index), cell]));
    const holder = this.node(fields, { arrange: 'column', names: true, ...options, id });
    const record = this.nodes.get(id)!;
    return new Proxy(cells, {
      get: (target, prop, receiver) => {
        if (typeof prop === 'string' && INDEX.test(prop) && Number(prop) < target.length) {
          return (holder as Record<string, T>)[prop];
        }
        return Reflect.get(target, prop, receiver);
      },
      set: (target, prop, value) => {
        if (typeof prop === 'string' && INDEX.test(prop)) {
          if (!record.slots.has(prop))
            throw new RangeError(`slot ${prop} of "${id}" does not exist`);
          (holder as Record<string, T>)[prop] = value as T;
          return Reflect.set(target, prop, value);
        }
        return Reflect.set(target, prop, value);
      },
    });
  }

  /**
   * A node of variables. A variable that starts as `null` is a pointer slot, drawn with an arrow
   * to whatever it points at; one that starts as text or a number is a value slot. Set them with
   * `ref(name, value)`. Arrows from a variable are references, not links of the structure, so a
   * tree layout ignores them: except for the variables named in `links`, such as the `root` of a
   * tree, which hang the structure under the node of variables.
   */
  vars(
    id: string,
    initial: Record<string, Pointee | Scalar>,
    options: NodeOptions & { links?: readonly string[] } = {},
  ): void {
    const { links = [], ...node } = options;
    const holder = { ...initial };
    this.refs.set(id, this.node(holder, { arrange: 'row', label: id, ...node, id }));
    this.varNames.set(id, new Set(Object.keys(initial)));
    for (const name of links) this.linked.add(`${id}.${name}`);
  }

  private readonly linked = new Set<string>();

  /** Arrows from a variable are references, unless the variable was named in `links`. */
  private kind(node: NodeRecord, slot: SlotRecord): { tree?: false } {
    return this.varNames.has(node.id) && !this.linked.has(`${node.id}.${slot.id}`)
      ? { tree: false }
      : {};
  }

  private readonly refs = new Map<string, Record<string, Pointee | Scalar>>();
  private readonly varNames = new Map<string, Set<string>>();

  /** Sets the variable `name` of a `vars` node: to a tracked object or `null`, or to text. */
  ref(name: string, value: Pointee | Scalar): void {
    for (const [id, names] of this.varNames) {
      if (!names.has(name)) continue;
      this.refs.get(id)![name] = value;
      return;
    }
    throw new Error(`"${name}" is not a variable of any vars node`);
  }

  /** The id of a tracked object, or null for null. */
  idOf(item: Pointee): string | null {
    if (item === null) return null;
    const id = this.ids.get(item);
    if (id === undefined) throw new Error('this object is not tracked: pass it to node() first');
    return id;
  }

  // ---- Internals ----

  private get empty(): string {
    return this.options.empty ?? 'null';
  }

  private freshId(): string {
    const prefix = this.options.prefix ?? 'n';
    for (;;) {
      this.count += 1;
      const id = `${prefix}${this.count}`;
      if (!this.nodes.has(id)) return id;
    }
  }

  private claim(id: string): void {
    if (this.nodes.has(id)) throw new Error(`the node "${id}" is declared twice`);
  }

  private accessor(item: object, node: NodeRecord, key: string): void {
    const slot = node.slots.get(key)!;
    const element = `${node.id}.${key}`;
    let current: unknown = (item as Record<string, unknown>)[key];
    Object.defineProperty(item, key, {
      enumerable: true,
      configurable: true,
      get: () => {
        if (this.rec.phase === 'running') this.rec.read(this.pane, element);
        return current;
      },
      set: (value: unknown) => {
        if (this.rec.phase === 'done') {
          current = value;
          return;
        }
        if (slot.pointer) {
          if (!isPointee(value))
            throw new TypeError(`"${key}" is a pointer: set it to a node or null`);
          const to = this.idOf(value);
          const from = slot.target;
          current = value;
          if (to === from) {
            if (this.rec.phase === 'running') this.rec.read(this.pane, element);
            return;
          }
          this.pointAt(node, slot, from, to, this.rec.phase === 'running');
        } else {
          if (!isScalar(value)) throw new TypeError(`"${key}" holds text or a number`);
          current = value;
          if (this.rec.phase === 'running' && slot.value === String(value)) {
            this.rec.read(this.pane, element);
            return;
          }
          this.setValue(node, slot, String(value));
        }
      },
    });
  }

  private setValue(node: NodeRecord, slot: SlotRecord, value: string): void {
    slot.value = value;
    if (this.rec.phase === 'running') {
      this.rec.update(this.pane, `${node.id}.${slot.id}`, { value });
    } else {
      this.declared(node.id).slots.find((item) => item.id === slot.id)!.value = value;
    }
  }

  private declared(id: string): NodeDecl {
    return this.content.nodes.find((node) => node.id === id)!;
  }

  /** Moves a pointer slot from one target to another: its arrow, and what the slot shows. */
  private pointAt(
    node: NodeRecord,
    slot: SlotRecord,
    from: string | null,
    to: string | null,
    running: boolean,
  ): void {
    const element = `${node.id}.${slot.id}`;
    slot.target = to;
    const shown = to === null ? this.empty : '';
    slot.value = shown;
    if (!running) {
      // Setup: the slot starts out this way, so an arrow that never showed is not declared.
      this.declared(node.id).slots.find((item) => item.id === slot.id)!.value = shown;
      if (from !== null) {
        const gone = this.content.edges.findIndex(
          (edge) => edge.from === element && edge.to === from,
        );
        if (gone >= 0) this.content.edges.splice(gone, 1);
      }
      if (to !== null)
        this.content.edges.push({ from: element, to, ...this.kind(node, slot), initial: true });
      return;
    }
    if (from !== null) this.rec.remove(this.pane, `${element}.${from}`);
    // The slot changed even when the text in it did not: it points somewhere else now.
    this.rec.update(this.pane, element, { value: shown });
    if (to !== null) {
      const id = `${element}.${to}`;
      if (!this.content.edges.some((edge) => edge.from === element && edge.to === to)) {
        this.content.edges.push({ from: element, to, ...this.kind(node, slot), initial: false });
      }
      this.rec.add(this.pane, id);
    }
  }
}
