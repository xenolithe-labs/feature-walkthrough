import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core';
import { crossings, labelHits, throughNodes } from '../../src/panels/_diagram/audit';
import { drawn } from '../../src/panels/_diagram/layout-lint';
import {
  layoutEdgesOf,
  layoutNodesOf,
  layoutOptionsOf,
  sizesOf,
  type InputContent,
} from '../../src/panels/_diagram/input';
import { layoutFull } from '../../src/panels/_diagram/layout';
import { createRegistry } from '../../src/registry';
import { plainDemos } from '../../src/walkthroughs';

/** Every diagram pane of every bundled demo, with its layout. */
async function measureDemos() {
  const config = { walkthroughs: plainDemos };
  const loaded = loadConfig(config, createRegistry());
  expect(loaded.problems.filter((p) => p.severity === 'error')).toEqual([]);
  const rows: {
    demo: string;
    pane: string;
    nodes: number;
    edges: number;
    kind: string;
    straightThrough: number;
    routedThrough: number;
    labelHits: number;
    crossings: number;
  }[] = [];
  for (const walkthrough of loaded.walkthroughs) {
    for (const pane of walkthrough.panes) {
      if (pane.panel.id !== 'graph' && pane.panel.id !== 'flow') continue;
      const content = pane.content as InputContent;
      const sized = sizesOf(pane.id, content, walkthrough.source);
      const sizes = new Map([...sized].map(([id, entry]) => [id, entry.size]));
      const nodes = layoutNodesOf(content, sizes);
      const edges = layoutEdgesOf(content);
      const options = layoutOptionsOf(content);
      const routed = await layoutFull(nodes, edges, content.direction, content.layout, options);
      const asRouted = drawn(content, routed, nodes);
      const asStraight = drawn({ ...content, routing: 'straight' }, routed, nodes);
      rows.push({
        demo: walkthrough.id,
        pane: pane.id,
        nodes: content.nodes.length,
        edges: content.edges.length,
        kind: routed.kind,
        straightThrough: new Set(
          throughNodes(asStraight.nodes, asStraight.edges).map((hit) => hit.edge),
        ).size,
        routedThrough: new Set(throughNodes(asRouted.nodes, asRouted.edges).map((hit) => hit.edge))
          .size,
        labelHits: labelHits(asRouted.nodes, asRouted.edges).length,
        crossings: crossings(asRouted.edges).length,
      });
    }
  }
  return rows;
}

describe('routed edges in the bundled demos (measured)', () => {
  it('no edge passes through an unrelated node in any bundled demo', async () => {
    const rows = await measureDemos();
    console.info(
      [
        'demo / pane: nodes, edges, layout; edges through an unrelated node straight -> routed; label hits; edge crossings',
        ...rows.map(
          (row) =>
            `${row.demo} / ${row.pane}: ${row.nodes} nodes, ${row.edges} edges, ${row.kind}; ` +
            `${row.straightThrough} -> ${row.routedThrough}; labels ${row.labelHits}; crossings ${row.crossings}`,
        ),
      ].join('\n'),
    );
    expect(rows.length).toBeGreaterThanOrEqual(14);
    for (const row of rows) {
      expect(row.routedThrough, `${row.demo} / ${row.pane}`).toBe(0);
    }
  });
});
