import { describe, expect, it } from 'vitest';
import {
  createFolder,
  formatProblem,
  loadConfig,
  type ElementsState,
  type WalkthroughInput,
} from '../../src/core';
import {
  ArrayContent,
  describePointer,
  rangeBounds,
  valuesOf,
  type PointerDecl,
} from '../../src/panels/array/model';
import { createRegistry } from '../../src/registry';

type Effects = Record<string, Record<string, unknown>[]>;

function config(
  content: unknown,
  calls: Effects[] = [{}],
  extraPanes: WalkthroughInput['layout']['panes'] = [],
): WalkthroughInput {
  return {
    id: 'a',
    title: 'A',
    layout: { panes: [{ id: 'row', panel: 'array', content }, ...extraPanes] },
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

const content = {
  arrays: [{ id: 'a', cells: [4, 8, 15, 16], length: 6 }],
  pointers: [
    { id: 'lo', at: 0 },
    { id: 'hi', at: 3 },
  ],
  ranges: [{ id: 'win', from: 'lo', to: 'hi', dim: true }],
};

const load = (value: WalkthroughInput) => loadConfig(value, createRegistry());
const rules = (value: WalkthroughInput) =>
  load(value).problems.map((problem) => `${problem.severity} ${problem.rule}`);

describe('array panel: elements', () => {
  it('declares a cell per slot, a pointer and a range, and starts with the filled cells', () => {
    const result = load(config(content));
    expect(result.problems).toEqual([]);
    const pane = result.walkthroughs[0]!.panes[0]!;
    expect(pane.entities.map((entity) => entity.id)).toEqual([
      'a.0',
      'a.1',
      'a.2',
      'a.3',
      'a.4',
      'a.5',
      'lo',
      'hi',
      'win',
    ]);
    expect(pane.entities.filter((entity) => entity.initial).map((entity) => entity.id)).toEqual([
      'a.0',
      'a.1',
      'a.2',
      'a.3',
      'lo',
      'hi',
      'win',
    ]);
  });

  it('names cells by the array id, so cards read a[2]', () => {
    const pane = load(config(content)).walkthroughs[0]!.panes[0]!;
    expect(pane.entities.find((entity) => entity.id === 'a.2')!.label).toBe('a[2]');
  });
});

describe('array panel: state', () => {
  const walkthrough = (calls: Effects[]) => load(config(content, calls)).walkthroughs[0]!;
  const stateAt = (calls: Effects[], c: number) => {
    const w = walkthrough(calls);
    return {
      state: createFolder(w).at(0, c)['row']!.state as ElementsState,
      parsed: ArrayContent.parse(w.panes[0]!.content),
    };
  };

  it('a pointer moves with one update: nothing is cleared by hand', () => {
    const { state, parsed } = stateAt(
      [
        { row: [{ update: 'lo', fields: { at: 1 } }] },
        { row: [{ update: 'lo', fields: { at: 2 } }] },
      ],
      1,
    );
    expect(state.patches['lo']?.at).toBe(2);
    expect(describePointer(parsed, parsed.pointers[0]!, state)).toBe('index 2 (value 15)');
  });

  it('a range bound to pointers follows them, and is empty when they cross', () => {
    const { state, parsed } = stateAt(
      [
        { row: [{ update: 'lo', fields: { at: 3 } }] },
        { row: [{ update: 'hi', fields: { at: 2 } }] },
      ],
      1,
    );
    expect(rangeBounds(parsed, parsed.ranges[0]!, state)).toEqual({ from: 3, to: 2 });
  });

  it('a range that follows a pointer that is not there has no bounds', () => {
    const { state, parsed } = stateAt([{ row: [{ remove: 'lo' }] }, { row: [] }], 0);
    expect(rangeBounds(parsed, parsed.ranges[0]!, state)).toBeNull();
  });

  it('values change with update, and grow and shrink with add and remove', () => {
    const calls: Effects[] = [
      { row: [{ update: 'a.1', fields: { value: 99 } }] },
      { row: [{ add: 'a.4' }, { update: 'a.4', fields: { value: 23 } }] },
      { row: [{ remove: 'a.0' }] },
    ];
    const { state, parsed } = stateAt(calls, 2);
    expect(valuesOf(parsed, state, 'a')).toEqual([99, 15, 16, 23]);
  });

  it('describes a pointer off either end', () => {
    const { parsed } = stateAt([{}], 0);
    const off = (at: number | null): PointerDecl => ({ ...parsed.pointers[0]!, at });
    const state = { present: [], patches: {}, focus: undefined, value: undefined } as ElementsState;
    expect(describePointer(parsed, off(-1), state)).toBe('index -1, before the start');
    expect(describePointer(parsed, off(6), state)).toBe('index 6, past the end');
    expect(describePointer(parsed, off(null), state)).toBe('nothing');
  });
});

describe('array panel: lint', () => {
  const pointer = (fields: Record<string, unknown>) => ({ row: [{ update: 'lo', fields }] });

  it('accepts a pointer one past either end, and null', () => {
    expect(
      rules(config(content, [pointer({ at: -1 }), pointer({ at: 6 }), pointer({ at: null })])),
    ).toEqual([]);
  });

  it('refuses a pointer further off the array than that', () => {
    expect(rules(config(content, [pointer({ at: 7 })]))).toEqual([
      'error array/index-out-of-range',
    ]);
    expect(rules(config(content, [pointer({ at: -2 })]))).toEqual([
      'error array/index-out-of-range',
    ]);
    expect(rules(config(content, [pointer({ at: 1.5 })]))).toEqual([
      'error array/index-out-of-range',
    ]);
  });

  it('refuses fields an element does not have', () => {
    const calls = [
      { row: [{ update: 'a.0', fields: { at: 1 } }] },
      { row: [{ update: 'lo', fields: { value: 1 } }] },
    ];
    expect(rules(config(content, calls))).toEqual([
      'error array/unknown-field',
      'error array/unknown-field',
    ]);
  });

  it('refuses a cell value that is not text or a number', () => {
    expect(rules(config(content, [{ row: [{ update: 'a.0', fields: { value: [1] } }] }]))).toEqual([
      'error array/bad-value',
    ]);
  });

  it('names the element and the path of a mistake', () => {
    const result = load(config(content, [pointer({ at: 9 })]));
    expect(result.problems.map(formatProblem)).toEqual([
      'error array/index-out-of-range at steps[0].calls[0].effects.row[0].fields.at: "lo" at must be an integer from -1 to 6 (one past either end is allowed); got 9',
    ]);
  });

  it('refuses a range bound to something that is not a pointer, or to a pointer of another array', () => {
    const two = {
      arrays: [
        { id: 'a', cells: [1, 2] },
        { id: 'b', cells: [3, 4] },
      ],
      pointers: [{ id: 'p', array: 'a', at: 0 }],
      ranges: [
        { id: 'r1', array: 'a', from: 'nope', to: 1 },
        { id: 'r2', array: 'b', from: 'p', to: 1 },
      ],
    };
    expect(rules(config(two))).toEqual([
      'error array/unknown-pointer',
      'error array/pointer-other-array',
    ]);
  });

  it('wants the array named when there are several, and refuses one that is not there', () => {
    const several = (pointer: Record<string, unknown>) => ({
      arrays: [
        { id: 'a', cells: [1] },
        { id: 'b', cells: [2] },
      ],
      pointers: [{ id: 'p', at: 0, ...pointer }],
    });
    expect(rules(config(several({})))).toEqual(['error array/ambiguous-array']);
    expect(rules(config(several({ array: 'c' })))).toEqual(['error array/unknown-array']);
    expect(rules(config(several({ array: 'b' })))).toEqual([]);
  });

  it('refuses a literal range that runs backwards by more than the empty case', () => {
    const range = (from: number, to: number) => ({
      arrays: [{ id: 'a', cells: [1, 2, 3] }],
      ranges: [{ id: 'r', from, to }],
    });
    expect(rules(config(range(2, 1)))).toEqual([]);
    expect(rules(config(range(3, 1)))).toEqual(['error array/bad-range']);
  });

  it('warns about a misspelt key on an effect, which would otherwise be ignored silently', () => {
    expect(rules(config(content, [{ row: [{ read: 'a.0', cell: 1 }] }]))).toEqual([
      'warning array/unknown-key',
    ]);
  });

  it('is caught by the shared rules: an unknown id, and a pointer used before it was added', () => {
    expect(rules(config(content, [{ row: [{ read: 'a.9' }] }]))).toEqual(['error unknown-id']);
    const late = { ...content, pointers: [{ id: 'lo', at: 0, initial: false }], ranges: [] };
    expect(rules(config(late, [{ row: [{ update: 'lo', fields: { at: 1 } }] }]))).toEqual([
      'error absent-element',
    ]);
  });
});

describe('code panel: pointer, badge and expressions', () => {
  const source = { id: 'src', title: 'f.js', text: 'let a = 1;\nwhile (a < 10) {\n  a *= 2;\n}' };
  const code = (calls: Effects[]) => ({
    id: 'c',
    title: 'C',
    layout: { panes: [{ id: 'code', panel: 'code', content: { sources: [source] } }] },
    steps: [
      {
        id: 's',
        title: 'S',
        calls: calls.map((effects, index) => ({
          id: `c${index}`,
          label: 'x',
          effects: effects as never,
        })),
      },
    ],
  });
  const codeRules = (calls: Effects[]) =>
    load(code(calls)).problems.map((problem) => `${problem.severity} ${problem.rule}`);

  it('keeps the current line and badge until a later call moves them', () => {
    const result = load(
      code([
        {
          code: [
            { update: 'src', fields: { at: 2, badge: 'run 1' } },
            { read: 'src', lines: [2] },
          ],
        },
        { code: [{ read: 'src', lines: [3] }] },
      ]),
    );
    expect(result.problems).toEqual([]);
    const state = createFolder(result.walkthroughs[0]!).at(0, 1)['code']!.state as ElementsState;
    expect(state.patches['src']).toEqual({ at: 2, badge: 'run 1' });
  });

  it('accepts an expression that is on the marked line', () => {
    expect(codeRules([{ code: [{ read: 'src', lines: [2], expr: 'a < 10' }] }])).toEqual([]);
    expect(
      codeRules([{ code: [{ read: 'src', lines: [2, 3], expr: ['a < 10', 'a *= 2'] }] }]),
    ).toEqual([]);
  });

  it('refuses an expression that is not on the lines it is marked on', () => {
    expect(codeRules([{ code: [{ read: 'src', lines: [1], expr: 'a < 10' }] }])).toEqual([
      'error code/expr-not-on-lines',
    ]);
    expect(codeRules([{ code: [{ read: 'src', expr: 'a < 10' }] }])).toEqual([
      'error code/expr-not-on-lines',
    ]);
  });

  it('follows a text change when it checks an expression', () => {
    const calls: Effects[] = [
      { code: [{ update: 'src', fields: { text: 'let b = 2;' } }] },
      { code: [{ read: 'src', lines: [1], expr: 'b = 2' }] },
      { code: [{ read: 'src', lines: [1], expr: 'a = 1' }] },
    ];
    expect(codeRules(calls)).toEqual(['error code/expr-not-on-lines']);
  });

  it('refuses a current line that is not in the source', () => {
    expect(codeRules([{ code: [{ update: 'src', fields: { at: 9 } }] }])).toEqual([
      'error code/line-out-of-range',
    ]);
    expect(codeRules([{ code: [{ update: 'src', fields: { at: null } }] }])).toEqual([]);
  });

  it('warns about a misspelt key, such as "line" for "lines"', () => {
    expect(codeRules([{ code: [{ read: 'src', line: [2] }] }])).toEqual([
      'warning code/unknown-key',
    ]);
  });
});
