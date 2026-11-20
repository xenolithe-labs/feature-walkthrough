import { describe, expect, it } from 'vitest';
import {
  createFolder,
  loadConfig,
  type ElementsState,
  type WalkthroughInput,
} from '../../src/core';
import {
  candidateParents,
  childrenOf,
  isOpen,
  parentOf,
  treeRows,
} from '../../src/panels/tree/model';
import { createRegistry } from '../../src/registry';

type Effects = Record<string, unknown>[];

const nodes = [
  { id: 'root', label: 'Root' },
  { id: 'a', label: 'A', parent: 'root' },
  { id: 'a1', label: 'A1', parent: 'a' },
  { id: 'a2', label: 'A2', parent: 'a' },
  { id: 'b', label: 'B', parent: 'root', parents: ['a'] },
  { id: 'b1', label: 'B1', parent: 'b' },
];

function config(content: unknown, calls: Effects[] = [[]]): WalkthroughInput {
  return {
    id: 't',
    title: 'T',
    layout: { panes: [{ id: 'tree', panel: 'tree', content }] },
    steps: [
      {
        id: 's1',
        title: 'S1',
        calls: calls.map((effects, index) => ({
          id: `c${index + 1}`,
          label: `Call ${index + 1}`,
          effects: { tree: effects } as never,
        })),
      },
    ],
  };
}

const rules = (input: WalkthroughInput) =>
  loadConfig(input, createRegistry()).problems.map((problem) => problem.rule);
const all = new Set(nodes.map((node) => node.id));
const rowsOf = (extra: Partial<Parameters<typeof treeRows>[0]> = {}) =>
  treeRows({ nodes, patches: {}, shown: all, touched: new Set(), ...extra });

describe('tree model', () => {
  it('lists children in declaration order, with depth', () => {
    const rows = rowsOf();
    expect(rows.map((row) => [row.id, row.depth])).toEqual([
      ['root', 0],
      ['a', 1],
      ['a1', 2],
      ['a2', 2],
      ['b', 1],
      ['b1', 2],
    ]);
  });

  it('a move puts the node under its new parent, in declaration order, with its subtree', () => {
    const patches = { b: { parent: 'a' } };
    expect(rowsOf({ patches }).map((row) => [row.id, row.depth])).toEqual([
      ['root', 0],
      ['a', 1],
      ['a1', 2],
      ['a2', 2],
      ['b', 2],
      ['b1', 3],
    ]);
    const known = new Set(all);
    expect(parentOf(nodes[4]!, patches, known)).toBe('a');
    expect(
      childrenOf(nodes, patches)
        .get('a')
        ?.map((node) => node.id),
    ).toEqual(['a1', 'a2', 'b']);
    expect(parentOf(nodes[4]!, { b: { parent: 'nope' } }, known)).toBeUndefined();
  });

  it('draws connectors from what is shown: a tee while a later sibling is shown, an elbow at the last', () => {
    const rows = rowsOf();
    // Depth 1 rows carry one guide to draw (their own); the first entry is the top level's.
    const guides = Object.fromEntries(rows.map((row) => [row.id, row.guides.slice(1)]));
    expect(guides.a).toEqual(['tee']);
    expect(guides.a1).toEqual(['pass', 'tee']);
    expect(guides.a2).toEqual(['pass', 'elbow']);
    expect(guides.b).toEqual(['elbow']);
    expect(guides.b1).toEqual(['none', 'elbow']);
  });

  it('an absent node keeps its row and lets a line pass through it', () => {
    const shown = new Set(['root', 'a', 'a2', 'b']);
    const rows = rowsOf({ shown });
    expect(rows.map((row) => row.id)).toEqual(['root', 'a', 'a1', 'a2', 'b', 'b1']);
    const a1 = rows.find((row) => row.id === 'a1')!;
    expect(a1.shown).toBe(false);
    expect(a1.guides.slice(1)).toEqual(['pass', 'pass']);
    // The last shown sibling ends the line.
    expect(rows.find((row) => row.id === 'a2')!.guides.slice(1)).toEqual(['pass', 'elbow']);
    expect(rows.find((row) => row.id === 'b1')!.guides.slice(1)).toEqual(['none', 'none']);
  });

  it('a collapsed node has no rows below it, and says how many it hides', () => {
    const rows = rowsOf({ patches: { a: { collapsed: true } } });
    expect(rows.map((row) => row.id)).toEqual(['root', 'a', 'b', 'b1']);
    expect(rows[1]).toMatchObject({ open: false, hasChildren: true, hidden: 2, hiddenTouched: 0 });
    // Only what is shown is counted.
    const few = rowsOf({
      patches: { a: { collapsed: true } },
      shown: new Set(['root', 'a', 'a1']),
    });
    expect(few[1]!.hidden).toBe(1);
  });

  it('a call that touches a node opens every ancestor of it', () => {
    const patches = { a: { collapsed: true }, root: { collapsed: true } };
    const rows = rowsOf({ patches, touched: new Set(['a1']) });
    expect(rows.map((row) => [row.id, row.open])).toEqual([
      ['root', true],
      ['a', true],
      ['a1', true],
      ['a2', true],
      ['b', true],
      ['b1', true],
    ]);
    expect(rows.find((row) => row.id === 'a')!.openedByCall).toBe(true);
    // A touched node that is itself collapsed stays collapsed.
    const own = rowsOf({ patches: { a: { collapsed: true } }, touched: new Set(['a']) });
    expect(own.find((row) => row.id === 'a')).toMatchObject({ open: false, hidden: 2 });
  });

  it('the reader beats the call: a node they close says it hides a touched node', () => {
    const rows = rowsOf({ touched: new Set(['a1', 'b']), overrides: { a: false } });
    const a = rows.find((row) => row.id === 'a')!;
    expect(a).toMatchObject({ open: false, hidden: 2, hiddenTouched: 1 });
    expect(rows.map((row) => row.id)).toEqual(['root', 'a', 'b', 'b1']);
    expect(rowsOf({ patches: { a: { collapsed: true } }, overrides: { a: true } })).toHaveLength(6);
  });

  it('one call that collapses a node and touches inside it: the touch wins, the collapse stays set', () => {
    const patches = { a: { collapsed: true } };
    expect(isOpen(nodes[1]!, patches, new Set(['a']), undefined)).toBe(true);
    expect(isOpen(nodes[1]!, patches, new Set(), undefined)).toBe(false);
    expect(isOpen(nodes[1]!, {}, new Set(), { a: false })).toBe(false);
  });

  it('a node with no children has no twisty state and is never hidden', () => {
    const leaf = rowsOf().find((row) => row.id === 'a1')!;
    expect(leaf).toMatchObject({ hasChildren: false, open: true, hidden: 0 });
  });

  it('survives a loop without running forever', () => {
    const loop = [
      { id: 'x', label: 'X', parent: 'y' },
      { id: 'y', label: 'Y', parent: 'x' },
    ];
    expect(() =>
      treeRows({ nodes: loop, patches: {}, shown: new Set(['x', 'y']), touched: new Set(['x']) }),
    ).not.toThrow();
  });

  it('the declared parent is always a candidate', () => {
    expect(candidateParents(nodes[4]!)).toEqual(['a', 'root']);
    expect(candidateParents(nodes[0]!)).toEqual([]);
  });
});

describe('tree lint', () => {
  const content = { nodes };

  it('accepts a tree with a move', () => {
    const input = config(content, [
      [{ update: 'b', fields: { parent: 'a', label: 'B!', tone: 'warn' } }],
    ]);
    expect(loadConfig(input, createRegistry()).problems).toEqual([]);
  });

  it('rejects an unknown parent, in the declaration and in the candidates', () => {
    expect(rules(config({ nodes: [{ id: 'a', label: 'A', parent: 'zz' }] }))).toEqual([
      'tree/unknown-parent',
    ]);
    expect(rules(config({ nodes: [{ id: 'a', label: 'A', parents: ['zz'] }] }))).toEqual([
      'tree/unknown-parent',
    ]);
  });

  it('rejects a declared cycle, once, and a node that lists itself', () => {
    const loop = [
      { id: 'x', label: 'X', parent: 'y' },
      { id: 'y', label: 'Y', parent: 'x' },
      { id: 'z', label: 'Z', parent: 'x' },
    ];
    expect(rules(config({ nodes: loop }))).toEqual(['tree/cycle', 'tree/cycle']);
    expect(rules(config({ nodes: [{ id: 'a', label: 'A', parents: ['a'] }] }))).toEqual([
      'tree/cycle',
    ]);
  });

  it('rejects a move outside the declared candidates, and says what they are', () => {
    const input = config(content, [[{ update: 'a1', fields: { parent: 'b' } }]]);
    const problem = loadConfig(input, createRegistry()).problems[0]!;
    expect(problem.rule).toBe('tree/bad-move');
    expect(problem.message).toContain('candidate parents are: a');
    const none = loadConfig(
      config(content, [[{ update: 'root', fields: { parent: 'a' } }]]),
      createRegistry(),
    ).problems[0]!;
    expect(none.message).toContain('no candidate parents');
    const second = loadConfig(
      config(content, [[{ update: 'b', fields: { parent: 'a2' } }]]),
      createRegistry(),
    ).problems[0]!;
    expect(second.rule).toBe('tree/bad-move');
    expect(second.message).toContain('a, root');
  });

  it('allows moving back to the declared parent', () => {
    const calls = [
      [{ update: 'b', fields: { parent: 'a' } }],
      [{ update: 'b', fields: { parent: 'root' } }],
    ];
    expect(rules(config(content, calls))).toEqual([]);
  });

  it('rejects a cycle that only a sequence of moves makes', () => {
    const swap = [
      { id: 'p', label: 'P', parents: ['q'] },
      { id: 'q', label: 'Q', parent: 'p', parents: ['p'] },
    ];
    // q hangs under p; moving p under q would put p under itself.
    expect(rules(config({ nodes: swap }, [[{ update: 'p', fields: { parent: 'q' } }]]))).toEqual([
      'tree/cycle',
    ]);
    // Moving q to the top is not possible (no top-level candidate), but q under p is where it is.
    const chain = [
      { id: 'r', label: 'R' },
      { id: 'm', label: 'M', parent: 'r', parents: ['n'] },
      { id: 'n', label: 'N', parent: 'r', parents: ['m'] },
    ];
    const calls = [
      [{ update: 'm', fields: { parent: 'n' } }],
      [{ update: 'n', fields: { parent: 'm' } }],
    ];
    expect(rules(config({ nodes: chain }, calls))).toEqual(['tree/cycle']);
  });

  it('rejects a move under an absent node, an add under an absent parent, and a remove with children', () => {
    const lazy = [
      { id: 'r', label: 'R' },
      { id: 'k', label: 'K', parent: 'r', initial: false },
      { id: 'j', label: 'J', parent: 'k', initial: false },
      { id: 'm', label: 'M', parent: 'r', parents: ['k'] },
    ];
    expect(rules(config({ nodes: lazy }, [[{ update: 'm', fields: { parent: 'k' } }]]))).toEqual([
      'tree/parent-absent',
    ]);
    expect(rules(config({ nodes: lazy }, [[{ add: 'j' }]]))).toEqual(['tree/parent-absent']);
    expect(
      rules(config({ nodes: lazy }, [[{ add: 'k' }, { add: 'j' }], [{ remove: 'k' }]])),
    ).toEqual(['tree/remove-parent']);
    expect(
      rules(
        config({ nodes: lazy }, [
          [{ add: 'k' }, { add: 'j' }],
          [{ remove: 'j' }, { remove: 'k' }],
        ]),
      ),
    ).toEqual([]);
    expect(
      rules(
        config({
          nodes: [
            { id: 'r', label: 'R', initial: false },
            { id: 's', label: 'S', parent: 'r' },
          ],
        }),
      ),
    ).toEqual(['tree/parent-absent']);
  });

  it('removing a node forgets its move: it comes back where it was declared', () => {
    const calls = [
      [{ update: 'b', fields: { parent: 'a' } }],
      [{ remove: 'b1' }, { remove: 'b' }],
      [{ add: 'b' }, { add: 'b1' }],
    ];
    const loaded = loadConfig(config(content, calls), createRegistry());
    expect(loaded.problems).toEqual([]);
    const state = createFolder(loaded.walkthroughs[0]!).at(0, 2).tree!.state as ElementsState;
    expect(state.patches.b).toBeUndefined();
  });

  it('checks the kind of each field', () => {
    const bad = (fields: Record<string, unknown>) =>
      rules(config(content, [[{ update: 'a', fields }]]));
    expect(bad({ collapsed: 'yes' })).toEqual(['tree/bad-field']);
    expect(bad({ collapsed: true })).toEqual([]);
    expect(bad({ label: '' })).toEqual(['tree/bad-field']);
    expect(bad({ label: 'New', sub: 'text' })).toEqual([]);
    expect(bad({ sub: 3 })).toEqual(['tree/bad-field']);
    expect(bad({ tone: 'loud' })).toEqual(['tree/bad-tone']);
    expect(bad({ parent: 5 })).toEqual(['tree/bad-field']);
    expect(bad({ nope: 'x' })).toEqual(['tree/unknown-field']);
  });
});

describe('tree state', () => {
  it('update patches label, tone, collapsed and parent; a later update of one keeps the others', () => {
    const loaded = loadConfig(
      config({ nodes }, [
        [{ update: 'b', fields: { parent: 'a', collapsed: true } }],
        [{ update: 'b', fields: { label: 'Bee' } }],
      ]),
      createRegistry(),
    );
    const state = createFolder(loaded.walkthroughs[0]!).at(0, 1).tree!.state as ElementsState;
    expect(state.patches.b).toEqual({ parent: 'a', collapsed: true, label: 'Bee' });
    expect(state.present).toHaveLength(nodes.length);
  });
});
