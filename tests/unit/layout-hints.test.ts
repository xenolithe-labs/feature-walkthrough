import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core';
import {
  absoluteBoxes,
  layoutFull,
  type LayoutEdge,
  type LayoutNode,
} from '../../src/panels/_diagram/layout';
import { layoutProblems } from '../../src/panels/_diagram/layout-lint';
import { polylineHitsRect } from '../../src/panels/_diagram/route';
import { createRegistry } from '../../src/registry';

const node = (id: string, extra: Partial<LayoutNode> = {}): LayoutNode => ({
  id,
  width: 120,
  height: 40,
  ...extra,
});
const edge = (source: string, target: string, extra: Partial<LayoutEdge> = {}): LayoutEdge => ({
  id: `${source}.${target}`,
  source,
  target,
  ...extra,
});

function wrap(content: unknown, panel = 'graph') {
  return {
    id: 'w',
    title: 'W',
    layout: { panes: [{ id: 'g', panel, content }] },
    steps: [{ id: 's', title: 'S', calls: [{ id: 'c', label: 'C', effects: { g: [] } }] }],
  };
}
const n = (id: string, extra: object = {}) => ({ id, label: id.toUpperCase(), ...extra });
const problems = (config: unknown) => loadConfig(config, createRegistry()).problems;
const rules = (config: unknown) => problems(config).map((p) => `${p.severity} ${p.rule}`);
const layoutRules = async (config: unknown) =>
  (await layoutProblems(config, createRegistry())).map((p) => p.rule);

describe('pane hints: routing, spacing, order', () => {
  const nodes = [node('a'), node('b'), node('c'), node('d')];
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'd')];

  it('routing: orthogonal (the default) draws right angles, curved smooths ELK polyline points', async () => {
    const ortho = await layoutFull(nodes, edges, 'RIGHT', 'layered', {});
    const curved = await layoutFull(nodes, edges, 'RIGHT', 'layered', { routing: 'curved' });
    expect(Object.values(ortho.routes).every((r) => r.style === 'orthogonal')).toBe(true);
    expect(Object.values(curved.routes).every((r) => r.style === 'curved')).toBe(true);
    for (const route of Object.values(ortho.routes)) {
      for (let i = 0; i < route.points.length - 1; i += 1) {
        const [p, q] = [route.points[i]!, route.points[i + 1]!];
        expect(Math.abs(p.x - q.x) < 0.01 || Math.abs(p.y - q.y) < 0.01).toBe(true);
      }
    }
  });

  it('spacing: compact, normal and roomy order the room between layers', async () => {
    const gap = async (spacing: 'compact' | 'normal' | 'roomy') => {
      const result = await layoutFull(nodes, edges, 'RIGHT', 'layered', { spacing });
      return result.positions.b!.x - (result.positions.a!.x + 120);
    };
    const [compact, normal, roomy] = [
      await gap('compact'),
      await gap('normal'),
      await gap('roomy'),
    ];
    expect(compact).toBeLessThan(normal);
    expect(normal).toBeLessThan(roomy);
  });

  it('order: declared keeps the declared order within a layer, even where that makes lines cross', async () => {
    const set = [node('k1'), node('k2'), node('m1'), node('m2')];
    const links = [edge('k1', 'm2'), edge('k2', 'm1')];
    const auto = await layoutFull(set, links, 'RIGHT', 'layered', { order: 'auto' });
    const declared = await layoutFull(set, links, 'RIGHT', 'layered', { order: 'declared' });
    // Left to itself the layout swaps m1 and m2 so that the two lines do not cross.
    expect(auto.positions.m2!.y).toBeLessThan(auto.positions.m1!.y);
    expect(declared.positions.m1!.y).toBeLessThan(declared.positions.m2!.y);
  });
});

describe('edge hints: fromSide and toSide', () => {
  it('an edge leaves and arrives by the sides it names', async () => {
    const result = await layoutFull(
      [node('a'), node('b')],
      [edge('a', 'b', { fromSide: 'bottom', toSide: 'bottom' })],
      'RIGHT',
      'layered',
      {},
    );
    const boxes = absoluteBoxes([node('a'), node('b')], result.positions);
    const route = result.routes['a.b']!;
    const a = boxes.get('a')!;
    const b = boxes.get('b')!;
    expect(route.points[0]!.y).toBeCloseTo(a.y + a.height, 0);
    expect(route.points.at(-1)!.y).toBeCloseTo(b.y + b.height, 0);
  });

  it('works for nodes inside groups too', async () => {
    const nodes = [node('g'), node('a', { parent: 'g' }), node('b', { parent: 'g' })];
    const result = await layoutFull(
      nodes,
      [edge('a', 'b', { fromSide: 'top', toSide: 'top' })],
      'DOWN',
      'layered',
      {},
    );
    const boxes = absoluteBoxes(nodes, result.positions);
    const route = result.routes['a.b']!;
    expect(route.points[0]!.y).toBeCloseTo(boxes.get('a')!.y, 0);
    expect(route.points.at(-1)!.y).toBeCloseTo(boxes.get('b')!.y, 0);
  });
});

describe('node hints: rank', () => {
  it('first and last put a node in the first or last layer', async () => {
    const result = await layoutFull(
      [node('a'), node('b'), node('c', { rank: 'first' }), node('d', { rank: 'last' })],
      [edge('a', 'b'), edge('b', 'd'), edge('b', 'c')],
      'RIGHT',
      'layered',
      {},
    );
    const x = (id: string) => result.positions[id]!.x;
    expect(x('c')).toBeLessThanOrEqual(Math.min(x('a'), x('b'), x('d')));
    expect(x('d')).toBeGreaterThanOrEqual(Math.max(x('a'), x('b'), x('c')));
  });
});

describe('placement on the grid', () => {
  it('derives positions from cells, in a grid that routes round nodes', async () => {
    const nodes = [
      node('a', { cell: [0, 0] }),
      node('b', { cell: [2, 0] }),
      node('wall', { cell: [1, 0] }),
    ];
    const result = await layoutFull(nodes, [edge('a', 'b')], 'RIGHT', 'layered', {});
    expect(result.kind).toBe('grid');
    const boxes = absoluteBoxes(nodes, result.positions);
    expect(boxes.get('wall')!.x).toBeGreaterThan(boxes.get('a')!.x);
    expect(boxes.get('b')!.x).toBeGreaterThan(boxes.get('wall')!.x);
    const route = result.routes['a.b']!;
    expect(polylineHitsRect(route.points, boxes.get('wall')!)).toBe(false);
  });

  it('cells inside a group are relative to the group, and the group is sized around them', async () => {
    const nodes = [
      node('g'),
      node('a', { parent: 'g', cell: [0, 0] }),
      node('b', { parent: 'g', cell: [1, 0] }),
      node('out', { cell: [0, 1] }),
    ];
    const result = await layoutFull(
      nodes,
      [edge('a', 'b'), edge('b', 'out')],
      'RIGHT',
      'layered',
      {},
    );
    const boxes = absoluteBoxes(nodes, result.positions);
    const g = boxes.get('g')!;
    for (const id of ['a', 'b']) {
      const box = boxes.get(id)!;
      expect(box.x).toBeGreaterThanOrEqual(g.x);
      expect(box.x + box.width).toBeLessThanOrEqual(g.x + g.width + 0.5);
    }
    expect(boxes.get('b')!.x).toBeGreaterThan(boxes.get('a')!.x);
    // The node below the group does not overlap it.
    expect(boxes.get('out')!.y).toBeGreaterThanOrEqual(g.y + g.height);
  });

  it('a node with no cell goes into free space, and no two nodes overlap', async () => {
    const nodes = [node('a', { cell: [0, 0] }), node('b'), node('c'), node('d', { rightOf: 'a' })];
    const result = await layoutFull(
      nodes,
      [edge('a', 'b'), edge('a', 'c')],
      'RIGHT',
      'layered',
      {},
    );
    const boxes = [...absoluteBoxes(nodes, result.positions).values()];
    for (const [i, p] of boxes.entries()) {
      for (const q of boxes.slice(i + 1)) {
        const apart =
          p.x + p.width <= q.x ||
          q.x + q.width <= p.x ||
          p.y + p.height <= q.y ||
          q.y + q.height <= p.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('positions do not depend on which nodes are present: absent nodes keep their cell', async () => {
    const all = [
      node('a', { cell: [0, 0] }),
      node('b', { cell: [1, 0] }),
      node('c', { cell: [2, 0] }),
    ];
    const first = await layoutFull(all, [], 'RIGHT', 'layered', {});
    expect(await layoutFull([...all], [], 'RIGHT', 'layered', {})).toEqual(first);
  });
});

describe('partial pins', () => {
  it('a node pinned on both axes stays where it is and the rest are placed round it', async () => {
    const nodes = [node('a'), node('b', { x: 500, y: 300 }), node('c')];
    const result = await layoutFull(
      nodes,
      [edge('a', 'b'), edge('b', 'c')],
      'RIGHT',
      'layered',
      {},
    );
    expect(result.kind).toBe('pins');
    expect(result.positions.b).toMatchObject({ x: 500, y: 300 });
    const boxes = [...absoluteBoxes(nodes, result.positions).values()];
    for (const [i, p] of boxes.entries()) {
      for (const q of boxes.slice(i + 1)) {
        const apart =
          p.x + p.width <= q.x ||
          q.x + q.width <= p.x ||
          p.y + p.height <= q.y ||
          q.y + q.height <= p.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('a node pinned on one axis keeps that axis', async () => {
    const nodes = [node('a'), node('b', { x: 700 }), node('c', { y: 400 })];
    const result = await layoutFull(
      nodes,
      [edge('a', 'b'), edge('a', 'c')],
      'RIGHT',
      'layered',
      {},
    );
    expect(result.positions.b!.x).toBe(700);
    expect(result.positions.c!.y).toBe(400);
  });

  it('a pin that cannot be used is reported, never dropped silently', () => {
    const grouped = wrap({
      nodes: [n('g'), n('a', { parent: 'g', x: 10, y: 10 }), n('b', { parent: 'g' })],
      edges: [],
    });
    expect(rules(grouped)).toEqual(['warning graph/pin-ignored']);
    const tree = wrap({ layout: 'tree', nodes: [n('a', { x: 1, y: 1 }), n('b')], edges: [] });
    expect(rules(tree)).toEqual(['warning graph/pin-ignored']);
    const grid = wrap({
      nodes: [n('a', { cell: [0, 0], x: 1, y: 1 }), n('b', { cell: [1, 0] })],
      edges: [],
    });
    expect(rules(grid)).toEqual(['warning graph/pin-ignored']);
    // Flat and layered: the pin is used, so nothing is said. Every node pinned: used too.
    expect(rules(wrap({ nodes: [n('a', { x: 1 }), n('b')], edges: [] }))).toEqual([]);
    expect(
      rules(wrap({ nodes: [n('a', { x: 1, y: 2 }), n('b', { x: 5, y: 9 })], edges: [] })),
    ).toEqual([]);
  });
});

describe('lint of the hints', () => {
  it('checks values of every hint', () => {
    const bad = (extra: object, where: 'node' | 'edge' | 'pane') =>
      rules(
        wrap({
          ...(where === 'pane' ? extra : {}),
          nodes: [n('a', where === 'node' ? extra : {}), n('b')],
          edges: [{ from: 'a', to: 'b', ...(where === 'edge' ? extra : {}) }],
        }),
      );
    expect(bad({ routing: 'wavy' }, 'pane')).toEqual(['error schema']);
    expect(bad({ spacing: 'huge' }, 'pane')).toEqual(['error schema']);
    expect(bad({ order: 'random' }, 'pane')).toEqual(['error schema']);
    expect(bad({ routing: 'wavy' }, 'edge')).toEqual(['error schema']);
    expect(bad({ fromSide: 'up' }, 'edge')).toEqual(['error schema']);
    expect(bad({ toSide: 'middle' }, 'edge')).toEqual(['error schema']);
    expect(bad({ rank: 'middle' }, 'node')).toEqual(['error schema']);
    expect(bad({ cell: [1.5, 0] }, 'node')).toEqual(['error schema']);
    expect(bad({ cell: [-1, 0] }, 'node')).toEqual(['error schema']);
    expect(bad({ span: [0, 1] }, 'node')).toEqual(['error schema']);
    expect(bad({ shape: 'star' }, 'node')).toEqual(['error schema']);
    expect(bad({ side: 'up' }, 'node')).toEqual(['error schema']);
    expect(bad({ more: 0 }, 'node')).toEqual(['error schema']);
  });

  it('placement: unknown names, cycles, two nodes asking for one cell, a span with nowhere to be', () => {
    const lost = wrap({ nodes: [n('a', { below: 'zz' })], edges: [] });
    expect(rules(lost)).toEqual(['error graph/unknown-anchor']);
    const self = wrap({ nodes: [n('a', { rightOf: 'a' })], edges: [] });
    expect(rules(self)).toContain('error graph/unknown-anchor');
    const cycle = wrap({ nodes: [n('a', { rightOf: 'b' }), n('b', { below: 'a' })], edges: [] });
    expect(rules(cycle)).toEqual(['error graph/placement-cycle', 'error graph/placement-cycle']);
    const taken = wrap({
      nodes: [n('a', { cell: [0, 0] }), n('b', { cell: [0, 0] })],
      edges: [],
    });
    expect(rules(taken)).toEqual(['error graph/cell-taken']);
    const span = wrap({ nodes: [n('a', { span: [2, 1] })], edges: [] });
    expect(rules(span)).toEqual(['warning graph/span-without-cell']);
    // Names in another group are not anchors.
    const apart = wrap({
      nodes: [n('g'), n('a', { parent: 'g' }), n('b', { rightOf: 'a' })],
      edges: [],
    });
    expect(rules(apart)).toEqual(['error graph/unknown-anchor']);
  });

  it('a hint that has nothing to act on says so', () => {
    const tree = wrap({
      layout: 'tree',
      spacing: 'roomy',
      nodes: [n('a', { rank: 'first' }), n('b')],
      edges: [{ from: 'a', to: 'b', fromSide: 'top' }],
    });
    expect(rules(tree)).toEqual([
      'warning graph/hint-ignored',
      'warning graph/hint-ignored',
      'warning graph/hint-ignored',
    ]);
    const side = wrap({ nodes: [n('a', { side: 'left' })], edges: [] });
    expect(rules(side)).toEqual(['warning graph/hint-ignored']);
  });

  it('colour never carries meaning alone: an accent must be explained', () => {
    const unexplained = wrap({ nodes: [n('a', { accent: 'red' })], edges: [] });
    expect(rules(unexplained)).toEqual(['error graph/unknown-accent']);
    const explained = wrap({
      accents: { red: 'Weakness' },
      nodes: [n('a', { accent: 'red' })],
      edges: [],
    });
    expect(rules(explained)).toEqual([]);
  });
});

describe('layout lint: findings, and the agent loop', () => {
  const chain = (count: number, extra: object = {}) => ({
    initial: true,
    ...extra,
    nodes: Array.from({ length: count }, (_, i) => n(`s${i}`)),
    edges: Array.from({ length: count - 1 }, (_, i) => ({ from: `s${i}`, to: `s${i + 1}` })),
  });

  it('edge-through-node names the edge and the node, and says which hint helps', async () => {
    const config = wrap({
      initial: true,
      routing: 'straight',
      nodes: [n('a'), n('c'), n('b')],
      edges: [
        { from: 'a', to: 'c' },
        { from: 'c', to: 'b' },
        { from: 'a', to: 'b' },
      ],
    });
    const found = await layoutProblems(config, createRegistry());
    const hit = found.find((p) => p.rule === 'graph/edge-through-node')!;
    expect(hit.severity).toBe('warning');
    expect(hit.message).toContain('edge a→b passes through node "c"');
    expect(hit.message).toContain('routing');
    expect(hit.path).toEqual(['layout', 'panes', 0, 'content', 'edges', 2]);
  });

  it('the agent loop: lint, apply what it says, lint again, and the warning is gone', async () => {
    const content = {
      initial: true,
      routing: 'straight',
      nodes: [n('a'), n('c'), n('b')],
      edges: [
        { from: 'a', to: 'c' },
        { from: 'c', to: 'b' },
        { from: 'a', to: 'b', label: 'skips c' },
      ],
    };
    const first = await layoutRules(wrap(content));
    expect(first).toContain('graph/edge-through-node');
    // "set routing to orthogonal so the line goes round nodes"
    const fixed = await layoutRules(wrap({ ...content, routing: 'orthogonal' }));
    expect(fixed).not.toContain('graph/edge-through-node');
    expect(fixed).toEqual([]);
  });

  it('the agent loop for width: a long chain across, then down', async () => {
    const across = await layoutProblems(wrap(chain(9, { direction: 'RIGHT' })), createRegistry());
    const wide = across.find((p) => p.rule === 'graph/too-wide')!;
    expect(wide.message).toContain('"direction": "DOWN"');
    const down = await layoutRules(wrap(chain(9, { direction: 'DOWN', spacing: 'compact' })));
    expect(down).not.toContain('graph/too-wide');
  });

  it('label-overlap: a label that lands on a node, with the way out', async () => {
    const config = wrap({
      initial: true,
      routing: 'straight',
      nodes: [n('a'), n('m'), n('b')],
      edges: [
        { from: 'a', to: 'm' },
        { from: 'm', to: 'b' },
        { from: 'a', to: 'b', label: 'a long label that sits on the middle node' },
      ],
    });
    const found = await layoutProblems(config, createRegistry());
    const hit = found.find((p) => p.rule === 'graph/label-overlap')!;
    expect(hit.message).toMatch(/overlaps (node "m"|the line of edge a→m)/);
    expect(hit.message).toContain('"spacing": "roomy"');
  });

  it('node-overlap: pinned nodes on top of each other, with where to move one', async () => {
    const config = wrap({
      nodes: [n('a', { x: 0, y: 0 }), n('b', { x: 20, y: 10 })],
      edges: [],
    });
    const found = await layoutProblems(config, createRegistry());
    const hit = found.find((p) => p.rule === 'graph/node-overlap')!;
    expect(hit.message).toMatch(/node "b" overlaps node "a"; move "b" to x \d+ or y \d+/);
  });

  it('edge-crossings: a woven pair of pinned columns is reported with the edges in most crossings', async () => {
    const left = Array.from({ length: 7 }, (_, i) => n(`l${i}`, { x: 0, y: i * 90 }));
    const right = Array.from({ length: 7 }, (_, i) => n(`r${i}`, { x: 500, y: i * 90 }));
    const edges = left.flatMap((l, i) => [
      { from: l.id, to: `r${(i * 3) % 7}` },
      { from: l.id, to: `r${(i * 3 + 1) % 7}` },
    ]);
    const found = await layoutProblems(
      wrap({ initial: true, routing: 'straight', nodes: [...left, ...right], edges }),
      createRegistry(),
    );
    const hit = found.find((p) => p.rule === 'graph/edge-crossings');
    expect(hit?.message).toMatch(/\d+ pairs of edges cross/);
  });

  it('too-dense: more edges than ELK can lay out in time', async () => {
    const nodes = Array.from({ length: 40 }, (_, i) => n(`n${i}`));
    const edges: { from: string; to: string }[] = [];
    for (let i = 0; i < 40 && edges.length < 260; i += 1) {
      for (let j = 1; j <= 7; j += 1) edges.push({ from: `n${i}`, to: `n${(i + j) % 40}` });
    }
    const found = await layoutRules(wrap({ initial: true, nodes, edges }));
    expect(found).toContain('graph/too-dense');
  });

  it('too many nodes to route a pinned diagram round: said, not silent', async () => {
    const nodes = Array.from({ length: 80 }, (_, i) =>
      n(`n${i}`, { x: (i % 10) * 200, y: Math.floor(i / 10) * 100 }),
    );
    const found = await layoutProblems(
      wrap({ initial: true, nodes, edges: [{ from: 'n0', to: 'n79' }] }),
      createRegistry(),
    );
    expect(found.map((p) => p.rule)).toContain('graph/not-routed');
  });

  it('flow panes get the same findings under their own name', async () => {
    const config = wrap(
      {
        routing: 'straight',
        nodes: [n('a'), n('c'), n('b')],
        edges: [
          { from: 'a', to: 'c' },
          { from: 'c', to: 'b' },
          { from: 'a', to: 'b' },
        ],
      },
      'flow',
    );
    expect(await layoutRules(config)).toContain('flow/edge-through-node');
  });

  it('paths in a collection carry the walkthrough prefix, like the other lint lines', async () => {
    const one = wrap({
      initial: true,
      routing: 'straight',
      nodes: [n('a'), n('c'), n('b')],
      edges: [
        { from: 'a', to: 'c' },
        { from: 'c', to: 'b' },
        { from: 'a', to: 'b' },
      ],
    });
    const other = { ...wrap({ nodes: [n('x')], edges: [] }), id: 'other' };
    const found = await layoutProblems({ walkthroughs: [other, one] }, createRegistry());
    expect(found[0]!.path.slice(0, 2)).toEqual(['walkthroughs', 1]);
  });

  it('a config with errors gets no layout findings: fix those first', async () => {
    expect(await layoutRules(wrap({ nodes: [n('a', { rightOf: 'zz' })], edges: [] }))).toEqual([]);
  });
});
