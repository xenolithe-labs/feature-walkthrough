import { describe, expect, it } from 'vitest';
import { createFolder, formatProblem, loadConfig, type ElementsState } from '../../src/core';
import { createRegistry } from '../../src/registry';
import { route } from '../../src/panels/_diagram/slot-route';
import {
  openSides,
  recordGeometry,
  splitEnd,
  widestValues,
  type RecordShape,
} from '../../src/panels/_diagram/slots';
import { treeLayout, treeParents } from '../../src/panels/_diagram/tree-layout';
import type { LayoutEdge, LayoutNode } from '../../src/panels/_diagram/layout';

type Json = Record<string, unknown>;

/** A graph pane with the given content and one call per entry of `calls`. */
function config(content: Json, calls: Json[][] = [[]], panel = 'graph') {
  return {
    id: 'records',
    title: 'Records',
    layout: { panes: [{ id: 'g', panel, title: 'G', content }] },
    steps: [
      {
        id: 's1',
        title: 'Step',
        calls: calls.map((effects, index) => ({
          id: `c${index + 1}`,
          label: `Call ${index + 1}`,
          effects: { g: effects },
        })),
      },
    ],
  };
}

const list = {
  initial: true,
  nodes: [
    {
      id: 'a',
      label: 'a',
      slots: [
        { id: 'val', value: 3 },
        { id: 'next', value: 'null' },
      ],
    },
    {
      id: 'b',
      label: 'b',
      slots: [
        { id: 'val', value: 8 },
        { id: 'next', value: 'null' },
      ],
    },
  ],
  edges: [{ from: 'a.next', to: 'b' }],
};

const problems = (input: unknown) =>
  loadConfig(input, createRegistry()).problems.map((problem) => ({
    rule: problem.rule,
    text: formatProblem(problem),
  }));

describe('slot ids', () => {
  it('a slot is an element named node.slot, present with its node', () => {
    const result = loadConfig(
      config(list, [[{ read: 'a.val' }, { update: 'a.val', fields: { value: 4 } }]]),
      createRegistry(),
    );
    expect(result.problems.map(formatProblem)).toEqual([]);
    const pane = result.walkthroughs[0]!.panes[0]!;
    const ids = pane.entities.map((entity) => entity.id);
    expect(ids).toEqual(['a', 'b', 'a.val', 'a.next', 'b.val', 'b.next', 'a.next.b']);
    expect(pane.entities.find((entity) => entity.id === 'a.val')?.initial).toBe(true);
  });

  it('splits an edge end into node and slot', () => {
    expect(splitEnd('a.next')).toEqual({ node: 'a', slot: 'next' });
    expect(splitEnd('a')).toEqual({ node: 'a', slot: undefined });
  });

  it('a call can write a slot value, and tone it', () => {
    const result = loadConfig(
      config(list, [
        [{ update: 'a.next', fields: { value: 'x', tone: 'warn' } }, { read: 'b.val' }],
      ]),
      createRegistry(),
    );
    expect(result.problems.map(formatProblem)).toEqual([]);
    const walkthrough = result.walkthroughs[0]!;
    const state = createFolder(walkthrough).at(0, 0)['g']!.state as ElementsState;
    expect(state.patches['a.next']).toEqual({ value: 'x', tone: 'warn' });
  });

  it('re-pointing is removing one declared edge and adding another', () => {
    const content = {
      ...list,
      edges: [
        { from: 'a.next', to: 'b' },
        { from: 'b.next', to: 'a', initial: false },
      ],
    };
    const result = loadConfig(
      config(content, [[{ remove: 'a.next.b' }, { add: 'b.next.a' }]]),
      createRegistry(),
    );
    expect(result.problems.map(formatProblem)).toEqual([]);
    const state = createFolder(result.walkthroughs[0]!).at(0, 0)['g']!.state as ElementsState;
    expect(state.present).toContain('b.next.a');
    expect(state.present).not.toContain('a.next.b');
  });
});

describe('lint for records', () => {
  it('rejects an edge to an unknown slot', () => {
    const found = problems(config({ ...list, edges: [{ from: 'a.nxt', to: 'b' }] }));
    expect(found.map((problem) => problem.rule)).toEqual(['graph/unknown-slot']);
    expect(found[0]!.text).toContain('Its slots: val, next');
  });

  it('rejects an edge end that names a slot of a node without slots, and an unknown node', () => {
    const found = problems(
      config({
        nodes: [
          { id: 'a', label: 'a' },
          { id: 'b', label: 'b' },
        ],
        edges: [
          { from: 'a.x', to: 'b' },
          { from: 'a', to: 'ghost.x' },
        ],
      }),
    );
    expect(found.map((problem) => problem.rule).sort()).toEqual([
      'graph/unknown-node',
      'graph/unknown-slot',
    ]);
  });

  it('rejects two slots with one id in one node', () => {
    const content = {
      nodes: [{ id: 'a', label: 'a', slots: [{ id: 'x' }, { id: 'x' }] }],
      edges: [],
    };
    expect(problems(config(content)).map((problem) => problem.rule)).toEqual([
      'graph/duplicate-slot',
    ]);
  });

  it('rejects ids that collide once derived: a slot b of node a and an edge a to b', () => {
    const content = {
      nodes: [
        { id: 'a', label: 'a', slots: [{ id: 'b' }] },
        { id: 'b', label: 'b' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    };
    // The core's check of every element of the pane catches it, once.
    expect(problems(config(content)).map((problem) => problem.rule)).toEqual(['duplicate-id']);
  });

  it('rejects an effect on a slot that does not exist, once', () => {
    const found = problems(config(list, [[{ read: 'a.nope' }]]));
    expect(found.map((problem) => problem.rule)).toEqual(['unknown-id']);
  });

  it('rejects a bad slot value and a field a slot does not have', () => {
    const found = problems(
      config(list, [[{ update: 'a.val', fields: { value: true, label: 'x' } }]]),
    );
    expect(found.map((problem) => problem.rule).sort()).toEqual([
      'graph/bad-field',
      'graph/unknown-field',
    ]);
  });

  it('rejects touching a slot of a node that is not there yet (graph nodes start absent)', () => {
    const content = { ...list, nodes: list.nodes.map((node) => ({ ...node, initial: false })) };
    const found = problems(
      config(content, [[{ read: 'a.val' }], [{ add: 'a' }, { read: 'a.val' }]]),
    );
    expect(found.map((problem) => problem.rule)).toEqual(['graph/slot-of-absent-node']);
  });

  it('a flow chart takes records too, under its own rule names', () => {
    const found = problems(config({ ...list, edges: [{ from: 'a.nxt', to: 'b' }] }, [[]], 'flow'));
    expect(found.map((problem) => problem.rule)).toEqual(['flow/unknown-slot']);
  });
});

describe('slot sizes', () => {
  const shape: RecordShape = {
    id: 'a',
    slots: [{ id: 'val', value: 1 }, { id: 'next' }],
    direction: 'row',
    head: false,
    names: true,
  };

  it('reserve the widest value any call writes, so a slot never changes width', () => {
    const input = config(list, [
      [{ update: 'a.val', fields: { value: 'a long value' } }],
      [{ update: 'a.val', fields: { value: 7 } }],
    ]);
    const result = loadConfig(input, createRegistry());
    const walkthrough = result.walkthroughs[0]!.source;
    const widest = widestValues('g', list.nodes, walkthrough);
    expect(widest.get('a.val')).toBe('a long value'.length);
    const wide = recordGeometry(shape, 'a', widest);
    const narrow = recordGeometry(shape, 'a', new Map([['a.val', 1]]));
    expect(wide.slots['val']!.width).toBeGreaterThan(narrow.slots['val']!.width);
  });

  it('place the slots edge to edge, with exact rectangles for anchoring', () => {
    const geometry = recordGeometry(shape, 'a', new Map());
    const val = geometry.slots['val']!;
    const next = geometry.slots['next']!;
    expect(val.x).toBe(0);
    expect(next.x).toBe(val.width);
    expect(geometry.width).toBe(val.width + next.width);
  });

  it('only the end slots of a row open to the left and right', () => {
    expect(openSides(shape, 'val')).toEqual(['top', 'bottom', 'left']);
    expect(openSides(shape, 'next')).toEqual(['top', 'bottom', 'right']);
  });
});

describe('arrow routes', () => {
  const box = (x: number, y: number) => ({ x, y, width: 80, height: 40 });
  const end = (x: number, y: number, slot = false) => {
    const b = box(x, y);
    return slot
      ? {
          box: b,
          slot: { x: x + 40, y, width: 40, height: 40 },
          sides: ['top', 'bottom', 'right'] as const,
        }
      : { box: b };
  };

  it('a forward link runs straight from the slot to the front of the next node', () => {
    const found = route(end(0, 0, true), end(140, 0), false);
    expect([found.start, found.end]).toEqual(['right', 'left']);
  });

  it('a pointer that goes back dips under the row and returns to the node from below', () => {
    const found = route(end(140, 0, true), end(0, 0), false);
    expect([found.start, found.end]).toEqual(['bottom', 'bottom']);
  });

  it('a reference arrives from above, not along the links', () => {
    const found = route(end(0, -120, true), end(200, 0), false, true);
    expect(found.end).toBe('top');
  });

  it('keeps clear of another node in the way', () => {
    const straight = route(end(0, 0, true), end(300, 0), false);
    const blocked = route(end(0, 0, true), end(300, 0), false, false, [box(150, 0)]);
    expect(straight.d).not.toBe(blocked.d);
  });
});

describe('the tree layout', () => {
  const node = (id: string, slots?: string[]): LayoutNode => ({
    id,
    width: 60,
    height: 30,
    ...(slots === undefined ? {} : { slots }),
  });
  const edge = (source: string, target: string, slot?: string): LayoutEdge => ({
    id: `${source}.${target}`,
    source,
    target,
    ...(slot === undefined ? {} : { slot }),
  });

  /** A binary tree: r over (x, y), x over (p, q). Nodes are declared in an odd order on purpose. */
  const nodes = ['q', 'r', 'y', 'p', 'x'].map((id) => node(id, ['left', 'right']));
  const edges = [
    edge('r', 'x', 'left'),
    edge('r', 'y', 'right'),
    edge('x', 'p', 'left'),
    edge('x', 'q', 'right'),
  ];

  it('puts children left to right in the order of the slots they hang from', () => {
    const at = treeLayout(nodes, edges, 'DOWN');
    expect(at['x']!.x).toBeLessThan(at['y']!.x);
    expect(at['p']!.x).toBeLessThan(at['q']!.x);
    // The tree is the same whichever order the nodes were declared in.
    const again = treeLayout([...nodes].reverse(), edges, 'DOWN');
    expect(again).toEqual(at);
  });

  it('without slots, children follow the order the nodes were declared', () => {
    const plain = ['r', 'b', 'a'].map((id) => node(id));
    const at = treeLayout(plain, [edge('r', 'a'), edge('r', 'b')], 'DOWN');
    expect(at['b']!.x).toBeLessThan(at['a']!.x);
  });

  it('centres a parent over its children and puts each depth on one row', () => {
    const at = treeLayout(nodes, edges, 'DOWN');
    const centre = (id: string) => at[id]!.x + 30;
    expect(centre('r')).toBeCloseTo((centre('x') + centre('y')) / 2);
    expect(centre('x')).toBeCloseTo((centre('p') + centre('q')) / 2);
    expect(at['x']!.y).toBe(at['y']!.y);
    expect(at['p']!.y).toBe(at['q']!.y);
    expect(at['p']!.y).toBeGreaterThan(at['x']!.y);
  });

  it('keeps a lone right child on the right of its parent', () => {
    const lone = [
      node('r', ['left', 'right']),
      node('c', ['left', 'right']),
      node('s', ['left', 'right']),
    ];
    const at = treeLayout(lone, [edge('r', 'c', 'right'), edge('s', 'r', 'left')], 'DOWN');
    // c hangs from r.right while another node uses r's left slot name: there is a gap on the left.
    expect(at['c']!.x + 30).toBeGreaterThan(at['r']!.x + 30);
  });

  it('runs rightwards when asked, depth along x', () => {
    const at = treeLayout(nodes, edges, 'RIGHT');
    expect(at['x']!.x).toBeGreaterThan(at['r']!.x);
    expect(at['x']!.y).toBeLessThan(at['y']!.y);
  });

  it('is stable: adding a node leaves the shape of every other subtree alone', () => {
    const before = treeLayout(nodes, edges, 'DOWN');
    const grown = treeLayout(
      [...nodes, node('z', ['left', 'right'])],
      [...edges, edge('y', 'z', 'right')],
      'DOWN',
    );
    // Siblings keep their order.
    expect(grown['x']!.x).toBeLessThan(grown['y']!.x);
    // The subtree under x is the same shape wherever it sits.
    const offset = (positions: typeof before, id: string) => positions[id]!.x - positions['x']!.x;
    for (const id of ['p', 'q']) expect(offset(grown, id)).toBeCloseTo(offset(before, id));
    // And a node with no edges does not disturb anything but the room it takes.
    const lonely = treeLayout([...nodes, node('n')], edges, 'DOWN');
    for (const id of ['p', 'q', 'x']) expect(offset(lonely, id)).toBeCloseTo(offset(before, id));
  });

  it('draws a back pointer without letting it change the tree', () => {
    const back = [...edges, edge('p', 'r', 'left'), edge('q', 'x', 'right')];
    expect(treeLayout(nodes, back, 'DOWN')).toEqual(treeLayout(nodes, edges, 'DOWN'));
    const parents = treeParents(nodes, back);
    expect(parents.get('r')).toBeUndefined();
    expect(parents.get('x')?.source).toBe('r');
  });

  it('ignores an edge marked as not a link of the tree', () => {
    const flagged = [{ ...edge('p', 'y'), tree: false }, ...edges];
    expect(treeParents(nodes, flagged).get('y')?.source).toBe('r');
  });

  it('places several trees side by side and nodes without edges as trees of their own', () => {
    const at = treeLayout([...nodes, node('solo')], edges, 'DOWN');
    expect(at['solo']!.y).toBe(at['r']!.y);
    expect(at['solo']!.x).not.toBe(at['r']!.x);
  });
});
