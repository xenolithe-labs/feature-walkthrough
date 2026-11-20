import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createFolder,
  formatProblem,
  loadConfig,
  shapeOf,
  type ElementsState,
  type ResolvedWalkthrough,
} from '../../src/core';
import { Recorder, stripHooks } from '../../src/recorder';
import { createRegistry } from '../../src/registry';
import {
  KEYS,
  SOURCE as BST_SOURCE,
  START as BST_START,
  bstRun,
  plainTree,
  shapeOf as treeShape,
  type Shape,
  type TreeNode,
} from '../../src/walkthroughs/algorithms/bst-insert';
import {
  PUTS,
  SIZE,
  SOURCE as HASH_SOURCE,
  START as HASH_START,
  chains,
  hashRun,
  plainPut,
  type Entry,
} from '../../src/walkthroughs/algorithms/hash-table';
import {
  SOURCE as LIST_SOURCE,
  VALUES,
  plainList,
  reverseRun,
  type ListNode,
} from '../../src/walkthroughs/algorithms/reverse-list';

function shownFrom(file: string): string {
  const text = readFileSync(`src/walkthroughs/algorithms/${file}`, 'utf8');
  const region = /\/\/#region algorithm\n([\s\S]*?)\n\/\/#endregion/.exec(text);
  if (region === null) throw new Error(`${file} has no algorithm region`);
  return stripHooks(region[1]!);
}

function runShown<T extends (...args: never[]) => unknown>(source: string, name: string): T {
  return new Function(`${source}\nreturn ${name};`)() as T;
}

function load(config: unknown): ResolvedWalkthrough {
  const result = loadConfig(config, createRegistry());
  expect(result.problems.map(formatProblem)).toEqual([]);
  return result.walkthroughs[0]!;
}

function finalStates(walkthrough: ResolvedWalkthrough, call?: [number, number]) {
  const shape = shapeOf(walkthrough);
  const last = shape.length - 1;
  const [s, c] = call ?? [last, shape[last]! - 1];
  return createFolder(walkthrough).at(s, c);
}

interface Heap {
  /** The text in each slot, by `node.slot`. */
  values: Map<string, string>;
  /** What each pointer slot points at, by `node.slot`: a node id. */
  points: Map<string, string>;
  /** The nodes that are present. */
  nodes: Set<string>;
}

/** Reads a records pane back from the folded state alone: present edges and slot values. */
function heapOf(walkthrough: ResolvedWalkthrough, pane: string, call?: [number, number]): Heap {
  const found = walkthrough.panes.find((item) => item.id === pane)!;
  const content = found.content as {
    nodes: { id: string; slots?: { id: string; value?: string | number }[] }[];
    edges: { id?: string; from: string; to: string }[];
  };
  const state = finalStates(walkthrough, call)[pane]!.state as ElementsState;
  const present = new Set(state.present);
  const values = new Map<string, string>();
  for (const node of content.nodes) {
    for (const slot of node.slots ?? []) {
      const id = `${node.id}.${slot.id}`;
      const patch = state.patches[id]?.value;
      values.set(id, String(patch ?? slot.value ?? ''));
    }
  }
  const points = new Map<string, string>();
  for (const edge of content.edges) {
    const id = edge.id ?? `${edge.from}.${edge.to}`;
    if (!present.has(id)) continue;
    expect(points.has(edge.from), `${edge.from} points at two things at once`).toBe(false);
    points.set(edge.from, edge.to);
  }
  return {
    values,
    points,
    nodes: new Set(content.nodes.map((node) => node.id).filter((id) => present.has(id))),
  };
}

describe('the shown source is the code that ran', () => {
  it.each([
    ['reverse-list.algo.ts', LIST_SOURCE],
    ['bst-insert.algo.ts', BST_SOURCE],
    ['hash-table.algo.ts', HASH_SOURCE],
  ])('%s, without the recorder calls, is the text on the page', (file, source) => {
    expect(shownFrom(file)).toBe(source);
  });
});

describe('reversing a linked list in place', () => {
  const reverse = runShown<(head: ListNode | null) => ListNode | null>(LIST_SOURCE, 'reverse');
  const walk = (head: ListNode | null) => {
    const out: number[] = [];
    for (let node = head; node !== null; node = node.next) out.push(node.val);
    return out;
  };

  it('the shown text, run on its own, reverses the list', () => {
    expect(walk(reverse(plainList(VALUES)))).toEqual([...VALUES].reverse());
    expect(walk(reverseRun.result)).toEqual([...VALUES].reverse());
  });

  it('every next pointer in the final picture points backwards', () => {
    const walkthrough = load(reverseRun.config);
    const heap = heapOf(walkthrough, 'list');
    // Independent of the code: the list had n1 -> n2 -> n3 -> n4, so now each points at the one before.
    expect(heap.points.get('n1.next')).toBeUndefined();
    expect(heap.values.get('n1.next')).toBe('null');
    expect(heap.points.get('n2.next')).toBe('n1');
    expect(heap.points.get('n3.next')).toBe('n2');
    expect(heap.points.get('n4.next')).toBe('n3');
    // The new head is what prev points at, and curr has run off the end.
    expect(heap.points.get('vars.prev')).toBe('n4');
    expect(heap.points.get('vars.curr')).toBeUndefined();
    expect(heap.values.get('vars.curr')).toBe('null');
    // Following the pointers from the head gives the values backwards.
    const seen: string[] = [];
    for (
      let at = heap.points.get('vars.prev');
      at !== undefined;
      at = heap.points.get(`${at}.next`)
    ) {
      seen.push(heap.values.get(`${at}.val`)!);
    }
    expect(seen).toEqual([...VALUES].reverse().map(String));
  });

  it('moves one pointer per call: the old arrow goes and the new one comes, in the same call', () => {
    const turns = reverseRun.config.steps
      .flatMap((step) => step.calls)
      .filter((call) => call.label === 'Point the node backwards')
      .map((call) => (call.effects as Record<string, unknown[]>)['list']);
    expect(turns).toEqual([
      // The first node points at nothing: its slot says null and no arrow is added.
      [{ remove: 'n1.next.n2' }, { update: 'n1.next', fields: { value: 'null' } }],
      [
        { remove: 'n2.next.n3' },
        { update: 'n2.next', fields: { value: '' } },
        { add: 'n2.next.n1' },
      ],
      [
        { remove: 'n3.next.n4' },
        { update: 'n3.next', fields: { value: '' } },
        { add: 'n3.next.n2' },
      ],
      // The last node pointed at nothing, so there is no arrow to remove.
      [{ update: 'n4.next', fields: { value: '' } }, { add: 'n4.next.n3' }],
    ]);
  });
});

describe('inserting into a binary search tree', () => {
  const insert = runShown<(root: TreeNode | null, key: number) => TreeNode | null>(
    BST_SOURCE,
    'insert',
  );

  /** A different way to the same tree: rebuild from the sorted keys of the old tree plus the new. */
  function insertRecursive(shape: Shape | null | undefined, key: number): Shape {
    if (shape === null || shape === undefined) return [key, null, null];
    const [k, left, right] = shape;
    return key < k
      ? [k, insertRecursive(left, key), right ?? null]
      : [k, left ?? null, insertRecursive(right, key)];
  }
  const normal = (shape: Shape | null | undefined): Shape | null =>
    shape === null || shape === undefined ? null : [shape[0], normal(shape[1]), normal(shape[2])];

  const expected = KEYS.reduce<Shape>((tree, key) => insertRecursive(tree, key), BST_START);

  it('the shown text, run on its own, makes the same tree', () => {
    let root = plainTree(BST_START);
    for (const key of KEYS) root = insert(root, key);
    expect(treeShape(root)).toEqual(normal(expected));
    expect(treeShape(bstRun.result)).toEqual(normal(expected));
  });

  it('the final picture is that tree: keys, and which child each pointer reaches', () => {
    const walkthrough = load(bstRun.config);
    const heap = heapOf(walkthrough, 'tree');
    const build = (id: string | undefined): Shape | null => {
      if (id === undefined) return null;
      return [
        Number(heap.values.get(`${id}.key`)),
        build(heap.points.get(`${id}.left`)),
        build(heap.points.get(`${id}.right`)),
      ];
    };
    expect(build('n8')).toEqual(normal(expected));
    // An empty pointer says so in its slot; a pointer with an arrow has an empty slot.
    for (const [slot, value] of heap.values) {
      if (!/\.(left|right)$/.test(slot) || slot.startsWith('vars')) continue;
      expect(value === '∅').toBe(!heap.points.has(slot));
    }
  });

  it('is an ordered tree: every key is larger than the left subtree and smaller than the right', () => {
    const tree = treeShape(bstRun.result)!;
    const ordered = (shape: Shape | null, low: number, high: number): boolean =>
      shape === null ||
      (shape[0] > low &&
        shape[0] < high &&
        ordered(shape[1] ?? null, low, shape[0]) &&
        ordered(shape[2] ?? null, shape[0], high));
    expect(ordered(tree, -Infinity, Infinity)).toBe(true);
  });

  it('the insert changes exactly one existing pointer', () => {
    const walkthrough = load(bstRun.config);
    const before = heapOf(walkthrough, 'tree', [0, 0]);
    // Right after the first insert's last call, compared with the start: one tree pointer differs.
    const first = bstRun.config.steps[0]!.calls.length - 1;
    const after = heapOf(walkthrough, 'tree', [0, first]);
    const changed = [...after.points].filter(
      ([slot, target]) => !slot.startsWith('vars') && before.points.get(slot) !== target,
    );
    expect(changed).toEqual([['n6.left', 'n5']]);
  });
});

describe('a hash table with chaining', () => {
  /** The same table with arrays: a bucket is a list, a put appends. */
  function expectedChains(): [number, string][][] {
    const table = HASH_START.map((chain) => [...chain]);
    for (const [key, value] of PUTS) table[key % SIZE]!.push([key, value]);
    return table;
  }

  it('the shown text, run on its own, makes the same table', () => {
    const buckets: (Entry | null)[] = Array(SIZE).fill(null);
    HASH_START.forEach((chain, index) => {
      let head: Entry | null = null;
      for (const [key, value] of [...chain].reverse()) head = { key, value, next: head };
      buckets[index] = head;
    });
    for (const [key, value] of PUTS) plainPut(buckets, key, value);
    expect(chains(buckets)).toEqual(expectedChains());
    expect(chains(hashRun.buckets)).toEqual(expectedChains());
  });

  it('the final picture has every chain in order, with a null at the end of each', () => {
    const walkthrough = load(hashRun.config);
    const heap = heapOf(walkthrough, 'table');
    const table = Array.from({ length: SIZE }, (_, index) => {
      const chain: [number, string][] = [];
      for (
        let at = heap.points.get(`buckets.${index}`);
        at !== undefined;
        at = heap.points.get(`${at}.next`)
      ) {
        chain.push([Number(heap.values.get(`${at}.key`)), heap.values.get(`${at}.value`)!]);
        if (!heap.points.has(`${at}.next`)) expect(heap.values.get(`${at}.next`)).toBe('null');
      }
      return chain;
    });
    expect(table).toEqual(expectedChains());
    // Bucket 1 holds the collision: 5, then 9, then 13.
    expect(table[1]!.map(([key]) => key)).toEqual([5, 9, 13]);
    // Empty buckets say null.
    expect(heap.values.get('buckets.0')).toBe('null');
  });

  it('a collision walks the chain: tail moves along it before the new entry is chained on', () => {
    const labels = hashRun.config.steps[2]!.calls.map((call) => call.label);
    expect(labels).toContain('Step along the chain');
    expect(labels.at(-1)).toBe('Chain the entry on');
  });
});

describe('the recorder helpers', () => {
  const SOURCE = `function go(a) {
  a.next = null;
  return a;
}`;

  function recorder() {
    const rec = new Recorder({
      id: 'structures',
      title: 'Structures',
      source: { title: 'go.js', text: SOURCE },
    });
    const heap = rec.records('heap', { title: 'Heap' });
    return { rec, heap };
  }

  type Node = { v: number; next: Node | null };

  it('a node made before the first call is there from the start, one made later is added', () => {
    const { rec, heap } = recorder();
    const early = heap.node<Node>({ v: 1, next: null }, { id: 'early' });
    rec.at(2, 'a.next = null');
    const late = heap.node<Node>({ v: 2, next: null }, { id: 'late' });
    early.next = late;
    const config = rec.finish();
    const content = config.layout!.panes[1]!.content as {
      nodes: { id: string; initial: boolean }[];
      edges: { from: string; to: string; initial: boolean }[];
    };
    expect(content.nodes.map((node) => [node.id, node.initial])).toEqual([
      ['early', true],
      ['late', false],
    ]);
    expect(content.edges).toEqual([{ from: 'early.next', to: 'late', initial: false }]);
    const effects = (config.steps[0]!.calls[0]!.effects as Record<string, unknown[]>)['heap'];
    expect(effects).toEqual([
      { add: 'late' },
      { update: 'early.next', fields: { value: '' } },
      { add: 'early.next.late' },
    ]);
  });

  it('setting a pointer again removes the old arrow and adds the new one; every arrow is declared', () => {
    const { rec, heap } = recorder();
    const a = heap.node<Node>({ v: 1, next: null }, { id: 'a' });
    const b = heap.node<Node>({ v: 2, next: null }, { id: 'b' });
    const c = heap.node<Node>({ v: 3, next: null }, { id: 'c' });
    a.next = b;
    rec.at(2, 'a.next = null');
    a.next = c;
    const config = rec.finish();
    const content = config.layout!.panes[1]!.content as {
      edges: { from: string; to: string; initial: boolean }[];
    };
    // Setup: the arrow to b exists from the start. Then it goes and the one to c comes.
    expect(content.edges).toEqual([
      { from: 'a.next', to: 'b', initial: true },
      { from: 'a.next', to: 'c', initial: false },
    ]);
    const effects = (config.steps[0]!.calls[0]!.effects as Record<string, unknown[]>)['heap'];
    expect(effects).toEqual([
      { remove: 'a.next.b' },
      { update: 'a.next', fields: { value: '' } },
      { add: 'a.next.c' },
    ]);
    load(config);
  });

  it('a pointer set to null goes back to saying null, and a scalar write is one update', () => {
    const { rec, heap } = recorder();
    const a = heap.node<Node>({ v: 1, next: null }, { id: 'a' });
    const b = heap.node<Node>({ v: 2, next: null }, { id: 'b' });
    a.next = b;
    rec.at(2, 'a.next = null');
    a.next = null;
    a.v = 9;
    const config = rec.finish();
    const effects = (config.steps[0]!.calls[0]!.effects as Record<string, unknown[]>)['heap'];
    expect(effects).toEqual([
      { remove: 'a.next.b' },
      { update: 'a.next', fields: { value: 'null' } },
      { update: 'a.v', fields: { value: '9' } },
    ]);
  });

  it('reading a property records a read of its slot, and silently() records nothing', () => {
    const { rec, heap } = recorder();
    const a = heap.node<Node>({ v: 1, next: null }, { id: 'a' });
    rec.at(2, 'a.next = null');
    expect(a.v).toBe(1);
    rec.silently(() => a.next);
    const config = rec.finish();
    const effects = (config.steps[0]!.calls[0]!.effects as Record<string, unknown[]>)['heap'];
    expect(effects).toEqual([{ read: 'a.v' }]);
  });

  it('emits plain config: it loads and survives a JSON round trip with no recorder', () => {
    const { rec, heap } = recorder();
    const a = heap.node<Node>({ v: 1, next: null }, { id: 'a' });
    const b = heap.node<Node>({ v: 2, next: null }, { id: 'b' });
    rec.at(2, 'a.next = null');
    a.next = b;
    const config = rec.finish();
    const copy = JSON.parse(JSON.stringify(config)) as unknown;
    expect(copy).toEqual(config);
    load(copy);
  });

  it('refuses what it cannot show: an untracked pointer, tracking twice, a value that is not a value', () => {
    const { rec, heap } = recorder();
    const a = heap.node<Node>({ v: 1, next: null }, { id: 'a' });
    expect(() => heap.node(a)).toThrow(/already tracked/);
    expect(() => {
      a.next = { v: 2, next: null };
    }).toThrow(/not tracked/);
    expect(() => heap.node({ v: undefined as unknown as number })).toThrow(/slots hold/);
    expect(() => {
      (a as unknown as { v: unknown }).v = {};
    }).toThrow(/text or a number/);
    rec.at(2, 'a.next = null');
    rec.finish();
  });

  it('after finish() the objects are ordinary again: writes change nothing in the config', () => {
    const { rec, heap } = recorder();
    const a = heap.node<Node>({ v: 1, next: null }, { id: 'a' });
    const b = heap.node<Node>({ v: 2, next: null }, { id: 'b' });
    rec.at(2, 'a.next = null');
    const config = rec.finish();
    const before = JSON.stringify(config);
    a.next = b;
    a.v = 5;
    expect(a.v).toBe(5);
    expect(JSON.stringify(config)).toBe(before);
    expect(() => heap.node({ v: 1 })).toThrow(/finish/);
  });

  it('an array of pointers is one node with a slot per cell', () => {
    const { rec, heap } = recorder();
    const a = heap.node<Node>({ v: 1, next: null }, { id: 'a' });
    const cells = heap.slots<Node | null>('cells', [null, null]);
    rec.at(2, 'a.next = null');
    cells[1] = a;
    expect(cells[0]).toBeNull();
    const config = rec.finish();
    const effects = (config.steps[0]!.calls[0]!.effects as Record<string, unknown[]>)['heap'];
    expect(effects).toEqual([
      { update: 'cells.1', fields: { value: '' } },
      { add: 'cells.1.a' },
      { read: 'cells.0' },
    ]);
    const content = config.layout!.panes[1]!.content as { nodes: { id: string }[] };
    expect(content.nodes.map((node) => node.id)).toEqual(['a', 'cells']);
    load(config);
  });

  it('variables: pointers get arrows that are not links of the structure, text gets a value', () => {
    const { rec, heap } = recorder();
    const a = heap.node<Node>({ v: 1, next: null }, { id: 'a' });
    heap.vars('vars', { cur: null, side: '' });
    rec.at(2, 'a.next = null');
    rec.ref('cur', a);
    rec.ref('side', 'left');
    const config = rec.finish();
    const content = config.layout!.panes[1]!.content as {
      edges: { from: string; to: string; tree?: boolean }[];
    };
    expect(content.edges).toEqual([{ from: 'vars.cur', to: 'a', tree: false, initial: false }]);
    const effects = (config.steps[0]!.calls[0]!.effects as Record<string, unknown[]>)['heap'];
    expect(effects).toContainEqual({ update: 'vars.side', fields: { value: 'left' } });
    load(config);
  });
});
