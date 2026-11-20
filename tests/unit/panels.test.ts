import { describe, expect, it } from 'vitest';
import { createFolder, formatPath, loadConfig, type ElementsState } from '../../src/core';
import { estimateSize, layout, pinned } from '../../src/panels/_diagram/layout';
import { createRegistry } from '../../src/registry';

function base() {
  return {
    id: 'mini',
    title: 'Mini',
    lanes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
    ],
    layout: {
      panes: [
        { id: 'seq', panel: 'sequence', content: { lanes: ['a', 'b'] } as { lanes: string[] } },
        {
          id: 'graph',
          panel: 'graph',
          content: {
            nodes: [
              { id: 'n1', label: 'One', initial: true },
              { id: 'n2', label: 'Two' },
            ],
            edges: [{ id: 'e1', from: 'n1', to: 'n2', label: 'makes' }],
          },
        },
      ],
    },
    annotations: {
      status: { statuses: { must: { label: 'Must' } } } as {
        statuses: Record<string, { label: string }>;
        required?: boolean;
      },
    },
    steps: [
      {
        id: 's1',
        title: 'S1',
        calls: [
          {
            id: 'c1',
            label: 'a to b',
            from: 'a',
            to: 'b',
            effects: { graph: [{ read: 'n1' }, { add: 'n2' }, { add: 'e1' }] },
            annotations: { status: { status: 'must', note: 'Because.' } } as Record<
              string,
              unknown
            >,
          },
          { id: 'c2', label: 'b to c', from: 'b', to: 'c' },
          { id: 'c3', label: 'think', from: 'a', to: 'a' },
          { id: 'c4', label: 'no lanes' },
        ],
      },
    ],
  };
}

type Base = ReturnType<typeof base>;

function config(change: (value: Base) => void = () => {}): Base {
  const value = base();
  change(value);
  return value;
}

const load = (value: unknown) => loadConfig(value, createRegistry());

describe('sequence panel', () => {
  it('turns lane-to-lane calls into messages, limited to its lanes', () => {
    const result = load(config());
    expect(result.problems).toEqual([]);
    const walkthrough = result.walkthroughs[0]!;
    const seq = walkthrough.panes[0]!;
    expect(seq.entities.map((entity) => entity.id)).toEqual(['a', 'b', 'c1', 'c3']);
    const folder = createFolder(walkthrough);
    expect((folder.at(0, 0).seq!.state as ElementsState).present).toEqual(['a', 'b', 'c1']);
    expect(folder.at(0, 1).seq!.current).toEqual([]);
    expect((folder.at(0, 3).seq!.state as ElementsState).present).toEqual(['a', 'b', 'c1', 'c3']);
  });

  it('shows every lane when none are listed', () => {
    const result = load(
      config((value) => {
        delete (value.layout.panes[0] as { content?: unknown }).content;
      }),
    );
    expect(result.problems).toEqual([]);
    expect(result.walkthroughs[0]!.panes[0]!.entities.map((entity) => entity.id)).toEqual([
      'a',
      'b',
      'c',
      'c1',
      'c2',
      'c3',
    ]);
  });

  it('rejects a lane the walkthrough does not declare', () => {
    const result = load(
      config((value) => {
        (value.layout.panes[0]!.content as { lanes: string[] }).lanes.push('zz');
      }),
    );
    const problem = result.problems.find((item) => item.rule === 'sequence/unknown-lane');
    expect(formatPath(problem!.path)).toBe('layout.panes[0].content.lanes[2]');
  });
});

describe('graph panel', () => {
  it('lists what the call did on the card, with marks', () => {
    const walkthrough = load(config()).walkthroughs[0]!;
    const pane = walkthrough.panes[1]!;
    const view = createFolder(walkthrough).at(0, 0).graph!;
    const sections = pane.panel.cardSections!({
      state: view.state,
      content: pane.content,
      current: view.current,
      call: walkthrough.steps[0]!.calls[0]!,
      pane,
    });
    expect(sections).toEqual([
      {
        id: 'changes',
        title: 'graph',
        kind: 'list',
        items: [
          { label: 'One', entity: 'n1', mark: 'read' },
          { label: 'Two', entity: 'n2', mark: 'added' },
          { label: 'makes', entity: 'e1', mark: 'added' },
        ],
      },
    ]);
  });

  it('rejects an edge to a node that is not in the pane', () => {
    const result = load(
      config((value) => {
        (value.layout.panes[1]!.content as { edges: { to: string }[] }).edges[0]!.to = 'ghost';
      }),
    );
    const problem = result.problems.find((item) => item.rule === 'graph/unknown-node');
    expect(formatPath(problem!.path)).toBe('layout.panes[1].content.edges[0].to');
  });
});

describe('status annotation', () => {
  it('takes its words from the config', () => {
    const walkthrough = load(config()).walkthroughs[0]!;
    const { plugin, config: pluginConfig } = walkthrough.annotations[0]!;
    const data = walkthrough.steps[0]!.calls[0]!.annotations!.status;
    expect(plugin.chip!(data, pluginConfig)).toEqual({
      label: 'Must',
      tone: 'neutral',
      title: 'Because.',
    });
    expect(plugin.cardSections!(data, pluginConfig)).toEqual([
      { id: 'status', title: 'Status', kind: 'text', text: 'Must. Because.' },
    ]);
  });

  it('rejects a status that is not defined', () => {
    const result = load(
      config((value) => {
        value.steps[0]!.calls[0]!.annotations = { status: { status: 'maybe' } };
      }),
    );
    const problem = result.problems.find((item) => item.rule === 'status/unknown');
    expect(formatPath(problem!.path)).toBe('steps[0].calls[0].annotations.status.status');
  });

  it('can require a status on every call', () => {
    const result = load(
      config((value) => {
        value.annotations.status.required = true;
      }),
    );
    const missing = result.problems.filter((item) => item.rule === 'status/missing');
    expect(missing.map((item) => formatPath(item.path))).toEqual([
      'steps[0].calls[1]',
      'steps[0].calls[2]',
      'steps[0].calls[3]',
    ]);
  });
});

describe('diagram layout', () => {
  const nodes = [
    { id: 'a', ...estimateSize('first') },
    { id: 'b', ...estimateSize('second', 'with a longer second line') },
    { id: 'c', ...estimateSize('third') },
  ];
  const edges = [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' },
  ];

  it('uses pinned positions without running a layout', async () => {
    const fixed = nodes.map((node, index) => ({ ...node, x: index * 10, y: 5 }));
    expect(pinned(fixed)).toEqual({ a: { x: 0, y: 5 }, b: { x: 10, y: 5 }, c: { x: 20, y: 5 } });
    expect(pinned(nodes)).toBeUndefined();
    expect(await layout(fixed, edges, 'RIGHT')).toEqual(pinned(fixed));
  });

  it('lays the rest out in layers, the same way every time', async () => {
    const right = await layout(nodes, edges, 'RIGHT');
    expect(right.a!.x).toBeLessThan(right.b!.x);
    expect(right.b!.x).toBeLessThan(right.c!.x);
    const down = await layout(nodes, edges, 'DOWN');
    expect(down.a!.y).toBeLessThan(down.b!.y);
    expect(await layout([...nodes], [...edges], 'RIGHT')).toEqual(right);
  });

  it('sizes a node from its text', () => {
    expect(estimateSize('x').width).toBe(112);
    expect(estimateSize('x'.repeat(200)).width).toBe(270);
    expect(estimateSize('x', 'y').height).toBeGreaterThan(estimateSize('x').height);
  });
});
