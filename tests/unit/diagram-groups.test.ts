import { describe, expect, it } from 'vitest';
import { createFolder, loadConfig, type ElementsState } from '../../src/core';
import {
  GROUP_PAD,
  ancestorsOf,
  crossingPoint,
  crossingsOf,
  layeredGroups,
  litGroups,
  parentMap,
  pinnedGroups,
} from '../../src/panels/_diagram/groups';
import { ICON_NAMES, resolveIcon } from '../../src/panels/_diagram/icons';
import { layered, layout, type LayoutNode, type Positions } from '../../src/panels/_diagram/layout';
import { createRegistry } from '../../src/registry';
import { awsVpcRequest } from '../../src/walkthroughs/aws-vpc-request';

type N = { id: string; parent?: string; parents?: string[]; boundary?: boolean; icon?: string };

const node = (id: string, parent?: string, extra: Partial<LayoutNode> = {}): LayoutNode => ({
  id,
  width: 120,
  height: 40,
  parent,
  ...extra,
});
const edge = (source: string, target: string) => ({ id: `${source}.${target}`, source, target });

/** Absolute boxes from relative positions. */
function absolute(nodes: readonly LayoutNode[], positions: Positions) {
  const parent = parentMap(nodes);
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const n of nodes) {
    let x = positions[n.id]!.x;
    let y = positions[n.id]!.y;
    for (const up of ancestorsOf(n.id, parent)) {
      x += positions[up]!.x;
      y += positions[up]!.y;
    }
    boxes.set(n.id, {
      x,
      y,
      w: positions[n.id]!.width ?? n.width,
      h: positions[n.id]!.height ?? n.height,
    });
  }
  return boxes;
}

/** A VPC with zones, subnets and leaves, and edges between leaves in different places. */
function topology(leaves: number, zones: number, subnetsPerZone: number) {
  const nodes: LayoutNode[] = [node('vpc')];
  const edges: ReturnType<typeof edge>[] = [];
  const leafIds: string[] = [];
  for (let z = 0; z < zones; z += 1) {
    nodes.push(node(`z${z}`, 'vpc'));
    for (let s = 0; s < subnetsPerZone; s += 1) nodes.push(node(`z${z}s${s}`, `z${z}`));
  }
  for (let i = 0; i < leaves; i += 1) {
    const z = i % zones;
    const s = Math.floor(i / zones) % subnetsPerZone;
    nodes.push(node(`n${i}`, `z${z}s${s}`));
    leafIds.push(`n${i}`);
  }
  nodes.push(node('user'));
  edges.push(edge('user', 'n0'));
  for (let i = 1; i < leaves; i += 1) {
    edges.push(edge(`n${Math.floor((i - 1) / 2)}`, `n${i}`));
    if (i % 5 === 0) edges.push(edge(`n${i}`, `n${(i * 7) % leaves}`));
  }
  return { nodes, edges, leafIds };
}

describe('layout with groups', () => {
  const nodes = [
    node('vpc'),
    node('a', 'vpc'),
    node('b', 'vpc'),
    node('x', 'a'),
    node('y', 'b'),
    node('z'),
  ];
  const edges = [
    edge('z', 'x'),
    edge('x', 'y'),
    edge('z', 'vpc'),
    edge('vpc', 'x'),
    edge('x', 'x'),
  ];

  it('keeps children inside their group, relative to it, with room for the label', async () => {
    const positions = await layout(nodes, edges, 'RIGHT');
    const boxes = absolute(nodes, positions);
    for (const [child, parent] of [
      ['x', 'a'],
      ['y', 'b'],
      ['a', 'vpc'],
      ['b', 'vpc'],
    ] as const) {
      const c = boxes.get(child)!;
      const p = boxes.get(parent)!;
      expect(c.x).toBeGreaterThanOrEqual(p.x + GROUP_PAD.side - 0.5);
      expect(c.y).toBeGreaterThanOrEqual(p.y + GROUP_PAD.top - 0.5);
      expect(c.x + c.w).toBeLessThanOrEqual(p.x + p.w);
      expect(c.y + c.h).toBeLessThanOrEqual(p.y + p.h);
    }
  });

  it('takes edges that end at a group, and ignores an edge to a node inside', async () => {
    // z -> vpc is kept; vpc -> x joins a group and its own descendant, so it is left out.
    const positions = await layout(nodes, edges, 'DOWN');
    expect(Object.keys(positions).sort()).toEqual(['a', 'b', 'vpc', 'x', 'y', 'z']);
  });

  it('gives the same answer every time, whatever order the elements come in the call', async () => {
    const first = await layout(nodes, edges, 'RIGHT');
    expect(await layout([...nodes], [...edges], 'RIGHT')).toEqual(first);
  });

  it('honours a group minimum size in both directions', async () => {
    const wide = [{ ...node('g'), width: 300, height: 90 }, node('c', 'g')];
    for (const direction of ['RIGHT', 'DOWN'] as const) {
      const positions = await layout(wide, [], direction);
      expect(positions.g!.width).toBeGreaterThanOrEqual(300);
      expect(positions.g!.height).toBeGreaterThanOrEqual(90);
    }
  });

  it('reserves a position in every group a node may move to', async () => {
    const movable = [
      node('vpc'),
      node('a', 'vpc'),
      node('b', 'vpc'),
      node('m', 'a', { parents: ['a', 'b'] }),
      node('other', 'b'),
    ];
    const positions = await layout(movable, [edge('m', 'other')], 'RIGHT');
    expect(positions['m:b']).toBeDefined();
    expect(positions['m:a']).toBeUndefined();
    // b is as big as it needs to be for both of its nodes, wherever m is.
    const boxes = absolute(movable, positions);
    const b = boxes.get('b')!;
    const slot = positions['m:b']!;
    expect(slot.x + 120 + GROUP_PAD.side).toBeLessThanOrEqual(b.w + 0.5);
    expect(slot.y + 40 + GROUP_PAD.bottom).toBeLessThanOrEqual(b.h + 0.5);
    // The reserved position does not overlap the node already in b.
    const other = positions.other!;
    const apart =
      slot.x + 120 <= other.x ||
      other.x + 120 <= slot.x ||
      slot.y + 40 <= other.y ||
      other.y + 40 <= slot.y;
    expect(apart).toBe(true);
  });

  it('moving a node does not change any other position: layout never sees where it is now', async () => {
    const movable = [node('a'), node('b'), node('m', 'a', { parents: ['a', 'b'] }), node('k', 'b')];
    const before = await layout(movable, [], 'RIGHT');
    // The layout input has only the declared parent, so a move cannot reach it.
    expect(
      await layout(
        movable.map((n) => ({ ...n })),
        [],
        'RIGHT',
      ),
    ).toEqual(before);
  });

  it('pinned positions are relative to the parent, and groups are sized from their contents', () => {
    const fixed = [
      node('g', undefined, { x: 10, y: 20 }),
      node('c', 'g', { x: 14, y: 40 }),
      node('d', 'g', { x: 160, y: 60 }),
    ];
    const positions = pinnedGroups(fixed)!;
    expect(positions.c).toEqual({ x: 14, y: 40 });
    expect(positions.g!.x).toBe(10);
    expect(positions.g!.width).toBe(160 + 120 + GROUP_PAD.side);
    expect(positions.g!.height).toBe(60 + 40 + GROUP_PAD.bottom);
    expect(pinnedGroups([fixed[0]!, node('c', 'g')])).toBeUndefined();
  });

  it('the fast layout is group-aware: contents sit inside their group, edges are lifted', () => {
    const t = topology(24, 3, 2);
    const positions = layeredGroups(t.nodes, t.edges, 'RIGHT', layered);
    const boxes = absolute(t.nodes, positions);
    for (const n of t.nodes) {
      const parent = parentMap(t.nodes).get(n.id);
      if (parent === undefined) continue;
      const c = boxes.get(n.id)!;
      const p = boxes.get(parent)!;
      expect(c.x).toBeGreaterThanOrEqual(p.x);
      expect(c.y).toBeGreaterThanOrEqual(p.y + GROUP_PAD.top - 0.5);
      expect(c.x + c.w).toBeLessThanOrEqual(p.x + p.w + 0.5);
      expect(c.y + c.h).toBeLessThanOrEqual(p.y + p.h + 0.5);
    }
  });

  it('siblings never overlap, in either layout', async () => {
    const t = topology(40, 3, 3);
    for (const positions of [
      await layout(t.nodes, t.edges, 'RIGHT'),
      layeredGroups(t.nodes, t.edges, 'RIGHT', layered),
    ]) {
      const parent = parentMap(t.nodes);
      const boxes = absolute(t.nodes, positions);
      const bySibling = new Map<string, string[]>();
      for (const n of t.nodes) {
        const key = parent.get(n.id) ?? '';
        bySibling.set(key, [...(bySibling.get(key) ?? []), n.id]);
      }
      for (const ids of bySibling.values()) {
        for (const [i, a] of ids.entries()) {
          for (const b of ids.slice(i + 1)) {
            const p = boxes.get(a)!;
            const q = boxes.get(b)!;
            const apart =
              p.x + p.w <= q.x + 0.5 ||
              q.x + q.w <= p.x + 0.5 ||
              p.y + p.h <= q.y + 0.5 ||
              q.y + q.h <= p.y + 0.5;
            expect(apart, `${a} and ${b}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('layout of a compound diagram at scale (measured)', () => {
  /** Straight edges are drawn between boxes: count how many pass through an unrelated leaf. */
  function throughNodes(
    nodes: LayoutNode[],
    edges: ReturnType<typeof edge>[],
    positions: Positions,
  ) {
    const boxes = absolute(nodes, positions);
    const parent = parentMap(nodes);
    const holders = new Set(parent.values());
    let count = 0;
    for (const e of edges) {
      const a = boxes.get(e.source)!;
      const b = boxes.get(e.target)!;
      const ends = [
        { x: a.x + a.w / 2, y: a.y + a.h / 2 },
        { x: b.x + b.w / 2, y: b.y + b.h / 2 },
      ];
      for (const n of nodes) {
        if (holders.has(n.id) || n.id === e.source || n.id === e.target) continue;
        const r = boxes.get(n.id)!;
        const hit = crossingPoint({ x: r.x, y: r.y, width: r.w, height: r.h }, ends[0]!, ends[1]!);
        if (hit !== undefined) {
          count += 1;
          break;
        }
      }
    }
    return count;
  }

  /** Each node's position relative to its parent, so that moving a whole group is not counted. */
  const relative = (positions: Positions) =>
    Object.fromEntries(
      Object.entries(positions).map(([id, p]) => [id, [Math.round(p.x), Math.round(p.y)]]),
    );

  it('60 to 100 nodes in 10 to 15 groups lay out fast, deterministically, with measured crossings', async () => {
    const report: string[] = [];
    for (const [leaves, zones, subnets] of [
      [48, 3, 3],
      [72, 4, 3],
      [86, 4, 3],
    ] as const) {
      const t = topology(leaves, zones, subnets);
      const groups = t.nodes.filter((n) => t.nodes.some((m) => m.parent === n.id)).length;
      const started = performance.now();
      const positions = await layout(t.nodes, t.edges, 'DOWN');
      const ms = performance.now() - started;
      const through = throughNodes(t.nodes, t.edges, positions);
      // Fast fallback, for comparison.
      const quick = performance.now();
      const fast = layeredGroups(t.nodes, t.edges, 'DOWN', layered);
      const fastMs = performance.now() - quick;
      // Edit sensitivity: take one leaf out of the config and see how many others move,
      // measured relative to their own parent.
      const fewer = t.nodes.filter((n) => n.id !== 'n5');
      const after = await layout(
        fewer,
        t.edges.filter((e) => e.source !== 'n5' && e.target !== 'n5'),
        'DOWN',
      );
      const [r0, r1] = [relative(positions), relative(after)];
      const moved = Object.keys(r1).filter(
        (id) => JSON.stringify(r0[id]) !== JSON.stringify(r1[id]),
      ).length;
      report.push(
        `${t.nodes.length} nodes, ${groups} groups, ${t.edges.length} edges: ELK ${ms.toFixed(0)} ms, fast ${fastMs.toFixed(1)} ms, ` +
          `${through}/${t.edges.length} straight edges pass through an unrelated node (fast: ${throughNodes(t.nodes, t.edges, fast)}), ` +
          `removing one leaf moves ${moved}/${Object.keys(r1).length} nodes (relative to their parent)`,
      );
      expect(ms).toBeLessThan(3000);
      expect(await layout(t.nodes, t.edges, 'DOWN')).toEqual(positions);
    }
    console.info(report.join('\n'));
  });
});

describe('boundaries', () => {
  const nodes: N[] = [
    { id: 'out' },
    { id: 'vpc', boundary: true },
    { id: 'az', parent: 'vpc' },
    { id: 'zone', parent: 'az', boundary: true },
    { id: 'a', parent: 'az' },
    { id: 'b', parent: 'zone' },
    { id: 'm', parent: 'a', parents: ['a', 'zone'] },
  ];
  const boundaries = new Set(['vpc', 'zone']);
  const edges = [
    { id: 'out-a', source: 'out', target: 'a' },
    { id: 'a-b', source: 'a', target: 'b' },
    { id: 'out-b', source: 'out', target: 'b' },
    { id: 'out-vpc', source: 'out', target: 'vpc' },
    { id: 'b-vpc', source: 'b', target: 'vpc' },
    { id: 'a-az', source: 'a', target: 'az' },
    { id: 'a-m', source: 'a', target: 'm' },
  ];
  const at = (moved?: Record<string, string>) =>
    parentMap(nodes, new Map(Object.entries(moved ?? {})));

  it('marks an edge with every boundary between its ends, in the order it passes them', () => {
    const crossings = crossingsOf(boundaries, edges, at());
    expect(crossings.get('out-a')).toEqual(['vpc']);
    expect(crossings.get('a-b')).toEqual(['zone']);
    expect(crossings.get('out-b')).toEqual(['vpc', 'zone']);
  });

  it('an edge that ends at a boundary itself does not cross that boundary', () => {
    const crossings = crossingsOf(boundaries, edges, at());
    expect(crossings.has('out-vpc')).toBe(false);
    // From inside a nested boundary to the outer one: it leaves the inner one only.
    expect(crossings.get('b-vpc')).toEqual(['zone']);
    expect(crossings.has('a-az')).toBe(false);
  });

  it('follows a node that moves', () => {
    expect(crossingsOf(boundaries, edges, at()).has('a-m')).toBe(false);
    expect(crossingsOf(boundaries, edges, at({ m: 'zone' })).get('a-m')).toEqual(['zone']);
  });

  it('writes nothing: an edge cannot carry a crossing', () => {
    const result = loadConfig(
      pane({ nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'a', crosses: ['x'] }] }),
      createRegistry(),
    );
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('keeps a group lit when something inside, or an edge into it, is touched', () => {
    const parent = at();
    const groups = new Set(['vpc', 'az', 'zone']);
    expect([...litGroups(groups, parent, ['b'], [])].sort()).toEqual(['az', 'vpc', 'zone']);
    expect([...litGroups(groups, parent, ['a'], [])].sort()).toEqual(['az', 'vpc']);
    expect([...litGroups(groups, parent, [], [{ source: 'out', target: 'zone' }])].sort()).toEqual([
      'az',
      'vpc',
      'zone',
    ]);
    expect([...litGroups(groups, parent, ['out'], [])]).toEqual([]);
  });

  it('finds where an edge meets a border', () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(crossingPoint(rect, { x: -50, y: 50 }, { x: 50, y: 50 })).toEqual({ x: 0, y: 50 });
    expect(crossingPoint(rect, { x: 200, y: 200 }, { x: 300, y: 300 })).toBeUndefined();
  });
});

function pane(content: unknown, effects: Record<string, unknown[]> = {}, panel = 'graph') {
  return {
    id: 'w',
    title: 'W',
    layout: { panes: [{ id: 'g', panel, content }] },
    steps: [
      { id: 's', title: 'S', calls: [{ id: 'c', label: 'C', effects: { g: [], ...effects } }] },
    ],
  };
}
const rules = (value: unknown) =>
  loadConfig(value, createRegistry()).problems.map((item) => item.rule);

describe('moving between parents', () => {
  const content = {
    initial: true,
    nodes: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
      { id: 'm', label: 'M', parent: 'a', parents: ['a', 'b'] },
      { id: 'fixed', label: 'F', parent: 'a' },
    ],
    edges: [],
  };

  it('accepts a move to a listed parent and folds it into the state', () => {
    const config = pane(content, { g: [{ update: 'm', fields: { parent: 'b' } }] });
    const result = loadConfig(config, createRegistry());
    expect(result.problems).toEqual([]);
    const state = createFolder(result.walkthroughs[0]!).at(0, 0).g!.state as ElementsState;
    expect(state.patches.m).toEqual({ parent: 'b' });
  });

  it('rejects a parent outside the list', () => {
    expect(rules(pane(content, { g: [{ update: 'm', fields: { parent: 'c' } }] }))).toEqual([
      'graph/move-outside-parents',
    ]);
    expect(rules(pane(content, { g: [{ update: 'm', fields: { parent: 7 } }] }))).toEqual([
      'graph/move-outside-parents',
    ]);
  });

  it('only a node that lists parents can move', () => {
    expect(rules(pane(content, { g: [{ update: 'fixed', fields: { parent: 'b' } }] }))).toEqual([
      'graph/unknown-field',
    ]);
  });

  it('checks the names in parent and parents', () => {
    const bad = {
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'm', label: 'M', parent: 'zz', parents: ['a', 'yy'] },
      ],
      edges: [],
    };
    expect(rules(pane(bad)).sort()).toEqual([
      'graph/parent-not-listed',
      'graph/unknown-parent',
      'graph/unknown-parent',
    ]);
  });

  it('rejects a loop through parents, including one a move could make', () => {
    const loop = {
      nodes: [
        { id: 'a', label: 'A', parent: 'b' },
        { id: 'b', label: 'B', parents: ['a'] },
      ],
      edges: [],
    };
    expect(rules(pane(loop))).toContain('graph/parent-cycle');
  });

  it('rejects an edge between a group and something inside it, on the flow panel too', () => {
    const inside = {
      nodes: [
        { id: 'g', label: 'G' },
        { id: 'c', label: 'C', parent: 'g' },
      ],
      edges: [{ from: 'g', to: 'c' }],
    };
    expect(rules(pane(inside))).toEqual(['graph/edge-inside-group']);
    expect(rules(pane(inside, {}, 'flow'))).toEqual(['flow/edge-inside-group']);
  });

  it('warns about a boundary that holds nothing', () => {
    const empty = { nodes: [{ id: 'g', label: 'G', boundary: true }], edges: [] };
    const result = loadConfig(pane(empty), createRegistry());
    expect(result.problems.map((p) => [p.rule, p.severity])).toEqual([
      ['graph/empty-boundary', 'warning'],
    ]);
  });
});

describe('icons', () => {
  it('ships a small built-in set of path data', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(15);
    expect(ICON_NAMES.length).toBeLessThanOrEqual(20);
    for (const name of ICON_NAMES)
      expect(resolveIcon(name, undefined)?.d).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]+$/);
  });

  it('lints an icon that is neither built in nor in the pane', () => {
    const content = {
      nodes: [
        { id: 'a', label: 'A', icon: 'server' },
        { id: 'b', label: 'B', icon: 'toaster' },
      ],
      edges: [],
    };
    expect(rules(pane(content))).toEqual(['graph/unknown-icon']);
    const own = { ...content, icons: { toaster: 'M2 2h20v20H2z' } };
    expect(rules(pane(own))).toEqual([]);
  });

  it('does not find an icon through what every object inherits', () => {
    expect(resolveIcon('constructor', undefined)).toBeUndefined();
    expect(resolveIcon('toString', { x: 'M0 0' })).toBeUndefined();
  });

  it('accepts only path data, never markup', () => {
    const attempts = [
      '<svg onload=alert(1)>',
      'M0 0"/><script>x</script>',
      'url(javascript:alert(1))',
      'M0 0 L 1 1 <g>',
      'M0 0 ; fill:red',
    ];
    for (const d of attempts) {
      const content = { nodes: [{ id: 'a', label: 'A', icon: 'x' }], edges: [], icons: { x: d } };
      expect(rules(pane(content)), d).toContain('schema');
      const objectForm = { ...content, icons: { x: { d } } };
      expect(rules(pane(objectForm)), d).toContain('schema');
    }
    const long = { nodes: [{ id: 'a', label: 'A' }], edges: [], icons: { x: 'M0 0'.repeat(2000) } };
    expect(rules(pane(long))).toContain('schema');
  });

  it('takes a filled icon with its own box size', () => {
    expect(resolveIcon('x', { x: { d: 'M0 0h64v64z', fill: true, size: 64 } })).toEqual({
      d: 'M0 0h64v64z',
      fill: true,
      size: 64,
    });
    expect(resolveIcon('x', { x: 'M0 0' })).toEqual({ d: 'M0 0', fill: false, size: 24 });
  });
});

describe('traffic and weight', () => {
  const content = {
    initial: true,
    nodes: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', weight: 3 }],
  };

  it('reverses the traffic of a read edge, and nothing else', () => {
    expect(rules(pane(content, { g: [{ read: 'ab', reverse: true }] }))).toEqual([]);
    expect(rules(pane(content, { g: [{ read: 'a', reverse: true }] }))).toEqual([
      'graph/bad-reverse',
    ]);
    expect(rules(pane(content, { g: [{ update: 'ab', reverse: true }] }))).toEqual([
      'graph/bad-reverse',
    ]);
    expect(rules(pane(content, { g: [{ read: 'ab', reverse: 'yes' }] }))).toContain('schema');
  });

  it('updates a weight, and judges the value', () => {
    const good = loadConfig(
      pane(content, { g: [{ update: 'ab', fields: { weight: 6 } }] }),
      createRegistry(),
    );
    expect(good.problems).toEqual([]);
    const state = createFolder(good.walkthroughs[0]!).at(0, 0).g!.state as ElementsState;
    expect(state.patches.ab).toEqual({ weight: 6 });
    for (const weight of [0, -1, 40, '3', null]) {
      expect(
        rules(pane(content, { g: [{ update: 'ab', fields: { weight } }] })),
        String(weight),
      ).toEqual(['graph/bad-field']);
    }
    expect(rules(pane(content, { g: [{ update: 'ab', fields: { colour: 'red' } }] }))).toEqual([
      'graph/unknown-field',
    ]);
  });

  it('a weight in the content has bounds', () => {
    const heavy = { ...content, edges: [{ id: 'ab', from: 'a', to: 'b', weight: 99 }] };
    expect(rules(pane(heavy))).toContain('schema');
  });
});

describe('the AWS demo', () => {
  it('has no lint problems and uses groups, a boundary, icons, weights and reverse traffic', () => {
    const result = loadConfig(awsVpcRequest, createRegistry());
    expect(result.problems).toEqual([]);
    const text = JSON.stringify(awsVpcRequest);
    for (const word of ['"boundary":true', '"icon":', '"weight":', '"reverse":true', '"parent":']) {
      expect(text).toContain(word);
    }
  });

  it('lays out the same for every call: positions come from the whole content, not the cursor', async () => {
    const result = loadConfig(awsVpcRequest, createRegistry());
    const pane = result.walkthroughs[0]!.panes.find((p) => p.id === 'net')!;
    const content = pane.content as {
      nodes: N[] & { label: string }[];
      edges: { id?: string; from: string; to: string }[];
    };
    const nodes = content.nodes.map((n) => ({
      id: n.id,
      width: 120,
      height: 50,
      parent: n.parent,
    }));
    const edges = content.edges.map((e) => ({
      id: e.id ?? `${e.from}.${e.to}`,
      source: e.from,
      target: e.to,
    }));
    const once = await layout(nodes, edges, 'DOWN');
    // The elements a call adds are in this layout already: i-b1 has a position before it exists.
    expect(once['i-b1']).toBeDefined();
    expect(await layout(nodes, edges, 'DOWN')).toEqual(once);
  });
});
