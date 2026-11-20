import { describe, expect, it } from 'vitest';
import { loadConfig, type WalkthroughInput } from '../../src/core';
import { createRegistry } from '../../src/registry';
import { analyse, describeGeneric, describePane, traceOf } from '../../src/review';
import { describeSequence } from '../../src/panels/sequence/describe';
import { baseConfig, testRegistry } from '../helpers/registry';

type Effects = Record<string, Record<string, unknown>[]>;

/** One pane, two calls: what the pane looks like after the second, as the trace says. */
function lines(
  panel: string,
  content: unknown,
  first: Effects,
  second: Effects,
  extra: Partial<WalkthroughInput['steps'][number]['calls'][number]> = {},
  top: Partial<WalkthroughInput> = {},
): string[] {
  const config: WalkthroughInput = {
    id: 'one',
    title: 'One',
    lanes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ],
    ...top,
    layout: { panes: [{ id: 'p', panel, content }] },
    steps: [
      {
        id: 's',
        title: 'S',
        calls: [
          { id: 'one', label: 'One', effects: first },
          { id: 'two', label: 'Two', effects: second, ...extra },
        ],
      },
    ],
  };
  const result = loadConfig(config, createRegistry());
  expect(result.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
  const analysis = analyse(result.walkthroughs[0]!);
  const trace = traceOf(analysis, [analysis.calls[1]!]);
  return trace[0]!.panes.find((pane) => pane.id === 'p')!.lines;
}

describe('describe: one small function per panel', () => {
  it('table: rows with their cells, the touched cell in >..<', () => {
    const out = lines(
      'table',
      {
        columns: [
          { id: 'item', label: 'Item' },
          { id: 'qty', label: 'Qty' },
        ],
        rows: [
          { id: 'r1', cells: { item: 'tea', qty: '1' } },
          { id: 'r2', cells: { item: 'mug', qty: '4' } },
          { id: 'r3', cells: { item: 'cup', qty: '7' }, initial: false },
        ],
      },
      {},
      {
        p: [
          { update: 'r1', fields: { qty: '2' } },
          { read: 'r2', cells: ['item'] },
        ],
      },
    );
    expect(out).toEqual([
      '2 of 3 rows shown; columns: item, qty',
      'r1 (updated): item=tea qty=>2<',
      'r2 (read): item=>mug< qty=4',
    ]);
  });

  it('table: a row removed by the call says so; rows past ten are counted', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, cells: { n: `v${i}` } }));
    const out = lines(
      'table',
      { columns: [{ id: 'n', label: 'N' }], rows },
      {},
      { p: [{ remove: 'r3' }] },
    );
    expect(out[0]).toBe('13 of 14 rows shown; columns: n');
    expect(out[1]).toBe('r3 (removed): n=v3');
    expect(out.at(-1)).toBe('and 4 more rows');
  });

  it('array: values, pointers and ranges, as [12 19 23 >31< 46 58] lo=0 hi=5 mid=3*', () => {
    const out = lines(
      'array',
      {
        arrays: [{ id: 'xs', label: 'items', cells: [12, 19, 23, 31, 46, 58] }],
        pointers: [
          { id: 'lo', at: 0 },
          { id: 'hi', at: 5 },
          { id: 'mid', at: null },
        ],
        ranges: [{ id: 'window', from: 'lo', to: 'hi' }],
      },
      {},
      { p: [{ update: 'mid', fields: { at: 3 } }, { read: 'xs.3' }] },
    );
    expect(out).toEqual(['items: [12 19 23 >31< 46 58] lo=0 hi=5 mid=3* window=0..5']);
  });

  it('array: a write shows the new value; an absent slot is _', () => {
    const out = lines(
      'array',
      { arrays: [{ id: 'q', cells: [5, 6], length: 4 }] },
      {},
      { p: [{ update: 'q.0', fields: { value: 9 } }, { add: 'q.2' }] },
    );
    expect(out).toEqual(['q: [>9< 6 >_< _]']);
  });

  it('sequence: the message of the call, its style, and the frames and notes', () => {
    const out = lines(
      'sequence',
      {
        styles: { two: 'reply' },
        notes: [{ id: 'n', at: 'two', over: ['a', 'b'], text: 'Both agree' }],
      },
      {},
      {},
      { from: 'b', to: 'a' },
      {},
    );
    expect(out).toEqual(['message "Two": b -> a, drawn as reply', 'note over a to b*: Both agree']);
  });

  it('sequence: the frames that have appeared are listed', () => {
    const out = describeSequence(
      { present: ['a', 'loop'], patches: {}, focus: undefined },
      { fragments: [{ id: 'loop', kind: 'loop', label: 'until done' }] },
      [{ add: 'loop' }],
    );
    expect(out).toEqual(['frames so far: loop [until done]*']);
  });

  it('sequence: a call without from and to says there is no message', () => {
    expect(lines('sequence', {}, {}, {})).toEqual([
      'no message at this call (it has no from and to, or its lanes are not shown)',
    ]);
  });

  it('code: the marked lines with their text, the current line and its badge', () => {
    const out = lines(
      'code',
      {
        sources: [
          {
            id: 'main',
            title: 'main.js',
            lang: 'js',
            text: 'let a = 1;\nlet b = 2;\nreturn a + b;',
          },
        ],
      },
      {},
      {
        p: [
          { read: 'main', lines: [[2, 3]] },
          { update: 'main', fields: { at: 3, badge: 'run 2' } },
        ],
      },
    );
    expect(out).toEqual([
      'main.js (js): 3 lines',
      '  current line 3 badge "run 2": return a + b;',
      '  read line 2: >let b = 2;<',
      '  read line 3: >return a + b;<',
    ]);
  });

  it('code: a transcript says how much is shown', () => {
    const out = lines(
      'code',
      {
        sources: [
          { id: 'sh', title: 'Shell', text: '$ ls\na.txt\n$ pwd\n/home', transcript: true },
        ],
      },
      {},
      { p: [{ update: 'sh', fields: { upto: 2 } }] },
    );
    expect(out).toContain('  transcript: 2 of 4 lines shown; last: a.txt');
  });

  it('payload: the marked fields by path, with their value now', () => {
    const out = lines(
      'payload',
      { payloads: [{ id: 'tok', title: 'Token', value: { sub: 'u1', roles: ['a', 'b'] } }] },
      {},
      {
        p: [
          { update: 'tok', fields: { 'roles.1': 'c' } },
          { read: 'tok', paths: ['sub'] },
        ],
      },
    );
    expect(out).toEqual(['payloads shown: tok*', 'Token.roles.1 = >c<', 'Token.sub = >u1<']);
  });

  it('graph: nodes nested in groups, edges drawn, and what the call touched', () => {
    const out = lines(
      'graph',
      {
        nodes: [
          { id: 'vpc', label: 'VPC' },
          { id: 'web', label: 'Web', parent: 'vpc' },
          { id: 'db', label: 'Db' },
        ],
        edges: [{ from: 'web', to: 'db', label: 'sql' }],
      },
      { p: [{ add: 'vpc' }, { add: 'web' }, { add: 'db' }] },
      { p: [{ add: 'web.db' }, { read: 'web' }] },
    );
    expect(out).toEqual([
      'nodes 3 of 3: vpc "VPC"[web "Web"*], db "Db"',
      'edges 1 of 1: web -> db "sql"*',
    ]);
  });

  it('graph: a record node shows its slots', () => {
    const out = lines(
      'graph',
      {
        nodes: [
          {
            id: 'n1',
            label: 'n1',
            slots: [
              { id: 'val', value: '1' },
              { id: 'next', value: 'null' },
            ],
          },
        ],
        edges: [],
      },
      { p: [{ add: 'n1' }] },
      { p: [{ update: 'n1.next', fields: { value: 'n2' } }] },
    );
    expect(out).toContain('n1: val=1 next=>n2<');
  });

  it('flow: the whole chart is there from the start; the call marks a step', () => {
    const out = lines(
      'flow',
      {
        nodes: [
          { id: 'start', label: 'Start', kind: 'terminal' },
          { id: 'ok', label: 'Ok?', kind: 'decision' },
        ],
        edges: [{ from: 'start', to: 'ok' }],
      },
      {},
      { p: [{ read: 'ok' }] },
    );
    expect(out).toEqual([
      'nodes 2 of 2: start "Start" terminal, ok "Ok?" decision*',
      'edges 1 of 1: start -> ok',
    ]);
  });

  it('boxes: nested as they are drawn', () => {
    const out = lines(
      'boxes',
      {
        boxes: [
          { id: 'app', label: 'App' },
          { id: 'web', label: 'Web', parent: 'app' },
          { id: 'db', label: 'Db', initial: false },
        ],
        edges: [],
      },
      {},
      { p: [{ read: 'web' }] },
    );
    expect(out).toEqual(['boxes 2 of 3: app "App"[web "Web"*]']);
  });

  it('schema: tables with their columns, and relations', () => {
    const out = lines(
      'schema',
      {
        tables: [
          {
            id: 'users',
            label: 'users',
            columns: [{ id: 'id', key: 'PK', type: 'int' }, { id: 'name' }],
          },
          { id: 'orders', label: 'orders', columns: [{ id: 'user_id', key: 'FK' }] },
        ],
        relations: [{ from: 'orders.user_id', to: 'users', label: 'by' }],
      },
      {},
      { p: [{ read: 'orders.user_id' }] },
    );
    expect(out).toEqual([
      'tables 2 of 2',
      'users: PK id:int, name',
      'orders: FK user_id*',
      'relations: orders.user_id -> users "by"',
    ]);
  });

  it('tree: an indented outline, with a collapsed node and what it hides', () => {
    const out = lines(
      'tree',
      {
        nodes: [
          { id: 'root', label: 'root', kind: 'dir' },
          { id: 'src', label: 'src', parent: 'root', kind: 'dir', collapsed: true },
          { id: 'main', label: 'main.ts', parent: 'src' },
          { id: 'docs', label: 'docs', parent: 'root' },
        ],
      },
      {},
      { p: [{ read: 'docs' }] },
    );
    expect(out).toEqual(['4 of 4 nodes shown', 'dir root', '  dir src (+1 hidden)', '  docs*']);
  });

  it('bus: events by partition with offsets and state, groups with lag, producers', () => {
    const out = lines(
      'bus',
      {
        channels: [
          {
            id: 'orders',
            kind: 'topic',
            partitions: ['p0'],
            events: [
              { id: 'e0', partition: 'p0', label: 'order-1' },
              { id: 'e1', partition: 'p0', label: 'order-2' },
            ],
            producers: [{ id: 'shop' }],
            consumers: [{ id: 'worker', group: 'g' }],
            cursors: [{ id: 'g-p0', partition: 'p0', group: 'g', owner: 'worker', at: 0 }],
          },
        ],
      },
      { p: [{ add: 'e0' }] },
      {
        p: [
          { add: 'e1' },
          { update: 'e0', fields: { state: 'acked' } },
          { update: 'g-p0', fields: { at: 1 } },
        ],
      },
    );
    expect(out).toEqual([
      'topic orders',
      '  p0: >0:order-1 acked< >1:order-2<',
      '  group g on p0: committed 1, lag 1, owner worker*',
      '  producers: shop',
      '  consumers: worker',
    ]);
  });

  it('timeline: now, and what has happened on each row by then', () => {
    const out = lines(
      'timeline',
      {
        axis: { unit: 's', to: 60, tick: 10 },
        rows: [{ id: 'w', label: 'worker' }],
        instants: [{ id: 'hb1', row: 'w', at: 5, kind: 'heartbeat', label: 'beat' }],
        spans: [{ id: 'run', row: 'w', from: 2, to: 40, label: 'task' }],
      },
      {},
      { p: [{ update: 'now', fields: { at: 10 } }] },
    );
    expect(out).toEqual(['now = 10 s (axis 0 to 60)*', 'worker: beat@5, task 2..10 (running)']);
  });

  it('bytes: frames with their fields and values, and the cursor', () => {
    const out = lines(
      'bytes',
      {
        frames: [
          {
            id: 'tcp',
            title: 'TCP header',
            unit: 'bits',
            width: 16,
            cursor: { at: 0 },
            fields: [
              { id: 'src', label: 'Source', size: 16, value: 443, decoded: 'https' },
              { id: 'dst', label: 'Dest', size: 16, value: 51000 },
            ],
          },
        ],
      },
      {},
      {
        p: [
          { update: 'tcp.dst', fields: { value: 80 } },
          { update: 'tcp.cursor', fields: { at: 16 } },
        ],
      },
    );
    expect(out).toEqual([
      'TCP header [bits, 16 per row]',
      '  Source=443 (https) | >Dest=80<',
      '  next at 16*',
    ]);
  });

  it('ring: nodes with tokens, and who owns each key', () => {
    const out = lines(
      'ring',
      {
        size: 100,
        replication: 2,
        nodes: [
          { id: 'a', positions: [10] },
          { id: 'b', positions: [50] },
          { id: 'c', positions: [80] },
        ],
        keys: [{ id: 'k1', at: 40 }],
      },
      {},
      { p: [{ update: 'b', fields: { state: 'down' } }] },
    );
    expect(out).toEqual([
      'ring of 100 positions, 2 copies of each key',
      'nodes: a (up) at 10, b (down) at 50*, c (up) at 80',
      'key k1@40: owner c, replicas a (a down node was skipped)',
    ]);
  });
});

describe('describe: fallback and failure', () => {
  it('a panel without describe is described from its element state', () => {
    const registry = testRegistry();
    const result = loadConfig(baseConfig(), registry);
    const walkthrough = result.walkthroughs[0]!;
    const analysis = analyse(walkthrough);
    const trace = traceOf(analysis, [analysis.calls[2]!]);
    const things = trace[0]!.panes.find((pane) => pane.id === 'things')!;
    expect(things.lines[0]).toMatch(/^present 3 of 4: /);
    expect(things.lines.join('\n')).toContain('a*: state="used"');
    expect(things.did).toMatchObject({ updated: ['a'] });
  });

  it('describeGeneric handles a state that is not elements', () => {
    const pane = analyse(loadConfig(baseConfig(), testRegistry()).walkthroughs[0]!);
    const things = pane.walkthrough.panes[0]!;
    expect(describeGeneric(things, { shape: 'other' }, [])).toEqual(['{"shape":"other"}']);
    expect(describeGeneric(things, undefined, [])).toEqual(['undefined']);
  });

  it('a describe that throws is replaced by the generic lines and a note', () => {
    const walkthrough = loadConfig(baseConfig(), testRegistry()).walkthroughs[0]!;
    const pane = {
      ...walkthrough.panes[0]!,
      panel: {
        ...walkthrough.panes[0]!.panel,
        describe: () => {
          throw new Error('boom');
        },
      },
    };
    const result = describePane(
      pane,
      { present: ['seed'], patches: {}, focus: undefined },
      [],
      walkthrough.steps[0]!.calls[0]!,
    );
    expect(result[0]).toBe('present 1 of 4: seed');
    expect(result.at(-1)).toContain('describe failed: boom');
  });

  it('every registered panel type has a describe', () => {
    const registry = createRegistry();
    for (const id of registry.panelIds()) {
      expect(typeof registry.panel(id)!.describe, id).toBe('function');
    }
  });
});
