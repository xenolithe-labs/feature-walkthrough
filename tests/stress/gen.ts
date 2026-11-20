/**
 * Generators for stress configs. Everything here is deterministic: a config is
 * a function of a seed and a few sizes, so a failing property can be replayed
 * by seed. All subject matter is invented.
 */
import type { WalkthroughInput } from '../../src/core';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Pane = WalkthroughInput['layout']['panes'][number];
type Step = WalkthroughInput['steps'][number];
type Call = Step['calls'][number];
type Effect = Record<string, unknown>;

/** mulberry32: small, fast, and good enough to drive generators. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;

export const LANES = [
  { id: 'client', title: 'Client' },
  { id: 'gateway', title: 'Gateway' },
  { id: 'ledger', title: 'Ledger' },
  { id: 'mailer', title: 'Mailer' },
];

/** Ids at the edge of the allowed pattern: dots, colons, dashes, underscores, digits first. */
export const ODD_IDS = ['n.1', 'n:2', 'n-3', 'n_4', '5n', 'N.6:x-y_z', 'a', 'a.b', 'a.b.c'];

/** What a panel generator hands back: content, every element id, and which start present. */
interface Made {
  pane: Pane;
  ids: string[];
  present: Set<string>;
  /** Extra keys for an effect on `id` with `verb`. */
  extra(r: Rng, id: string, verb: string, k: number): Effect;
  /** True for panes whose effects are written by the panel itself. */
  implicit?: boolean;
}

function noExtra() {
  return {};
}

const TONES = ['warn', 'good', 'muted', 'none'];

function pickSome<T>(r: Rng, items: readonly T[], max: number): T[] {
  const count = 1 + r.int(Math.min(max, items.length));
  const copy = [...items];
  const out: T[] = [];
  while (out.length < count && copy.length > 0) out.push(copy.splice(r.int(copy.length), 1)[0]!);
  return out;
}

function fieldsFor(r: Rng, keys: readonly string[], k: number): Record<string, unknown> {
  return r.chance(0.3) ? { tone: r.pick(TONES) } : { [r.pick(keys)]: `v${k}` };
}

function makeDiagram(
  kind: 'graph' | 'flow',
  id: string,
  r: Rng,
  role: 'fixed' | 'focus',
  selfLoops: boolean,
): Made {
  const initialDefault = kind === 'flow';
  const nodeIds = ODD_IDS.slice(0, 6);
  const nodes = nodeIds.map((nodeId) => ({
    id: nodeId,
    label: `Node ${nodeId}`,
    ...(r.chance(0.3) ? { sub: 'detail' } : {}),
    ...(r.chance(0.2) ? { kind: r.pick(['step', 'decision', 'terminal']) } : {}),
    ...(r.chance(0.2) ? { initial: r.chance(0.5) } : {}),
  }));
  const seen = new Set<string>();
  const edges: Record<string, unknown>[] = [];
  for (let i = 0; i < 6; i += 1) {
    const from = r.pick(nodeIds);
    const to = r.pick(nodeIds);
    if ((from === to && !selfLoops) || seen.has(`${from}|${to}`)) continue;
    seen.add(`${from}|${to}`);
    edges.push({ from, to, ...(r.chance(0.3) ? { label: 'goes' } : {}) });
  }
  const ids = [
    ...nodes.map((n) => n.id),
    ...edges.map((e) => `${e.from as string}.${e.to as string}`),
  ];
  const present = new Set<string>();
  nodes.forEach((n) => (n.initial ?? initialDefault) && present.add(n.id));
  edges.forEach((e) => initialDefault && present.add(`${e.from as string}.${e.to as string}`));
  return {
    pane: { id, panel: kind, role, content: { nodes, edges, initial: initialDefault } },
    ids,
    present,
    extra: (rr, _id, verb, k) =>
      verb === 'update' ? { fields: fieldsFor(rr, ['label', 'sub'], k) } : {},
  };
}

function makeBoxes(id: string, r: Rng, role: 'fixed' | 'focus'): Made {
  const boxes = Array.from({ length: 6 }, (_, i) => ({
    id: `b${i}`,
    label: `Box ${i}`,
    ...(i > 0 && r.chance(0.7) ? { parent: `b${r.int(i)}` } : {}),
  }));
  const edges: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 3; i += 1) {
    const from = `b${r.int(6)}`;
    const to = `b${r.int(6)}`;
    if (from === to || seen.has(`${from}|${to}`)) continue;
    seen.add(`${from}|${to}`);
    edges.push({ from, to });
  }
  const ids = [
    ...boxes.map((b) => b.id),
    ...edges.map((e) => `${e.from as string}.${e.to as string}`),
  ];
  return {
    pane: {
      id,
      panel: 'boxes',
      role,
      content: { boxes, edges, direction: r.pick(['row', 'column']) },
    },
    ids,
    present: new Set(ids),
    extra: (rr, _id, verb, k) =>
      verb === 'update' ? { fields: fieldsFor(rr, ['label', 'sub'], k) } : {},
  };
}

function makeTable(id: string, r: Rng, role: 'fixed' | 'focus'): Made {
  const columns = ['name', 'qty', 'note.x', 'c:4'].map((c) => ({ id: c, label: c.toUpperCase() }));
  const rows = Array.from({ length: 6 }, (_, i) => ({
    id: `r${i}`,
    cells: Object.fromEntries(
      columns.filter(() => r.chance(0.8)).map((c) => [c.id, `${c.id}-${i}`]),
    ),
    ...(r.chance(0.2) ? { initial: false } : {}),
  }));
  const present = new Set(rows.filter((row) => row.initial !== false).map((row) => row.id));
  const cols = columns.map((c) => c.id);
  return {
    pane: { id, panel: 'table', role, content: { columns, rows } },
    ids: rows.map((row) => row.id),
    present,
    extra: (rr, _id, verb, k) => {
      if (verb === 'update') return { fields: fieldsFor(rr, cols, k) };
      if (verb === 'read' && rr.chance(0.5)) return { cells: pickSome(rr, cols, 2) };
      return {};
    },
  };
}

const CODE_TEXT = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `${tag} line ${i + 1}`).join('\n');

function makeCode(id: string, r: Rng, role: 'fixed' | 'focus'): Made {
  const sources = [
    { id: 'main.ts', title: 'main', lang: 'ts', text: CODE_TEXT(8, 'main') },
    { id: 'util', title: 'util', text: CODE_TEXT(5 + r.int(4), 'util') },
  ];
  return {
    pane: { id, panel: 'code', role, content: { sources } },
    ids: sources.map((s) => s.id),
    present: new Set(sources.map((s) => s.id)),
    // Lines stay within 1..3 and replacement texts keep at least 3 lines: lint does not
    // follow `remove` (see the pinned defect), so the generator avoids depending on it.
    extra: (rr, _id, verb, k) => {
      if (verb === 'focus' || verb === 'remove') return {};
      const lines = rr.chance(0.5) ? [1 + rr.int(3)] : [[1, 1 + rr.int(3)]];
      if (verb === 'update' && rr.chance(0.4)) {
        return { lines, fields: { text: CODE_TEXT(3 + rr.int(4), `rev${k}`) } };
      }
      return { lines };
    },
  };
}

function makePayload(id: string, r: Rng, role: 'fixed' | 'focus'): Made {
  const value0: Json = {
    status: 'open',
    owner: { name: 'Mira', tags: ['a', 'b'], link: { $ref: 'p1', text: 'see p1' } },
    entries: [
      { hash: 'aa', size: '1' },
      { hash: 'bb', size: '2' },
    ],
    note: 'line 1\nline 2',
  };
  const value1: Json = ['x', { deep: { deeper: { deepest: 'z' } } }, null, 3, true];
  const payloads = [
    { id: 'p0', title: 'First', value: value0, ...(r.chance(0.5) ? { raw: { text: '{}' } } : {}) },
    { id: 'p1', title: 'Second', value: value1 },
  ];
  const leaves: Record<string, string[]> = {
    p0: ['status', 'owner.name', 'owner.tags.1', 'entries.0.hash', 'entries.1.size', 'note'],
    p1: ['0', '1.deep.deeper.deepest', '3'],
  };
  return {
    pane: { id, panel: 'payload', role, content: { payloads } },
    ids: ['p0', 'p1'],
    present: new Set(['p0', 'p1']),
    extra: (rr, pid, verb, k) => {
      const paths = leaves[pid] ?? [];
      if (verb === 'update') {
        const chosen = pickSome(rr, paths, 2);
        const fields: Record<string, unknown> = Object.fromEntries(chosen.map((p) => [p, `u${k}`]));
        if (rr.chance(0.2)) fields.tone = rr.pick(TONES);
        return { fields };
      }
      if (verb === 'read' && rr.chance(0.6)) return { paths: pickSome(rr, paths, 3) };
      return {};
    },
  };
}

function makeSchema(id: string, r: Rng, role: 'fixed' | 'focus'): Made {
  const tables = ['users', 'orders', 'order.items'].map((t, i) => ({
    id: t,
    label: t.toUpperCase(),
    columns: [
      { id: 'id', key: 'PK', type: 'int' },
      { id: `c${i}`, label: 'col' },
      ...(r.chance(0.5) ? [{ id: 'ref', key: 'FK', initial: false }] : []),
    ],
  }));
  const ends = tables.flatMap((t) => [t.id, ...t.columns.map((c) => `${t.id}.${c.id}`)]);
  const relations: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 4; i += 1) {
    const from = r.pick(ends);
    const to = r.pick(ends);
    const rid = `${from}:${to}`;
    if (seen.has(rid)) continue;
    seen.add(rid);
    relations.push({ from, to });
  }
  const ids = [
    ...tables.flatMap((t) => [t.id, ...t.columns.map((c) => `${t.id}.${c.id}`)]),
    ...relations.map((x) => `${x.from as string}:${x.to as string}`),
  ];
  const present = new Set(ids);
  tables.forEach((t) =>
    t.columns.forEach(
      (c) => (c as { initial?: boolean }).initial === false && present.delete(`${t.id}.${c.id}`),
    ),
  );
  return {
    pane: { id, panel: 'schema', role, content: { tables, relations } },
    ids,
    present,
    extra: (rr, _id, verb, k) =>
      verb === 'update' ? { fields: fieldsFor(rr, ['label', 'type', 'note', 'sub'], k) } : {},
  };
}

export interface RandomOptions {
  steps?: number;
  calls?: number;
  /** Include graph self-loops in graph and flow content. */
  selfLoops?: boolean;
}

/** One walkthrough that uses every panel type and every effect verb, and passes lint. */
export function randomWalkthrough(seed: number, options: RandomOptions = {}): WalkthroughInput {
  const r = rng(seed);
  const { steps = 5, calls = 4, selfLoops = false } = options;
  const roles = (i: number): 'fixed' | 'focus' => (i >= 5 ? 'focus' : 'fixed');
  const made: Made[] = [
    {
      pane: { id: 'seq', panel: 'sequence', role: 'fixed' },
      ids: [],
      present: new Set(),
      extra: noExtra,
      implicit: true,
    },
    makeDiagram('graph', 'graph', r, roles(1), selfLoops),
    makeDiagram('flow', 'flow', r, roles(2), selfLoops),
    makeBoxes('boxes', r, roles(3)),
    makeTable('table', r, roles(4)),
    makeCode('code', r, roles(5)),
    makePayload('payload', r, roles(6)),
    makeSchema('schema', r, roles(7)),
  ];
  const focusIds = made.filter((m) => m.pane.role === 'focus').map((m) => m.pane.id);
  const present = new Map(made.map((m) => [m.pane.id, new Set(m.present)]));
  let k = 0;

  const outSteps: Step[] = [];
  for (let s = 0; s < steps; s += 1) {
    const outCalls: Call[] = [];
    for (let c = 0; c < calls; c += 1) {
      const call: Call = { id: `c${s}_${c}`, label: `Call ${s}.${c}` };
      if (r.chance(0.7)) {
        call.from = r.pick(LANES).id;
        call.to = r.pick(LANES).id;
      }
      if (focusIds.length > 0 && r.chance(0.3)) call.show = r.pick(focusIds);
      const effects: Record<string, Effect[]> = {};
      for (const m of made) {
        if (m.implicit || !r.chance(0.6)) continue;
        const here = present.get(m.pane.id)!;
        const list: Effect[] = [];
        for (let e = 0, n = 1 + r.int(3); e < n; e += 1) {
          k += 1;
          const absent = m.ids.filter((id) => !here.has(id));
          const live = m.ids.filter((id) => here.has(id));
          const verbs = [
            'set',
            ...(absent.length > 0 ? ['add'] : []),
            ...(live.length > 0 ? ['update', 'read', 'remove', 'focus'] : []),
          ];
          const verb = r.pick(verbs);
          if (verb === 'set') {
            list.push({ set: r.pick([null, 1, 'text', [1, 2], { a: { b: 1 } }]) });
            continue;
          }
          const id = r.pick(verb === 'add' ? absent : live);
          if (verb === 'add') here.add(id);
          if (verb === 'remove') here.delete(id);
          list.push({ [verb]: id, ...m.extra(r, id, verb, k) });
        }
        effects[m.pane.id] = list;
      }
      if (Object.keys(effects).length > 0 || r.chance(0.5)) call.effects = effects;
      outCalls.push(call);
    }
    outSteps.push({ id: `s${s}`, title: `Step ${s}`, calls: outCalls });
  }
  return {
    id: `rand-${seed}`,
    title: `Random ${seed}`,
    lanes: LANES,
    layout: { panes: made.map((m) => m.pane) },
    steps: outSteps,
  };
}

// ---------------------------------------------------------------------------
// Scale fixtures

const word = (i: number) => `item-${i}`;

/** A single-walkthrough wrapper around panes and steps. */
export function wrap(
  id: string,
  panes: Pane[],
  steps: Step[],
  extra: Partial<WalkthroughInput> = {},
): WalkthroughInput {
  return { id, title: id, lanes: LANES, layout: { panes }, steps, ...extra };
}

/** Many steps with many calls, each a message plus a table update. */
export function longWalkthrough(stepCount: number, callsPerStep: number): WalkthroughInput {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, cells: { v: '0' } }));
  const steps: Step[] = Array.from({ length: stepCount }, (_, s) => ({
    id: `s${s}`,
    title: `Step ${s}`,
    calls: Array.from({ length: callsPerStep }, (_, c) => ({
      id: `c${s}_${c}`,
      label: `Call ${s}.${c}`,
      from: LANES[(s + c) % 4]!.id,
      to: LANES[(s + c + 1) % 4]!.id,
      effects: {
        table: [{ update: `r${(s * callsPerStep + c) % 20}`, fields: { v: `${s}.${c}` } }],
      },
    })),
  }));
  return wrap(
    'long',
    [
      { id: 'seq', panel: 'sequence' },
      { id: 'table', panel: 'table', content: { columns: [{ id: 'v', label: 'V' }], rows } },
    ],
    steps,
  );
}

/** A graph of `nodes` nodes where each node links to `fanout` others, added over many calls. */
export function bigGraph(
  nodes: number,
  fanout: number,
  options: { initial?: boolean } = {},
): WalkthroughInput {
  const ns = Array.from({ length: nodes }, (_, i) => ({
    id: `n${i}`,
    label: `Node ${i}`,
    sub: word(i),
  }));
  const edges: { from: string; to: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < nodes; i += 1) {
    for (let f = 1; f <= fanout; f += 1) {
      const to = (i * 7 + f * 13) % nodes;
      if (to === i || seen.has(`${i}|${to}`)) continue;
      seen.add(`${i}|${to}`);
      edges.push({ from: `n${i}`, to: `n${to}` });
    }
  }
  const per = 10;
  const calls: Call[] = [];
  for (let i = 0; i < nodes; i += per) {
    const ids = ns.slice(i, i + per).map((n) => n.id);
    calls.push({
      id: `g${i}`,
      label: `Grow ${i}`,
      effects: { graph: ids.map((id) => ({ add: id })) },
    });
  }
  calls.push({
    id: 'edges',
    label: 'Link everything',
    effects: { graph: edges.map((e) => ({ add: `${e.from}.${e.to}` })) },
  });
  return wrap(
    'big-graph',
    [
      {
        id: 'graph',
        panel: 'graph',
        content: { nodes: ns, edges, ...(options.initial ? { initial: true } : {}) },
      },
    ],
    [{ id: 's0', title: 'Grow', calls }],
  );
}

export function bigTable(rows: number, cols: number): WalkthroughInput {
  const columns = Array.from({ length: cols }, (_, i) => ({
    id: `col${i}`,
    label: `Column ${i}`,
    ...(i % 3 === 0 ? { mono: true } : {}),
  }));
  const rs = Array.from({ length: rows }, (_, r) => ({
    id: `row${r}`,
    cells: Object.fromEntries(
      columns.map((c, i) => [c.id, `r${r}c${i}${i === 1 ? '\nsecond line' : ''}`]),
    ),
  }));
  const calls: Call[] = Array.from({ length: 12 }, (_, i) => ({
    id: `t${i}`,
    label: `Touch ${i}`,
    effects: {
      table: [
        { update: `row${(i * 41) % rows}`, fields: { col2: `changed ${i}`, tone: 'warn' } },
        { read: `row${(i * 17 + 3) % rows}`, cells: ['col0', 'col5'] },
        ...(i % 4 === 3 ? [{ remove: `row${(i * 41) % rows}` }] : []),
      ],
    },
  }));
  return wrap(
    'big-table',
    [{ id: 'table', panel: 'table', content: { columns, rows: rs } }],
    [{ id: 's0', title: 'Touch', calls }],
  );
}

export function bigCode(lines: number): WalkthroughInput {
  const text = Array.from(
    { length: lines },
    (_, i) => `const value${i} = compute(${i}); // line ${i + 1}`,
  ).join('\n');
  const marks = [1, Math.floor(lines / 2), lines];
  const calls: Call[] = marks.map((line, i) => ({
    id: `k${i}`,
    label: `Look at ${line}`,
    effects: { code: [{ read: 'big', lines: [line, [Math.max(1, line - 2), line]] }] },
  }));
  return wrap(
    'big-code',
    [
      {
        id: 'code',
        panel: 'code',
        content: { sources: [{ id: 'big', title: 'big.ts', lang: 'ts', text }] },
      },
    ],
    [{ id: 's0', title: 'Read', calls }],
  );
}

/** A payload nested `depth` levels, with an array of `width` entries at every level. */
export function deepPayload(depth: number, width: number): { value: Json; path: string } {
  const build = (level: number): Json => {
    if (level === depth) return 'leaf';
    return Array.from({ length: width }, (_, i) =>
      i === 0 ? { [`k${level}`]: build(level + 1) } : `filler ${level}.${i}`,
    );
  };
  const value = build(0);
  const outer: string[] = [];
  for (let level = 0; level < depth; level += 1) outer.push('0', `k${level}`);
  return { value, path: outer.join('.') };
}

export function deepPayloadWalkthrough(depth: number, width: number): WalkthroughInput {
  const { value, path } = deepPayload(depth, width);
  return wrap(
    'deep-payload',
    [
      {
        id: 'payload',
        panel: 'payload',
        content: { payloads: [{ id: 'doc', title: 'Doc', value }] },
      },
    ],
    [
      {
        id: 's0',
        title: 'Walk down',
        calls: [
          {
            id: 'p0',
            label: 'Read the leaf',
            effects: { payload: [{ read: 'doc', paths: [path] }] },
          },
          {
            id: 'p1',
            label: 'Change the leaf',
            effects: { payload: [{ update: 'doc', fields: { [path]: 'changed' } }] },
          },
        ],
      },
    ],
  );
}

export function bigSchema(tables: number, relations: number): WalkthroughInput {
  const ts = Array.from({ length: tables }, (_, i) => ({
    id: `tbl${i}`,
    label: `Table ${i}`,
    columns: [
      { id: 'id', key: 'PK', type: 'int' },
      { id: 'parent_id', key: 'FK', type: 'int' },
      { id: 'name', type: 'text' },
      { id: 'created', type: 'ts' },
    ],
  }));
  const rs = Array.from({ length: relations }, (_, i) => ({
    from: `tbl${i % tables}.parent_id`,
    to: `tbl${(i * 7 + 3) % tables}`,
    id: `rel${i}`,
  }));
  return wrap(
    'big-schema',
    [{ id: 'schema', panel: 'schema', content: { tables: ts, relations: rs } }],
    [
      {
        id: 's0',
        title: 'Look',
        calls: [
          {
            id: 'a',
            label: 'Read a column',
            effects: { schema: [{ read: 'tbl3.name' }, { read: 'rel3' }] },
          },
          {
            id: 'b',
            label: 'Update',
            effects: { schema: [{ update: 'tbl4.created', fields: { type: 'date' } }] },
          },
        ],
      },
    ],
  );
}

/** `n` boxes nested `n` deep. */
export function nestedBoxes(n: number): WalkthroughInput {
  const boxes = Array.from({ length: n }, (_, i) => ({
    id: `lvl${i}`,
    label: `Level ${i}`,
    ...(i > 0 ? { parent: `lvl${i - 1}` } : {}),
  }));
  return wrap(
    'nested',
    [{ id: 'boxes', panel: 'boxes', content: { boxes, direction: 'column' } }],
    [
      {
        id: 's0',
        title: 'Dive',
        calls: [
          { id: 'd0', label: 'Deepest', effects: { boxes: [{ read: `lvl${n - 1}` }] } },
          {
            id: 'd1',
            label: 'Remove middle',
            effects: { boxes: [{ remove: `lvl${Math.floor(n / 2)}` }] },
          },
        ],
      },
    ],
  );
}

/** Many panes, `focusCount` of which share the focus slot, switched by `show`. */
export function manyPanes(total: number, focusCount: number): WalkthroughInput {
  const panes: Pane[] = [];
  const steps: Call[] = [];
  for (let i = 0; i < total; i += 1) {
    const role = i < total - focusCount ? 'fixed' : 'focus';
    panes.push({
      id: `pane${i}`,
      panel: 'table',
      title: `Pane ${i}`,
      role,
      content: {
        columns: [{ id: 'v', label: 'V' }],
        rows: [{ id: 'row', cells: { v: `pane ${i}` } }],
      },
    });
  }
  const focus = panes.filter((p) => p.role === 'focus').map((p) => p.id);
  for (let round = 0; round < 3; round += 1) {
    for (const id of focus)
      steps.push({
        id: `show-${round}-${id}`,
        label: `Show ${id}`,
        show: id,
        effects: { [id]: [{ update: 'row', fields: { v: `round ${round}` } }] },
      });
  }
  return wrap('many-panes', panes, [{ id: 's0', title: 'Switch', calls: steps }]);
}

/** Several walkthroughs in one file. */
export function collection(ids: string[]): { walkthroughs: WalkthroughInput[] } {
  return { walkthroughs: ids.map((id) => ({ ...longWalkthrough(2, 2), id })) };
}

/** Hostile strings for labels and text. Never markup that the viewer should interpret. */
export const HOSTILE_TEXT = [
  '<script>window.__pwned = 1</script>',
  '<img src=x onerror="window.__pwned=1">',
  '"><svg onload=window.__pwned=1>',
  "$& $1 $` $' $$ \\ \\n \\u0000 \u0000",
  '</script><!--fw-config--><script>',
  'שלום עולם مرحبا بالعالم ‮reversed‬',
  'é́́ 👩‍👩‍👧‍👦 🏳️‍🌈 ​‍',
  'line one\nline two\r\nline three\ttabbed',
  '{{7*7}} ${7*7} %s %d',
  '__proto__ constructor toString',
];

/** True when some `$ref` leaf has a `text` that is not a string (a pinned defect: see lint.test.ts). */
export function hasNonStringRefText(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const o = node as Record<string, unknown>;
  if (typeof o.$ref === 'string' && o.text !== undefined && typeof o.text !== 'string') return true;
  return Object.values(o).some(hasNonStringRefText);
}

export const POOL: unknown[] = [
  null,
  true,
  0,
  -1,
  1.5,
  1e21,
  '',
  ' ',
  'x',
  'a.b',
  [],
  {},
  [null],
  { a: 1 },
  '__proto__',
];

/** Overwrites or deletes 1-3 random places in a copy of `config`. */
export function mutate(config: unknown, seed: number): unknown {
  const r = rng(seed);
  const clone = JSON.parse(JSON.stringify(config)) as unknown;
  const places: { holder: Record<string, unknown>; key: string }[] = [];
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return;
    for (const [key, child] of Object.entries(node)) {
      places.push({ holder: node as Record<string, unknown>, key });
      walk(child);
    }
  };
  walk(clone);
  for (let i = 0; i < 1 + r.int(3); i += 1) {
    const { holder, key } = r.pick(places);
    if (r.chance(0.35)) {
      if (Array.isArray(holder)) holder.splice(Number(key), 1);
      else delete holder[key];
    } else {
      holder[key] = r.pick(POOL);
    }
  }
  return clone;
}
