import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core';
import { hubLayout } from '../../src/panels/_diagram/hub-layout';
import {
  layoutEdgesOf,
  layoutNodesOf,
  sizesOf,
  type InputContent,
} from '../../src/panels/_diagram/input';
import { layoutFull, type LayoutNode } from '../../src/panels/_diagram/layout';
import { flatten } from '../../src/panels/_diagram/route';
import { DISC, circleSize, discLines } from '../../src/panels/_diagram/shape';
import { createRegistry } from '../../src/registry';
import { dependencyVulnerability } from '../../src/walkthroughs/dependency-vulnerability';

const n = (id: string, extra: Partial<LayoutNode> = {}): LayoutNode & { disc?: number } => ({
  id,
  width: 100,
  height: 90,
  disc: 56,
  ...extra,
});
const e = (source: string, target: string) => ({ id: `${source}.${target}`, source, target });
const nothing = () => ({ width: 30, height: 20 });

describe('hub layout', () => {
  const nodes = [
    n('hub'),
    n('l1', { side: 'left' }),
    n('l2', { side: 'left' }),
    n('r1', { side: 'right' }),
    n('l1a'),
    n('l1b'),
    n('r1a'),
    n('r1a1'),
  ];
  const edges = [
    e('hub', 'l1'),
    e('hub', 'l2'),
    e('hub', 'r1'),
    e('l1', 'l1a'),
    e('l1', 'l1b'),
    e('r1', 'r1a'),
    e('r1a', 'r1a1'),
  ];
  const { positions, routes } = hubLayout(nodes, edges, nothing);
  const centre = (id: string) => positions[id]!.x + 50;

  it('puts the hub in the middle, the `side: left` branches to its left and the rest to its right', () => {
    for (const id of ['l1', 'l2', 'l1a', 'l1b']) expect(centre(id)).toBeLessThan(centre('hub'));
    for (const id of ['r1', 'r1a', 'r1a1']) expect(centre(id)).toBeGreaterThan(centre('hub'));
  });

  it('goes level after level: each generation is further out than its parent', () => {
    expect(centre('l1a')).toBeLessThan(centre('l1'));
    expect(centre('r1a1')).toBeGreaterThan(centre('r1a'));
    expect(centre('r1a')).toBeGreaterThan(centre('r1'));
  });

  it('fans children evenly: siblings are stacked, centred on their parent', () => {
    const middle = (id: string) => positions[id]!.y + 45;
    expect((middle('l1a') + middle('l1b')) / 2).toBeCloseTo(middle('l1'), 0);
    expect(middle('l1a')).not.toBe(middle('l1b'));
  });

  it('children of the hub with no side go to the side with fewer nodes so far', () => {
    const balanced = hubLayout(
      [n('h'), n('a'), n('b'), n('a1'), n('a2')],
      [e('h', 'a'), e('h', 'b'), e('a', 'a1'), e('a', 'a2')],
      nothing,
    ).positions;
    // a (with two children) goes right first, so b goes left.
    expect(balanced.a!.x).toBeGreaterThan(balanced.h!.x);
    expect(balanced.b!.x).toBeLessThan(balanced.h!.x);
  });

  it('draws a smooth curve from a parent to each child, starting together on the parent', () => {
    const from = (id: string) => routes[`hub.${id}`]!;
    expect(from('l1').style).toBe('bezier');
    expect(from('l1').points).toHaveLength(4);
    // The curves to the two left children leave the hub at the same point.
    expect(from('l1').points[0]).toEqual(from('l2').points[0]);
    // Each ends on the disc of its child, not on the box around it and its label.
    const end = from('l1').points[3]!;
    const box = positions.l1!;
    expect(end.y).toBeCloseTo(box.y + DISC / 2, 0);
    // No point of a curve is outside the picture between the two discs by much.
    for (const p of flatten(from('l1').points, 'bezier')) {
      expect(p.x).toBeLessThanOrEqual(positions.hub!.x + 100);
    }
  });

  it('a node whose parent is another tree stays out of the hub trees: separate roots go underneath', () => {
    const forest = hubLayout(
      [n('h'), n('a'), n('lone'), n('lone2')],
      [e('h', 'a'), e('lone', 'lone2')],
      nothing,
    ).positions;
    expect(forest.lone!.y).toBeGreaterThan(forest.h!.y + 90);
  });

  it('is deterministic, and layoutFull uses it for `layout: hub`', async () => {
    const first = await layoutFull(nodes, edges, 'RIGHT', 'hub', {});
    expect(first.kind).toBe('hub');
    expect(await layoutFull([...nodes], [...edges], 'RIGHT', 'hub', {})).toEqual(first);
    expect(first.routes['hub.l1']).toBeDefined();
  });
});

describe('disc nodes', () => {
  it('break a label into at most two short lines and size the box to hold disc and label', () => {
    expect(discLines('Reachable over the network')).toEqual(['Reachable over', 'the network']);
    expect(discLines('averyveryverylongsingleword that goes on')).toHaveLength(2);
    const size = circleSize('Reachable over the network');
    expect(size.height).toBeGreaterThan(DISC + 20);
    expect(circleSize('A', 'a second line').height).toBeGreaterThan(circleSize('A').height);
    expect(size.width).toBeGreaterThanOrEqual(DISC);
  });

  it('shape, badge, accent and more are read from the config and reach the layout', () => {
    const loaded = loadConfig(dependencyVulnerability, createRegistry());
    expect(loaded.problems).toEqual([]);
    const pane = loaded.walkthroughs[0]!.panes.find((p) => p.id === 'hub')!;
    const content = pane.content as InputContent;
    const sized = sizesOf(pane.id, content, loaded.walkthroughs[0]!.source);
    const sizes = new Map([...sized].map(([id, entry]) => [id, entry.size]));
    const nodes = layoutNodesOf(content, sizes);
    expect(nodes.every((node) => node.disc === DISC)).toBe(true);
    expect(nodes.find((node) => node.id === 'weak')!.side).toBe('left');
    expect(layoutEdgesOf(content)).toHaveLength(content.edges.length);
  });

  it('`more` makes a disc, and a badge can be changed by a call but not set to nonsense', () => {
    const base = (effect: object) => ({
      id: 'w',
      title: 'W',
      layout: {
        panes: [
          {
            id: 'g',
            panel: 'graph',
            content: { initial: true, nodes: [{ id: 'a', label: 'A', badge: 1 }], edges: [] },
          },
        ],
      },
      steps: [{ id: 's', title: 'S', calls: [{ id: 'c', label: 'C', effects: { g: [effect] } }] }],
    });
    const rules = (config: unknown) =>
      loadConfig(config, createRegistry()).problems.map((p) => p.rule);
    expect(rules(base({ update: 'a', fields: { badge: 7 } }))).toEqual([]);
    expect(rules(base({ update: 'a', fields: { badge: 'new' } }))).toEqual([]);
    expect(rules(base({ update: 'a', fields: { badge: 'much too long a badge' } }))).toEqual([
      'graph/bad-field',
    ]);
    // Placement and layout hints are not fields a call may change.
    expect(rules(base({ update: 'a', fields: { cell: [1, 1] } }))).toEqual(['graph/unknown-field']);
  });
});

describe('what routing costs (measured)', () => {
  /** A tree-ish graph of `count` nodes with some cross links and a label on every fourth edge. */
  function graph(count: number) {
    const nodes: LayoutNode[] = Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      width: 120,
      height: 40,
    }));
    const edges = [];
    for (let i = 1; i < count; i += 1) {
      edges.push({
        id: `e${i}`,
        source: `n${Math.floor((i - 1) / 2)}`,
        target: `n${i}`,
        ...(i % 4 === 0 ? { label: 'call' } : {}),
      });
      if (i % 6 === 0) {
        edges.push({ id: `x${i}`, source: `n${i}`, target: `n${(i * 5) % count}` });
      }
    }
    return { nodes, edges };
  }

  it('ELK with routes and labels against ELK for positions alone, at 100 and 300 nodes', async () => {
    const lines: string[] = [];
    // Warm up the engine, so the first size does not pay for loading it.
    await layoutFull(graph(20).nodes, graph(20).edges, 'DOWN', 'layered', { spacing: 'compact' });
    for (const count of [100, 300]) {
      const { nodes, edges } = graph(count);
      // Before: positions only (what the viewer asked ELK for): no labels. Compared on the same run
      // by asking for straight lines, which leaves labels out of ELK's input.
      const t0 = performance.now();
      await layoutFull(nodes, edges, 'DOWN', 'layered', { routing: 'straight' });
      const plain = performance.now() - t0;
      const t1 = performance.now();
      const routed = await layoutFull(nodes, edges, 'DOWN', 'layered', { routing: 'orthogonal' });
      const withRoutes = performance.now() - t1;
      lines.push(
        `${count} nodes, ${edges.length} edges: positions only ${plain.toFixed(0)} ms, with routes and labels ${withRoutes.toFixed(0)} ms (${routed.kind})`,
      );
      expect(Object.keys(routed.routes).length).toBeGreaterThan(edges.length * 0.9);
      expect(withRoutes).toBeLessThan(8000);
    }
    console.info(lines.join('\n'));
  });
});
