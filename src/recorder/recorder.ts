/**
 * The recorder: run a real algorithm, get the walkthrough config.
 *
 * The author runs the algorithm with a `Recorder` in reach. The arrays the algorithm works on
 * are tracked, so reading `items[mid]` is recorded as a compare and writing `items[i] = x` as a
 * write without any extra call. The author adds only what cannot be seen from outside: which
 * line is running (`at`), where a pointer is (`point`), when a call starts and ends (`enter`,
 * `leave`) and where a step begins (`step`). `finish()` returns the ordinary config; the JSON
 * does not need a recorder to load.
 *
 * This file knows panel shapes by their ids and fields only. It imports no panel, and no React.
 */
import type { Effect, WalkthroughInput } from '../core';
import { checkLines, type Lines } from './source';
import { Records, type NodeOptions, type Pointee, type RecordsOptions } from './structures';

export type Scalar = string | number;
type Cell = Scalar | null | undefined;
type Tone = 'warn' | 'good' | 'muted' | 'none';
type Fields = Record<string, unknown>;

export interface RecorderOptions {
  id: string;
  title: string;
  lead?: string;
  tags?: string[];
  /** The text the reader sees. Line numbers given to `at` are checked against it. */
  source: { id?: string; title: string; lang?: string; text: string };
  /**
   * How calls are grouped into steps. `manual`: a step starts where the author calls `step()`.
   * `frames`: also a step per function call and one when control comes back to the caller.
   */
  steps?: 'manual' | 'frames';
}

interface ViewOptions {
  title?: string;
  /** `focus` panes share one slot; see the pane's `role` in the config. */
  role?: 'fixed' | 'focus';
}

export interface PointerOption {
  id: string;
  /** Under the cells (default) or over them. */
  side?: 'above' | 'below';
  label?: string;
}

export interface RangeOption {
  id: string;
  /** An index, or the name of a pointer to follow. Leave both out for a range set by `range()`. */
  from?: number | string;
  to?: number | string;
  label?: string;
  /** Dim the cells outside the range. */
  dim?: boolean;
  tone?: Tone;
}

export interface ArrayOptions extends ViewOptions {
  /** Put this array in the pane of that name, under the arrays already there, instead of its own. */
  pane?: string;
  pointers?: (string | PointerOption)[];
  ranges?: RangeOption[];
}

export interface AtOptions {
  /** The card title. Defaults to the snippet. */
  label?: string;
  /**
   * The card text: why this happens, what to notice. A function is run once the call is open, so
   * that describing a cell does not record a read, in this call or the one before.
   */
  text?: string | (() => string);
  /** Mark only the snippet inside the line, or the given piece of it, instead of the whole line. */
  expr?: boolean | string;
  /** Show the line as changed (purple) instead of read (teal). */
  changes?: boolean;
}

interface CallRecord {
  id: string;
  label: string;
  text?: string;
  where?: string;
  effects: Record<string, Effect[]>;
}

interface StepRecord {
  id: string;
  title: string;
  text?: string;
  calls: CallRecord[];
}

const INDEX = /^(0|[1-9]\d*)$/;
const isScalar = (value: unknown): value is Scalar =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
const show = (value: Cell): string => (value === null || value === undefined ? '' : String(value));

interface ArrayState {
  kind: 'array';
  id: string;
  /** The pane it is drawn in: its own id unless `options.pane` shares one. */
  pane: string;
  options: ArrayOptions;
  data: Scalar[];
  proxy: Scalar[];
  initial: Scalar[] | undefined;
  present: Set<number>;
  longest: number;
  pointers: Map<
    string,
    { side: 'above' | 'below'; label?: string; at: number | null; shown: boolean }
  >;
  ranges: Map<string, RangeOption & { shown: boolean }>;
}
interface VarsState {
  kind: 'vars';
  id: string;
  options: ViewOptions;
  initial: Record<string, Scalar>;
  now: Map<string, string>;
}
interface StackState {
  kind: 'stack';
  id: string;
  options: ViewOptions & { direction?: 'row' | 'column' };
  deepest: number;
  shown: Set<number>;
}
interface GridState {
  kind: 'grid';
  id: string;
  options: ViewOptions;
  rows: string[];
  columns: string[];
  corner: string;
  data: Cell[][];
  initial: Cell[][] | undefined;
}
interface PaneState {
  kind: 'pane';
  id: string;
  panel: string;
  content: unknown;
  options: ViewOptions;
}
type View = ArrayState | VarsState | StackState | GridState | PaneState;

interface Frame {
  id: number;
  label: string;
  arg: string;
}

export class Recorder {
  private readonly steps: StepRecord[] = [];
  private readonly views: View[] = [];
  private readonly names = {
    pointer: new Set<string>(),
    range: new Set<string>(),
    variable: new Set<string>(),
    pane: new Set<string>(['code']),
  };
  private readonly source: { id: string; title: string; lang?: string; text: string };
  private started = false;
  private quiet = 0;
  private call: CallRecord | undefined;
  private calls = 0;
  private readonly frames: Frame[] = [];
  private frameCount = 0;
  private readonly visits = new Map<string, number>();
  private readonly titles = new Map<string, number>();
  private readonly deferred: (() => void)[] = [];
  private firstTitle: string | undefined;
  /** Set by `leave`: what follows belongs to the caller's next call, not to the one that returned. */
  private sealed = false;
  private readonly queue: [string, Effect][] = [];
  private readonly popped: number[] = [];
  private stepTitle: string | undefined;
  private manualStep = false;
  private finished = false;
  private heap: Records | undefined;

  constructor(private readonly options: RecorderOptions) {
    this.source = { id: 'source', ...options.source };
  }

  // ---- Views ----

  /**
   * A row of cells. Returns the array to hand to the algorithm: it is a real array, and reads and
   * writes of its cells are recorded. Anything done to it before the first `at` is setup and
   * becomes the starting values.
   */
  array<T extends Scalar>(id: string, data: T[], options: ArrayOptions = {}): T[] {
    this.beforeStart(`array "${id}"`);
    const view: ArrayState = {
      kind: 'array',
      id,
      pane: options.pane ?? id,
      options,
      data: [...data],
      proxy: [],
      initial: undefined,
      present: new Set(),
      longest: data.length,
      pointers: new Map(),
      ranges: new Map(),
    };
    for (const entry of options.pointers ?? []) {
      const pointer = typeof entry === 'string' ? { id: entry } : entry;
      this.unique('pointer', pointer.id);
      view.pointers.set(pointer.id, {
        side: pointer.side ?? 'below',
        ...(pointer.label === undefined ? {} : { label: pointer.label }),
        at: null,
        shown: false,
      });
    }
    for (const range of options.ranges ?? []) {
      this.unique('range', range.id);
      view.ranges.set(range.id, { ...range, shown: false });
    }
    view.proxy = this.track(view);
    this.register(view);
    return view.proxy as T[];
  }

  /** A table of variables and their current values, by name. */
  vars(id: string, initial: Record<string, Scalar>, options: ViewOptions = {}): void {
    this.beforeStart(`vars "${id}"`);
    for (const name of Object.keys(initial)) this.unique('variable', name);
    const now = new Map(Object.entries(initial).map(([name, value]) => [name, String(value)]));
    this.register({ kind: 'vars', id, options, initial: { ...initial }, now });
  }

  /** A call stack: one nested box per depth, filled by `enter` and emptied by `leave`. */
  stack(id: string, options: ViewOptions & { direction?: 'row' | 'column' } = {}): void {
    this.beforeStart(`stack "${id}"`);
    this.register({ kind: 'stack', id, options, deepest: 0, shown: new Set() });
  }

  /**
   * A grid of cells with row and column labels, drawn as a table. Returns the matrix to hand to
   * the algorithm; `null` and `undefined` cells show empty. Reads and writes are recorded.
   */
  grid<T extends Cell>(
    id: string,
    spec: { rows: string[]; columns: string[]; data: T[][]; corner?: string },
    options: ViewOptions = {},
  ): T[][] {
    this.beforeStart(`grid "${id}"`);
    const view: GridState = {
      kind: 'grid',
      id,
      options,
      rows: spec.rows,
      columns: spec.columns,
      corner: spec.corner ?? '',
      data: spec.data.map((row) => [...row]),
      initial: undefined,
    };
    this.register(view);
    const rows = view.data.map((_, r) => this.trackRow(view, r));
    return rows as unknown as T[][];
  }

  /**
   * Any other pane, written as the config would write it: a `graph` of the nodes a search
   * visits, say. Drive it with `read`, `update`, `add` and `remove`.
   */
  pane(id: string, panel: string, content: unknown, options: ViewOptions = {}): void {
    this.beforeStart(`pane "${id}"`);
    this.register({ kind: 'pane', id, panel, content, options });
  }

  /**
   * Linked data structures: a `graph` pane of record nodes whose pointer changes are recorded.
   * See `Records`. The first one made is the one `node` and `ref` use.
   */
  records(id: string, options: RecordsOptions = {}): Records {
    this.beforeStart(`records "${id}"`);
    const records = new Records(this, id, options);
    this.heap ??= records;
    return records;
  }

  /** Tracks a plain object as a node of the first `records()` pane; returns the same object. */
  node<T extends object>(item: T, options?: NodeOptions): T {
    return this.structure().node(item, options);
  }

  /** Points a variable of a `vars` node of the first `records()` pane at a tracked object. */
  ref(name: string, value: Pointee | string | number): void {
    this.structure().ref(name, value);
  }

  /** `setup` before the first `at()`, `running` after it, `done` once `finish()` has been called. */
  get phase(): 'setup' | 'running' | 'done' {
    return this.finished ? 'done' : this.started ? 'running' : 'setup';
  }

  private structure(): Records {
    if (this.heap === undefined) throw new Error('call records() before node() or ref()');
    return this.heap;
  }

  // ---- Steps and calls ----

  /**
   * Starts a step. Every call from here until the next `step` belongs to it. `{n}` in the title
   * is the number of times a step with that title has started, so a loop body can say "Round {n}".
   */
  step(title: string, text?: string): void {
    this.manualStep = true;
    const count = (this.titles.get(title) ?? 0) + 1;
    this.titles.set(title, count);
    this.openStep(title.replaceAll('{n}', String(count)), text);
  }

  /**
   * Starts a call: one card, for the line (or lines) now running. `snippet` must be on those
   * lines or this throws, so a wrong line number cannot reach a reader. Everything recorded
   * until the next `at` belongs to this call.
   */
  at(lines: Lines, snippet: string, options: AtOptions = {}): void {
    const [first, last] = checkLines(this.source.text, lines, snippet);
    if (!this.started) this.start();
    if (this.steps.length === 0) {
      this.openStep(this.options.steps === 'frames' ? (this.firstTitle ?? 'Run') : 'Run');
    } else if (
      this.stepTitle !== undefined &&
      this.options.steps === 'frames' &&
      !this.manualStep
    ) {
      this.openStep(this.stepTitle);
    }
    this.stepTitle = undefined;
    this.manualStep = false;

    this.calls += 1;
    const call: CallRecord = {
      id: `c${this.calls}`,
      label: options.label ?? snippet.trim(),
      where: `${this.source.title}:${first === last ? first : `${first}-${last}`}`,
      effects: {},
    };
    if (options.text !== undefined) {
      call.text = typeof options.text === 'function' ? this.silently(options.text) : options.text;
    }
    this.steps.at(-1)!.calls.push(call);
    this.call = call;

    for (const later of this.deferred.splice(0)) later();
    this.sealed = false;
    for (const [pane, effect] of this.queue.splice(0)) this.emit(pane, effect);

    // Frames that returned in the last call leave the stack now, so the reader sees them go.
    const stack = this.stackView();
    for (const depth of this.popped.splice(0)) {
      if (stack !== undefined) this.emit(stack.id, { remove: this.slot(stack, depth) });
    }

    const frame = this.frames.at(-1)?.id ?? 0;
    const key = `${frame}:${first}`;
    const run = (this.visits.get(key) ?? 0) + 1;
    this.visits.set(key, run);
    const badge = [
      run > 1 ? `run ${run}` : '',
      this.frames.length > 0 ? `depth ${this.frames.length}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const src = this.source.id;
    this.emit('code', { update: src, fields: { at: first, badge } });
    const expr =
      options.expr === true ? snippet : typeof options.expr === 'string' ? options.expr : undefined;
    const marked: Effect = {
      [options.changes ? 'update' : 'read']: src,
      lines: first === last ? [first] : [[first, last]],
    };
    if (expr !== undefined) {
      checkLines(this.source.text, lines, expr);
      marked.expr = expr;
    }
    this.call.effects.code!.push(marked);
  }

  /** Adds to the text of the card of the call that is open. */
  say(text: string): void {
    const call = this.open('say');
    call.text = call.text === undefined ? text : `${call.text} ${text}`;
  }

  // ---- What a call does ----

  /** Moves a pointer to an index (or one past either end, or `null`). Declared in `array()`. */
  point(name: string, at: number | null): void {
    this.open('point');
    const view = this.views.find(
      (item): item is ArrayState => item.kind === 'array' && item.pointers.has(name),
    );
    if (view === undefined) throw new Error(`"${name}" is not a pointer of any array`);
    const pointer = view.pointers.get(name)!;
    if (!pointer.shown) {
      pointer.shown = true;
      this.emit(view.pane, { add: name });
      this.emit(view.pane, { update: name, fields: { at } });
    } else if (pointer.at === at) {
      this.emit(view.pane, { read: name });
    } else {
      this.emit(view.pane, { update: name, fields: { at } });
    }
    pointer.at = at;
    const vars = this.views.find(
      (item): item is VarsState => item.kind === 'vars' && item.now.has(name),
    );
    if (vars !== undefined) this.set(name, at === null ? '' : at);
  }

  /** Sets a range that is not bound to pointers. */
  range(name: string, from: number, to: number): void {
    this.open('range');
    const view = this.views.find(
      (item): item is ArrayState => item.kind === 'array' && item.ranges.has(name),
    );
    if (view === undefined) throw new Error(`"${name}" is not a range of any array`);
    const range = view.ranges.get(name)!;
    if (range.from !== undefined || range.to !== undefined) {
      throw new Error(`range "${name}" follows pointers; move them instead`);
    }
    if (!range.shown) {
      range.shown = true;
      this.emit(view.pane, { add: name });
    }
    this.emit(view.pane, { update: name, fields: { from, to } });
  }

  /**
   * Sets a lasting tone on a cell, pointer or range, or on a row of any pane. `none` clears it.
   * For an array, `id` may be an index or `[first, last]` (inclusive, and empty when last is
   * before first), so a base case can mark "these cells are done" without checking for none.
   */
  tone(pane: string, id: string | number | readonly [number, number], tone: Tone): void {
    this.open('tone');
    const { pane: where, array } = this.target(pane);
    if (Array.isArray(id)) {
      for (let index = id[0]; index <= id[1]; index += 1) {
        this.update(where, `${pane}.${index}`, { tone });
      }
      return;
    }
    const cell = array !== undefined && typeof id === 'number' ? `${pane}.${id}` : String(id);
    this.update(where, cell, { tone });
  }

  /** Sets a variable shown in a `vars` pane. A value that does not change is a read. */
  set(name: string, value: Scalar): void {
    this.open('set');
    const view = this.views.find(
      (item): item is VarsState => item.kind === 'vars' && item.now.has(name),
    );
    if (view === undefined) throw new Error(`"${name}" is not a variable of any vars pane`);
    const text = String(value);
    if (view.now.get(name) === text) this.emit(view.id, { read: name });
    else this.emit(view.id, { update: name, fields: { value: text } });
    view.now.set(name, text);
  }

  /** Marks variables as read by this call. */
  use(...names: string[]): void {
    this.open('use');
    for (const name of names) {
      const view = this.views.find(
        (item): item is VarsState => item.kind === 'vars' && item.now.has(name),
      );
      if (view === undefined) throw new Error(`"${name}" is not a variable of any vars pane`);
      this.emit(view.id, { read: name });
    }
  }

  /** A function call begins. Fills the next free depth of the stack pane, if there is one. */
  enter(name: string, args: Record<string, Scalar> = {}): void {
    if (!this.started) {
      // The outermost call starts before any line has run: it joins the first call.
      this.firstTitle ??= `${name}(${Object.values(args).join(', ')})`;
      this.deferred.push(() => {
        this.enter(name, args);
        // The first call's step is already open: this frame does not start another.
        this.stepTitle = undefined;
      });
      return;
    }
    this.open('enter');
    const arg = Object.values(args).join(', ');
    const label = `${name}(${arg})`;
    const stack = this.stackView();
    const depth = this.frames.length;
    if (stack !== undefined) {
      stack.deepest = Math.max(stack.deepest, depth + 1);
      const slot = this.slot(stack, depth);
      // A sibling that starts straight after another returned reuses its slot in the same call.
      const at = this.popped.indexOf(depth);
      if (at >= 0) {
        this.popped.splice(at, 1);
        this.emit(stack.id, { remove: slot });
        stack.shown.delete(depth);
      }
      this.emit(stack.id, { add: slot });
      this.emit(stack.id, { update: slot, fields: { label, sub: '' } });
      stack.shown.add(depth);
    }
    this.frameCount += 1;
    this.frames.push({ id: this.frameCount, label, arg });
    this.stepTitle = label;
  }

  /** The function call on top of the stack ends, with a result to show. */
  leave(result?: Scalar | boolean): void {
    this.open('leave');
    const frame = this.frames.pop();
    if (frame === undefined) throw new Error('leave() with no function call open');
    const depth = this.frames.length;
    const stack = this.stackView();
    if (stack !== undefined) {
      const fields: Fields = { tone: 'good' };
      if (result !== undefined) fields.sub = `returns ${String(result)}`;
      this.emit(stack.id, { update: this.slot(stack, depth), fields });
      this.popped.push(depth);
    }
    // Whatever the caller does next, such as moving a range back, shows in its own next call.
    this.sealed = true;
    const parent = this.frames.at(-1);
    this.stepTitle = parent === undefined ? undefined : `Back in ${parent.label}`;
  }

  /** Runs `body` without recording the reads and writes it makes. */
  silently<T>(body: () => T): T {
    this.quiet += 1;
    try {
      return body();
    } finally {
      this.quiet -= 1;
    }
  }

  // ---- Any pane, in the config's own words ----

  read(pane: string, id: string, extra: Fields = {}): void {
    this.open('read');
    this.emit(pane, { read: id, ...extra });
  }
  update(pane: string, id: string, fields: Fields): void {
    this.open('update');
    this.emit(pane, { update: id, fields });
  }
  add(pane: string, id: string): void {
    this.open('add');
    this.emit(pane, { add: id });
  }
  remove(pane: string, id: string): void {
    this.open('remove');
    this.emit(pane, { remove: id });
  }

  // ---- The result ----

  /** The config. It is plain data and loads with no recorder present. */
  finish(): WalkthroughInput {
    if (this.steps.length === 0) throw new Error('nothing was recorded: call at() first');
    this.finished = true;
    this.sealed = false;
    for (const [pane, effect] of this.queue.splice(0)) this.emit(pane, effect);
    for (const step of this.steps) {
      if (step.calls.length === 0) throw new Error(`step "${step.title}" has no calls`);
    }
    const panes: NonNullable<WalkthroughInput['layout']>['panes'] = [
      {
        id: 'code',
        panel: 'code',
        title: 'Code',
        content: {
          sources: [
            {
              id: this.source.id,
              title: this.source.title,
              ...(this.source.lang === undefined ? {} : { lang: this.source.lang }),
              text: this.source.text,
            },
          ],
        },
      },
      ...this.views
        // Arrays that share a pane are drawn by the first of them.
        .filter(
          (view, index) =>
            view.kind !== 'array' ||
            this.views.findIndex((item) => item.kind === 'array' && item.pane === view.pane) ===
              index,
        )
        .map((view) => this.paneOf(view)),
    ];
    const steps = this.steps.map((step) => ({
      id: step.id,
      title: step.title,
      ...(step.text === undefined ? {} : { text: step.text }),
      calls: step.calls.map((call) => ({
        id: call.id,
        label: call.label,
        ...(call.text === undefined ? {} : { text: call.text }),
        ...(call.where === undefined ? {} : { where: call.where }),
        effects: call.effects,
      })),
    }));
    return {
      id: this.options.id,
      title: this.options.title,
      ...(this.options.lead === undefined ? {} : { lead: this.options.lead }),
      ...(this.options.tags === undefined ? {} : { tags: this.options.tags }),
      layout: { panes },
      steps,
    };
  }

  // ---- Internals ----

  private beforeStart(what: string): void {
    if (this.started) throw new Error(`${what} must be created before the first at()`);
  }

  /** Pointer, range and variable names are looked up by name alone, so each kind must be unique. */
  private unique(kind: keyof Recorder['names'], name: string): void {
    if (this.names[kind].has(name)) throw new Error(`the ${kind} "${name}" is declared twice`);
    this.names[kind].add(name);
  }

  private register(view: View): void {
    const shared = view.kind === 'array' && view.pane !== view.id;
    if (!shared) this.unique('pane', view.kind === 'array' ? view.pane : view.id);
    else if (!this.views.some((item) => item.kind === 'array' && item.pane === view.pane)) {
      this.unique('pane', view.pane);
    }
    if (this.views.some((item) => item.kind === 'array' && item.id === view.id)) {
      throw new Error(`the array "${view.id}" is declared twice`);
    }
    this.views.push(view);
  }

  /** The pane and the id of a cell, pointer or range, by array id or by pane id. */
  private target(name: string): { pane: string; array: ArrayState | undefined } {
    const array = this.views.find(
      (item): item is ArrayState => item.kind === 'array' && item.id === name,
    );
    if (array !== undefined) return { pane: array.pane, array };
    if (!this.views.some((item) => item.id === name))
      throw new Error(`no pane or array "${name}" was declared`);
    return { pane: name, array: undefined };
  }

  private stackView(): StackState | undefined {
    return this.views.find((item): item is StackState => item.kind === 'stack');
  }

  private slot(stack: StackState, depth: number): string {
    return `${stack.id}-${depth}`;
  }

  private start(): void {
    this.started = true;
    for (const view of this.views) {
      if (view.kind === 'array') {
        view.initial = [...view.data];
        view.present = new Set(view.data.map((_, index) => index));
      } else if (view.kind === 'grid') {
        view.initial = view.data.map((row) => [...row]);
      }
    }
  }

  private openStep(title: string, text?: string): void {
    const last = this.steps.at(-1);
    if (last !== undefined && last.calls.length === 0) {
      throw new Error(`step "${last.title}" has no calls: call at() before starting another step`);
    }
    const step: StepRecord = { id: `s${this.steps.length + 1}`, title, calls: [] };
    if (text !== undefined) step.text = text;
    this.steps.push(step);
  }

  private open(what: string): CallRecord {
    if (this.call === undefined)
      throw new Error(`${what}() before the first at(): no call is open`);
    return this.call;
  }

  /** Adds an effect to the open call, folding repeats so the config stays short and lint clean. */
  private emit(pane: string, effect: Effect): void {
    if (this.quiet > 0 || this.call === undefined) return;
    if (this.sealed) {
      this.queue.push([pane, effect]);
      return;
    }
    const list = (this.call.effects[pane] ??= []);
    const verb = (['add', 'update', 'read', 'remove'] as const).find(
      (key) => effect[key] !== undefined,
    )!;
    const id = effect[verb] as string;
    const same = (other: Effect, key: string) => other[key] === id;
    if (verb === 'add' && list.some((other) => same(other, 'add'))) return;
    if (verb === 'update') {
      const earlier = list.find((other) => same(other, 'update'));
      if (earlier !== undefined) {
        earlier.fields = { ...earlier.fields, ...effect.fields };
        return;
      }
    }
    if (verb === 'read') {
      const earlier = list.find((other) => same(other, 'read'));
      if (earlier !== undefined) {
        if (Array.isArray(earlier.cells) && Array.isArray(effect.cells)) {
          for (const cell of effect.cells)
            if (!earlier.cells.includes(cell)) earlier.cells.push(cell);
        }
        return;
      }
      // Reading what the call already changed adds nothing to the picture.
      if (
        effect.cells === undefined &&
        list.some((other) => same(other, 'update') || same(other, 'add'))
      ) {
        return;
      }
    }
    list.push(effect);
  }

  // ---- Tracking ----

  private track(view: ArrayState): Scalar[] {
    return new Proxy(view.data, {
      get: (target, prop, receiver) => {
        if (typeof prop === 'string' && INDEX.test(prop)) {
          const index = Number(prop);
          if (index < target.length && this.started && view.present.has(index)) {
            this.emit(view.pane, { read: `${view.id}.${index}` });
          }
          return Reflect.get(target, prop);
        }
        return Reflect.get(target, prop, receiver);
      },
      set: (target, prop, value) => {
        if (typeof prop === 'string' && INDEX.test(prop)) {
          const index = Number(prop);
          if (!isScalar(value))
            throw new TypeError(`cells hold strings or numbers; got ${String(value)}`);
          if (index > target.length)
            throw new RangeError(
              `cannot write index ${index} of a ${target.length}-cell array: that leaves a gap`,
            );
          const fresh = !view.present.has(index);
          Reflect.set(target, prop, value);
          view.longest = Math.max(view.longest, target.length);
          if (this.started) {
            const cell = `${view.id}.${index}`;
            if (fresh) {
              view.present.add(index);
              this.emit(view.pane, { add: cell });
            }
            this.emit(view.pane, { update: cell, fields: { value } });
          } else {
            view.present.add(index);
          }
          return true;
        }
        if (prop === 'length') {
          const length = Number(value);
          if (length > target.length)
            throw new RangeError('cannot grow an array by setting its length');
          for (let index = length; index < target.length; index += 1) this.drop(view, index);
          return Reflect.set(target, prop, value);
        }
        return Reflect.set(target, prop, value);
      },
      deleteProperty: (target, prop) => {
        if (typeof prop === 'string' && INDEX.test(prop)) this.drop(view, Number(prop));
        return Reflect.deleteProperty(target, prop);
      },
    });
  }

  private drop(view: ArrayState, index: number): void {
    if (!view.present.has(index)) return;
    view.present.delete(index);
    if (this.started) this.emit(view.pane, { remove: `${view.id}.${index}` });
  }

  private trackRow(view: GridState, row: number): Cell[] {
    const rowId = `${view.id}-r${row}`;
    return new Proxy(view.data[row]!, {
      get: (target, prop, receiver) => {
        if (
          typeof prop === 'string' &&
          INDEX.test(prop) &&
          Number(prop) < target.length &&
          this.started
        ) {
          this.emit(view.id, { read: rowId, cells: [`c${prop}`] });
        }
        return Reflect.get(target, prop, receiver);
      },
      set: (target, prop, value) => {
        if (typeof prop === 'string' && INDEX.test(prop) && this.started) {
          this.emit(view.id, { update: rowId, fields: { [`c${prop}`]: show(value as Cell) } });
        }
        return Reflect.set(target, prop, value);
      },
    });
  }

  private paneOf(view: View): NonNullable<WalkthroughInput['layout']>['panes'][number] {
    const head = (panel: string, fallback: string) => ({
      id: view.id,
      panel,
      title: view.options.title ?? fallback,
      ...(view.options.role === undefined ? {} : { role: view.options.role }),
    });
    switch (view.kind) {
      case 'pane':
        return { ...head(view.panel, view.id), content: view.content };
      case 'array': {
        const group = this.views.filter(
          (item): item is ArrayState => item.kind === 'array' && item.pane === view.pane,
        );
        const pointers = group.flatMap((array) =>
          [...array.pointers].map(([id, pointer]) => ({
            id,
            array: array.id,
            side: pointer.side,
            ...(pointer.label === undefined ? {} : { label: pointer.label }),
            initial: false,
          })),
        );
        const ranges = group.flatMap((array) =>
          [...array.ranges].map(([id, range]) => {
            const bound = range.from !== undefined && range.to !== undefined;
            return {
              id,
              array: array.id,
              from: range.from ?? 0,
              to: range.to ?? -1,
              ...(range.label === undefined ? {} : { label: range.label }),
              ...(range.dim ? { dim: true } : {}),
              ...(range.tone === undefined ? {} : { tone: range.tone }),
              initial: bound,
            };
          }),
        );
        const arrays = group.map((array) => {
          const initial = array.initial ?? array.data;
          return {
            id: array.id,
            label: array.id,
            cells: initial,
            ...(array.longest > initial.length ? { length: array.longest } : {}),
          };
        });
        return {
          ...head('array', view.pane),
          id: view.pane,
          content: { arrays, pointers, ranges },
        };
      }
      case 'vars':
        return {
          ...head('table', 'Variables'),
          content: {
            columns: [
              { id: 'name', label: 'Variable', mono: true },
              { id: 'value', label: 'Value', mono: true },
            ],
            rows: Object.entries(view.initial).map(([name, value]) => ({
              id: name,
              cells: { name, value: String(value) },
            })),
          },
        };
      case 'stack':
        return {
          ...head('boxes', 'Call stack'),
          content: {
            initial: false,
            direction: view.options.direction ?? 'column',
            boxes: Array.from({ length: Math.max(view.deepest, 1) }, (_, depth) => ({
              id: this.slot(view, depth),
              label: `depth ${depth + 1}`,
              ...(depth > 0 ? { parent: this.slot(view, depth - 1) } : {}),
            })),
          },
        };
      case 'grid': {
        const initial = view.initial ?? view.data;
        return {
          ...head('table', view.id),
          content: {
            columns: [
              { id: 'label', label: view.corner, mono: true },
              ...view.columns.map((label, index) => ({ id: `c${index}`, label, mono: true })),
            ],
            rows: view.rows.map((label, row) => ({
              id: `${view.id}-r${row}`,
              cells: {
                label,
                ...Object.fromEntries(
                  view.columns.map((_, col) => [`c${col}`, show(initial[row]?.[col])]),
                ),
              },
            })),
          },
        };
      }
    }
  }
}
