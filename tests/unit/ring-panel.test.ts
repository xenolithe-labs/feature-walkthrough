import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFolder, formatProblem, loadConfig, type WalkthroughInput } from '../../src/core';
import {
  RingContent,
  arcsOf,
  changedSpans,
  changesOf,
  duplicatePositions,
  holders,
  keyAt,
  levels,
  place,
  ringOf,
  shares,
  spreadAngles,
  type RingState,
} from '../../src/panels/ring/model';
import { createRegistry } from '../../src/registry';
import {
  consistentHashing,
  KEY_NAMES,
  NODE_NAMES,
  SIZE,
} from '../../src/walkthroughs/consistent-hashing';
import { hashPosition, md5 } from '../../src/walkthroughs/ring-hash';

type Effects = Record<string, Record<string, unknown>[]>;
const load = (value: WalkthroughInput) => loadConfig(value, createRegistry());

function config(content: unknown, calls: Effects[] = [{}]): WalkthroughInput {
  return {
    id: 'r',
    title: 'R',
    layout: { panes: [{ id: 'ring', panel: 'ring', content }] },
    steps: [
      {
        id: 's1',
        title: 'S1',
        calls: calls.map((effects, index) => ({
          id: `c${index + 1}`,
          label: `Call ${index + 1}`,
          effects: effects as never,
        })),
      },
    ],
  };
}

const base = {
  size: 100,
  replication: 2,
  nodes: [
    { id: 'a', positions: [10] },
    { id: 'b', positions: [40] },
    { id: 'c', positions: [70] },
  ],
  keys: [
    { id: 'k1', at: 5 },
    { id: 'k2', at: 10 },
    { id: 'k3', at: 11 },
    { id: 'k4', at: 75 },
    { id: 'k5', at: 99 },
  ],
};

const rules = (value: WalkthroughInput) =>
  load(value).problems.map((problem) => `${problem.severity} ${problem.rule}`);

const stateAt = (value: WalkthroughInput, c: number) => {
  const w = load(value).walkthroughs[0]!;
  return {
    state: createFolder(w).at(0, c)['ring']!.state as RingState,
    content: RingContent.parse(w.panes[0]!.content),
  };
};

// ---- the hash ---------------------------------------------------------------------------------

describe('the demo hash', () => {
  const samples = [
    '',
    'a',
    'abc',
    'user:100',
    'node-13',
    'x'.repeat(55),
    'x'.repeat(56),
    'x'.repeat(64),
    'x'.repeat(200),
    'héllo wörld ✓',
  ];
  it('is MD5: it agrees with node:crypto', () => {
    for (const text of samples) {
      expect(md5(text)).toBe(createHash('md5').update(text).digest('hex'));
    }
  });

  it('maps the 128-bit digest to a position by mod', () => {
    for (const text of samples) {
      const big = BigInt(`0x${createHash('md5').update(text).digest('hex')}`);
      expect(hashPosition(text, 1000)).toBe(Number(big % 1000n));
    }
  });

  it('puts the demo nodes and keys where their names hash, with no two tokens together', () => {
    const content = RingContent.parse(consistentHashing.layout.panes[0]!.content);
    const expected = (name: string) =>
      Number(BigInt(`0x${createHash('md5').update(name).digest('hex')}`) % BigInt(SIZE));
    for (const node of content.nodes) expect(node.positions).toEqual([expected(node.id)]);
    for (const key of content.keys) {
      expect(key.at).toBe(expected(key.label!));
    }
    const positions = content.nodes.flatMap((node) => node.positions);
    expect(new Set(positions).size).toBe(positions.length);
    expect(KEY_NAMES).toHaveLength(12);
    expect(NODE_NAMES).toHaveLength(4);
  });
});

// ---- an independent implementation ------------------------------------------------------------

/**
 * Consistent hashing written a different way from the panel's: no sorted walk and no search.
 * Each token is ranked by its clockwise distance from the key (a token at the key is at
 * distance 0), and the holders are the first distinct healthy nodes in that ranking.
 */
interface Model {
  size: number;
  replication: number;
  nodes: Map<string, { present: boolean; down: boolean; tokens: number[] }>;
  keys: Map<string, { present: boolean; at: number }>;
}

function modelOf(content: RingContent): Model {
  return {
    size: content.size,
    replication: content.replication,
    nodes: new Map(
      content.nodes.map((node) => [
        node.id,
        {
          present: node.initial ?? content.initial,
          down: node.state === 'down',
          tokens: [...node.positions],
        },
      ]),
    ),
    keys: new Map(
      content.keys.map((key) => [key.id, { present: key.initial ?? content.initial, at: key.at }]),
    ),
  };
}

function apply(model: Model, effect: Record<string, unknown>): void {
  const fields = (effect.fields ?? {}) as Record<string, unknown>;
  const verb = (['add', 'remove', 'update', 'read'] as const).find((v) => effect[v] !== undefined)!;
  const id = effect[verb] as string;
  const node = model.nodes.get(id);
  const key = model.keys.get(id);
  if (verb === 'add' && node) node.present = true;
  else if (verb === 'remove' && node) node.present = false;
  else if (verb === 'add' && key) key.present = true;
  else if (verb === 'remove' && key) key.present = false;
  else if (verb === 'update') {
    if (node && fields.state !== undefined) node.down = fields.state === 'down';
    if (key && typeof fields.at === 'number') key.at = fields.at;
    const [owner, index] = id.split('.');
    const token = model.nodes.get(owner!);
    if (token && index !== undefined && typeof fields.at === 'number') {
      token.tokens[Number(index)] = fields.at;
    }
  }
}

function holdersIndependent(model: Model, keyAtPosition: number): string[] {
  const ranked: { node: string; distance: number }[] = [];
  for (const [id, node] of model.nodes) {
    if (!node.present || node.down) continue;
    for (const token of node.tokens) {
      ranked.push({
        node: id,
        distance: (((token - keyAtPosition) % model.size) + model.size) % model.size,
      });
    }
  }
  ranked.sort((a, b) => a.distance - b.distance);
  const out: string[] = [];
  for (const { node } of ranked) {
    if (!out.includes(node)) out.push(node);
    if (out.length === model.replication) break;
  }
  return out;
}

function snapshot(model: Model) {
  return new Map(
    [...model.keys]
      .filter(([, key]) => key.present)
      .map(([id, key]) => [id, holdersIndependent(model, key.at)] as const),
  );
}

describe('ring panel: an independent implementation agrees', () => {
  const result = load(consistentHashing as unknown as WalkthroughInput);
  const walkthrough = result.walkthroughs[0]!;
  const content = RingContent.parse(walkthrough.panes[0]!.content);
  const folder = createFolder(walkthrough);

  it('loads with no problems', () => {
    expect(result.problems.map(formatProblem)).toEqual([]);
  });

  it('gives the same owner, replicas and moved keys at every call of the demo', () => {
    const model = modelOf(content);
    let previous = snapshot(model);
    let checked = 0;
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        for (const effect of call.effects?.['ring'] ?? []) apply(model, effect as never);
        const now = snapshot(model);
        const view = folder.at(s, c)['ring']!;
        const state = view.state as RingState;
        const ring = ringOf(content, state);

        // Owner and replicas of every key that is in the ring.
        for (const key of content.keys) {
          const expected = now.get(key.id);
          if (expected === undefined) {
            expect(state.present).not.toContain(key.id);
            continue;
          }
          const placement = place(ring, keyAt(key, state));
          expect(holders(placement), `${call.id} ${key.id}`).toEqual(expected);
          checked += 1;
        }

        // The keys that changed owner in this call.
        const wasPresent = (id: string) => previous.has(id) && now.has(id);
        const moved = [...now.keys()]
          .filter((id) => wasPresent(id) && previous.get(id)![0] !== now.get(id)![0])
          .sort();
        const changed =
          state.before?.call === call.id && (call.effects?.['ring'] ?? []).length > 0
            ? changesOf(content, state.before, state)
                .filter((change) => change.kind === 'owner')
                .map((change) => change.key)
                .sort()
            : [];
        expect(changed, `${call.id} moved`).toEqual(moved);
        previous = now;
      });
    });
    expect(checked).toBeGreaterThan(40);
  });

  it('agrees with the table the demo writes: owner before and after, and what moved', () => {
    const rows = (
      walkthrough.panes[1]!.content as { rows: { id: string; cells: Record<string, string> }[] }
    ).rows;
    const scenarios: Record<string, [Model, Model]> = {};
    const build = (joined: boolean, down: boolean) => {
      const model = modelOf(content);
      model.nodes.get('node-10')!.present = joined;
      model.nodes.get('node-6')!.down = down;
      return model;
    };
    scenarios['check'] = [build(false, false), build(true, false)];
    scenarios['down-owners'] = [build(true, false), build(true, true)];
    scenarios['up-owners'] = [build(true, true), build(true, false)];
    let compared = 0;
    walkthrough.steps.forEach((step, s) =>
      step.calls.forEach((call, c) => {
        const scenario = scenarios[call.id];
        if (scenario === undefined) return;
        const state = folder.at(s, c)['owners']!.state as {
          patches: Record<string, Record<string, string>>;
        };
        for (const key of content.keys) {
          const row = rows.find((item) => item.id === key.id)!;
          const cell = (column: string) => state.patches[key.id]?.[column] ?? row.cells[column];
          const was = holdersIndependent(scenario[0], key.at)[0]!;
          const now = holdersIndependent(scenario[1], key.at)[0]!;
          expect(cell('before'), `${call.id} ${key.id}`).toBe(was);
          expect(cell('after'), `${call.id} ${key.id}`).toBe(now);
          expect(cell('moved'), `${call.id} ${key.id}`).toBe(was === now ? '' : 'moved');
          compared += 1;
        }
      }),
    );
    expect(compared).toBe(3 * content.keys.length);
  });

  it('does not count a key that is added in the call that moves the others', () => {
    const before = { present: ['node-1', 'node-6', 'node-13'], patches: {} };
    const after = { present: [...before.present, 'node-10', 'user-105'], patches: {} };
    const moved = changesOf(content, before, after).map((change) => change.key);
    expect(moved).not.toContain('user-105');
  });

  it('moves only the keys in one arc when the fourth node joins, and marks that arc', () => {
    const joinCall = walkthrough.steps
      .flatMap((step, s) => step.calls.map((call, c) => ({ call, s, c })))
      .find(({ call }) => call.id === 'add')!;
    const state = folder.at(joinCall.s, joinCall.c)['ring']!.state as RingState;
    const changes = changesOf(content, state.before!, state).filter(
      (change) => change.kind === 'owner',
    );
    expect(changes.length).toBeGreaterThan(1);
    expect(changes.length).toBeLessThan(content.keys.length);
    for (const change of changes) {
      expect(change.from.owner).toBe('node-13');
      expect(change.to.owner).toBe('node-10');
    }
    const spans = changedSpans(content, state.before!, state);
    expect(spans).toHaveLength(1);
    const arc = arcsOf(ringOf(content, state)).find((item) => item.token.node === 'node-10')!;
    expect(spans[0]).toEqual({ from: arc.from, to: arc.to });
  });
});

// ---- ownership --------------------------------------------------------------------------------

describe('ring panel: ownership and replicas', () => {
  const content = RingContent.parse(base);
  const ring = (patch: Record<string, unknown> = {}, present?: string[]) =>
    ringOf(content, {
      present: present ?? ['a', 'b', 'c'],
      patches: patch as never,
    });

  it('a key belongs to the first token at or after it, and a key on a token belongs to it', () => {
    const r = ring();
    expect(place(r, 5).owner).toBe('a');
    expect(place(r, 10).owner).toBe('a');
    expect(place(r, 11).owner).toBe('b');
    expect(place(r, 40).owner).toBe('b');
    expect(place(r, 41).owner).toBe('c');
  });

  it('wraps past the end of the space', () => {
    const r = ring();
    expect(holders(place(r, 99))).toEqual(['a', 'b']);
    expect(holders(place(r, 75))).toEqual(['a', 'b']);
    expect(place(r, 0).walk.map((visit) => visit.token.id)).toEqual(['a.0', 'b.0']);
  });

  it('the replicas are the next distinct nodes, so more tokens of one node are passed over', () => {
    const vnodes = RingContent.parse({
      size: 100,
      replication: 3,
      nodes: [
        { id: 'a', positions: [10, 20, 30] },
        { id: 'b', positions: [25, 80] },
        { id: 'c', positions: [50] },
      ],
    });
    const r = ringOf(vnodes, { present: ['a', 'b', 'c'], patches: {} });
    const placement = place(r, 5);
    expect(holders(placement)).toEqual(['a', 'b', 'c']);
    expect(placement.walk.map((visit) => `${visit.token.id}:${visit.role}`)).toEqual([
      'a.0:owner',
      'a.1:again',
      'b.0:replica',
      'a.2:again',
      'c.0:replica',
    ]);
  });

  it('a down node is skipped, a suspect node is not, and the owner and replicas move on', () => {
    const down = ring({ b: { state: 'down' } });
    const placement = place(down, 11);
    expect(placement.owner).toBe('c');
    expect(placement.replicas).toEqual(['a']);
    expect(placement.preference).toEqual(['b', 'c']);
    expect(placement.hinted).toBe(true);
    expect(placement.walk.map((visit) => visit.role)).toEqual(['skipped', 'owner', 'replica']);
    const suspect = ring({ b: { state: 'suspect' } });
    expect(place(suspect, 11).owner).toBe('b');
    expect(place(suspect, 11).hinted).toBe(false);
  });

  it('has fewer holders than the factor when too few nodes are healthy, and none when none are', () => {
    const one = ring({ a: { state: 'down' }, b: { state: 'down' } });
    expect(holders(place(one, 5))).toEqual(['c']);
    const none = ring({ a: { state: 'down' }, b: { state: 'down' }, c: { state: 'down' } });
    expect(place(none, 5).owner).toBeUndefined();
    const empty = ring({}, []);
    expect(place(empty, 5).owner).toBeUndefined();
    expect(arcsOf(empty)).toEqual([]);
  });

  it('a ring of one token has one arc, the whole space', () => {
    const single = ringOf(RingContent.parse({ size: 100, nodes: [{ id: 'a', positions: [30] }] }), {
      present: ['a'],
      patches: {},
    });
    const [arc] = arcsOf(single);
    expect(arc).toMatchObject({ from: -70, to: 30, length: 100, owner: 'a' });
    expect(place(single, 99).owner).toBe('a');
  });

  it('arcs tile the space, and shares add up to one', () => {
    const r = ring();
    expect(arcsOf(r).reduce((sum, arc) => sum + arc.length, 0)).toBe(100);
    expect(arcsOf(r).map((arc) => [arc.token.node, arc.length])).toEqual([
      ['a', 40],
      ['b', 30],
      ['c', 30],
    ]);
    const s = shares(r);
    expect(s.get('a')).toBeCloseTo(0.4);
    expect([...s.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it('a down node hands its arcs, and its share, to the next healthy node', () => {
    const r = ring({ b: { state: 'down' } });
    const arc = arcsOf(r).find((item) => item.home === 'b')!;
    expect(arc.owner).toBe('c');
    expect(shares(r).get('b')).toBe(0);
    expect(shares(r).get('c')).toBeCloseTo(0.6);
  });

  it('works out the arc that changed hands by brute force', () => {
    const after = { present: ['a', 'b', 'c'], patches: { 'a.0': { at: 55 } } };
    const before = { present: ['a', 'b', 'c'], patches: {} };
    const spans = changedSpans(content, before, after);
    const was = ringOf(content, before);
    const now = ringOf(content, after);
    const inSpan = (x: number) => spans.some((span) => x > span.from && x <= span.to);
    for (let x = 0; x < 100; x += 1) {
      const differs = place(was, x).owner !== place(now, x).owner;
      // Position 0 is also position 100, the end of the last arc.
      expect(inSpan(x === 0 ? 100 : x), `position ${x}`).toBe(differs);
    }
  });

  it('finds replica-only changes apart from owner changes', () => {
    const before = { present: ['a', 'b', 'c', 'k1', 'k4'], patches: {} };
    const after = { present: ['a', 'b', 'k1', 'k4'], patches: {} };
    const changes = changesOf(content, before, after);
    // Without c, k4 (at 75) goes from owner a, replica b to the same: unchanged;
    // k1 (at 5) is a's, replica b: unchanged. Keys owned by c do not exist here.
    expect(changes).toEqual([]);
    // Moving c between a and b changes which node follows a: the replicas of its keys change.
    const moved = changesOf(content, before, { ...before, patches: { 'c.0': { at: 20 } } });
    expect(moved.map((change) => [change.key, change.kind])).toEqual([
      ['k1', 'replicas'],
      ['k4', 'replicas'],
    ]);
  });

  it('reports tokens that share a position', () => {
    const r = ring({ 'b.0': { at: 10 } });
    expect(duplicatePositions(r).map((group) => group.map((token) => token.id))).toEqual([
      ['a.0', 'b.0'],
    ]);
    expect(duplicatePositions(ring())).toEqual([]);
  });
});

// ---- the reducer ------------------------------------------------------------------------------

describe('ring panel: reducer and state', () => {
  const calls: Effects[] = [
    { ring: [{ update: 'b.0', fields: { at: 55 } }] },
    { ring: [{ remove: 'b' }] },
    { ring: [{ add: 'b' }] },
    {
      ring: [
        { update: 'a', fields: { state: 'down' } },
        { update: 'c', fields: { state: 'suspect' } },
      ],
    },
    {},
  ];

  it('notes the state at the start of each call, once', () => {
    const w = (c: number) => stateAt(config({ ...base, nodes: base.nodes }, calls), c).state;
    expect(w(0).before?.call).toBe('c1');
    expect(w(0).before?.patches).toEqual({});
    expect(w(1).before?.call).toBe('c2');
    expect(w(1).before?.patches['b.0']?.at).toBe(55);
    expect(w(3).before?.call).toBe('c4');
    // The two effects of one call share one starting state.
    expect(w(3).before?.patches['a']).toBeUndefined();
    // A call with no effects here leaves the note of an earlier call.
    expect(w(4).before?.call).toBe('c4');
  });

  it('a node that leaves takes the moved positions of its tokens with it, and keeps its state', () => {
    const { state } = stateAt(config(base, calls), 2);
    expect(state.present).toContain('b');
    expect(state.patches['b.0']).toBeUndefined();
    const left = stateAt(config(base, calls), 1).state;
    expect(left.present).not.toContain('b');
    expect(left.patches['b.0']).toBeUndefined();
  });

  it('a node that is down or suspect shows in the ring', () => {
    const { state, content } = stateAt(config(base, calls), 3);
    const r = ringOf(content, state);
    expect(r.nodes.map((node) => `${node.id}:${node.state}`)).toEqual([
      'a:down',
      'b:up',
      'c:suspect',
    ]);
  });

  it('moves a token with one update, and the ring follows', () => {
    const { state, content } = stateAt(config(base, calls), 0);
    expect(ringOf(content, state).tokens.map((token) => `${token.id}@${token.at}`)).toEqual(
      ['a.0@10', 'c.0@70', 'b.0@55'].sort(
        (x, y) => Number(x.split('@')[1]) - Number(y.split('@')[1]),
      ),
    );
  });

  it('the fold equals a recompute at every call', () => {
    const w = load(config(base, calls)).walkthroughs[0]!;
    const folder = createFolder(w);
    for (const c of [0, 1, 2, 3, 4, 3, 1, 0]) {
      expect(folder.at(0, c)).toEqual(folder.fromZero(0, c));
    }
  });

  it('declares nodes, their tokens and keys; tokens start present, nodes may not', () => {
    const pane = load(
      config({
        ...base,
        nodes: [
          { id: 'a', positions: [1, 2] },
          { id: 'b', positions: [3], initial: false },
        ],
      }),
    ).walkthroughs[0]!.panes[0]!;
    expect(pane.entities.map((entity) => entity.id)).toEqual([
      'a',
      'a.0',
      'a.1',
      'b',
      'b.0',
      'k1',
      'k2',
      'k3',
      'k4',
      'k5',
    ]);
    expect(pane.entities.find((entity) => entity.id === 'b')!.initial).toBe(false);
    expect(pane.entities.find((entity) => entity.id === 'b.0')!.initial).toBe(true);
  });
});

// ---- lint -------------------------------------------------------------------------------------

describe('ring panel: lint', () => {
  const ok = (calls: Effects[] = [{}], content: unknown = base) => rules(config(content, calls));

  it('accepts a good config', () => {
    expect(ok([{ ring: [{ read: 'k1' }] }])).toEqual([]);
  });

  it('rejects positions outside the space, or not whole numbers, in tokens and keys', () => {
    expect(ok([{}], { ...base, nodes: [{ id: 'a', positions: [100] }], replication: 1 })).toEqual([
      'error ring/position-out-of-range',
    ]);
    expect(ok([{}], { ...base, nodes: [{ id: 'a', positions: [-1] }], replication: 1 })).toEqual([
      'error ring/position-out-of-range',
    ]);
    expect(ok([{}], { ...base, nodes: [{ id: 'a', positions: [2.5] }], replication: 1 })).toEqual([
      'error ring/position-out-of-range',
    ]);
    expect(ok([{}], { ...base, keys: [{ id: 'k', at: 1000 }] })).toEqual([
      'error ring/position-out-of-range',
    ]);
  });

  it('rejects an update that moves a token or key out of the space', () => {
    expect(ok([{ ring: [{ update: 'a.0', fields: { at: 100 } }] }])).toEqual([
      'error ring/position-out-of-range',
    ]);
    expect(ok([{ ring: [{ update: 'k1', fields: { at: -3 } }] }])).toEqual([
      'error ring/position-out-of-range',
    ]);
  });

  it('rejects two tokens at one position, in the content and after a move', () => {
    expect(
      ok([{}], {
        ...base,
        nodes: [
          { id: 'a', positions: [10, 20] },
          { id: 'b', positions: [20] },
        ],
        replication: 2,
      }),
    ).toEqual(['error ring/duplicate-position']);
    expect(ok([{ ring: [{ update: 'b.0', fields: { at: 70 } }] }])).toEqual([
      'error ring/duplicate-position',
    ]);
  });

  it('reports a duplicate once, not at every later call', () => {
    const found = ok([
      { ring: [{ update: 'b.0', fields: { at: 70 } }] },
      { ring: [{ read: 'k1' }] },
      { ring: [{ read: 'k2' }] },
    ]);
    expect(found).toEqual(['error ring/duplicate-position']);
  });

  it('a token of a node that has not joined does not count as a duplicate, until it joins', () => {
    const content = {
      ...base,
      nodes: [...base.nodes.slice(0, 2), { id: 'c', positions: [40], initial: false }],
    };
    expect(ok([{}], content)).toEqual([]);
    expect(ok([{ ring: [{ add: 'c' }] }], content)).toEqual(['error ring/duplicate-position']);
  });

  it('a duplicate that is resolved by a later move is still reported where it happened', () => {
    expect(
      ok([
        { ring: [{ update: 'b.0', fields: { at: 70 } }] },
        { ring: [{ update: 'b.0', fields: { at: 41 } }] },
      ]),
    ).toEqual(['error ring/duplicate-position']);
  });

  it('rejects a replication factor above the number of nodes', () => {
    expect(ok([{}], { ...base, replication: 4 })).toEqual(['error ring/replication-too-high']);
    expect(ok([{}], { ...base, replication: 3 })).toEqual([]);
  });

  it('warns when a call leaves fewer healthy nodes than the factor', () => {
    expect(
      ok([
        {
          ring: [
            { update: 'a', fields: { state: 'down' } },
            { update: 'b', fields: { state: 'down' } },
          ],
        },
      ]),
    ).toEqual(['warning ring/under-replicated']);
    expect(ok([{ ring: [{ remove: 'a' }] }, { ring: [{ remove: 'b' }] }])).toEqual([
      'warning ring/under-replicated',
    ]);
  });

  it('refuses add and remove on a token, and a token of a node that is not in the ring', () => {
    expect(ok([{ ring: [{ add: 'a.0' }] }])).toContain('error ring/token-effect');
    expect(ok([{ ring: [{ remove: 'a.0' }] }])).toContain('error ring/token-effect');
    expect(ok([{ ring: [{ remove: 'a' }, { update: 'a.0', fields: { at: 11 } }] }])).toContain(
      'error ring/absent-token',
    );
    expect(ok([{ ring: [{ remove: 'a' }, { read: 'a.0' }] }])).toContain('error ring/absent-token');
    expect(
      ok([{ ring: [{ remove: 'a' }] }, { ring: [{ add: 'a' }, { read: 'a.0' }] }]),
    ).not.toContain('error ring/absent-token');
  });

  it('refuses unknown ids, unknown fields and bad values', () => {
    expect(ok([{ ring: [{ read: 'nope' }] }])).toEqual(['error unknown-id']);
    expect(ok([{ ring: [{ update: 'a.1', fields: { at: 3 } }] }])).toEqual(['error unknown-id']);
    expect(ok([{ ring: [{ update: 'a', fields: { colour: 'red' } }] }])).toEqual([
      'error ring/unknown-field',
    ]);
    expect(ok([{ ring: [{ update: 'a', fields: { at: 3 } }] }])).toEqual([
      'error ring/unknown-field',
    ]);
    expect(ok([{ ring: [{ update: 'a', fields: { state: 'asleep' } }] }])).toEqual([
      'error ring/bad-field',
    ]);
    expect(ok([{ ring: [{ update: 'a', fields: { state: 3 } }] }])).toEqual([
      'error ring/bad-field',
    ]);
    expect(ok([{ ring: [{ update: 'a.0', fields: { at: '12' } }] }])).toEqual([
      'error ring/bad-field',
    ]);
    expect(ok([{ ring: [{ update: 'a', fields: { label: 4 } }] }])).toEqual([
      'error ring/bad-field',
    ]);
    expect(ok([{ ring: [{ update: 'a', fields: { tone: 'loud' } }] }])).toEqual([
      'error ring/bad-tone',
    ]);
  });

  it('refuses a state that is not a state in the content, and a missing size', () => {
    expect(
      ok([{}], { ...base, nodes: [{ id: 'a', positions: [1], state: 'gone' }], replication: 1 }),
    ).toEqual(['error schema']);
    expect(ok([{}], { nodes: base.nodes })).toEqual(['error schema']);
    expect(ok([{}], { ...base, nodes: [{ id: 'a', positions: [] }], replication: 1 })).toEqual([
      'error schema',
    ]);
  });

  it('an id that looks inherited is not found', () => {
    expect(ok([{ ring: [{ update: 'constructor', fields: { state: 'down' } }] }])).toEqual([
      'error unknown-id',
    ]);
  });
});

// ---- drawing helpers --------------------------------------------------------------------------

describe('ring panel: label and key placement', () => {
  it('spreads angles that are too close and leaves the others alone', () => {
    const out = spreadAngles([10, 12, 14, 200], 13);
    const sorted = [...out].sort((a, b) => a - b);
    for (let i = 1; i < 3; i += 1)
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(13 - 1e-6);
    expect(out[3]).toBe(200);
    expect(spreadAngles([5], 13)).toEqual([5]);
  });

  it('spreads across the top of the circle too', () => {
    const out = spreadAngles([359, 1, 2], 13);
    const norm = out.map((value) => ((value % 360) + 360) % 360).sort((a, b) => a - b);
    const gaps = norm.map((value, i) => (norm[(i + 1) % 3]! - value + 360) % 360);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(13 - 1e-6);
  });

  it('gives up, unchanged, when the labels cannot fit', () => {
    const many = Array.from({ length: 40 }, (_, i) => i);
    expect(spreadAngles(many, 13)).toEqual(many);
  });

  it('alternates the level of marks that are close', () => {
    expect(levels([10, 12, 14, 100], 9)).toEqual([0, 1, 0, 0]);
  });
});
