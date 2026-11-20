import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createFolder,
  formatProblem,
  loadConfig,
  type ElementsState,
  type ResolvedWalkthrough,
} from '../../src/core';
import { patched } from '../../src/panels/payload/paths';
import { createRegistry } from '../../src/registry';
import { randomWalkthrough, rng, wrap } from './gen';
import { cursorsOf, modelAt, modelFocusPane } from './model';

const registry = createRegistry();

function load(config: unknown): ResolvedWalkthrough {
  const result = loadConfig(config, registry);
  const errors = result.problems.filter((p) => p.severity === 'error').map(formatProblem);
  expect(errors, 'the config must pass lint').toEqual([]);
  return result.walkthroughs[0]!;
}

function shuffled<T>(items: T[], seed: number): T[] {
  const r = rng(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = r.int(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function project(state: unknown) {
  const s = state as ElementsState;
  return { present: [...s.present], patches: s.patches, focus: s.focus, value: s.value };
}

describe('generated configs that use every panel and every verb', () => {
  it('the generator itself produces lint-clean configs (sanity for the properties below)', () => {
    for (let seed = 1; seed <= 60; seed += 1) load(randomWalkthrough(seed));
  });

  it('actually exercises every verb and every panel type', () => {
    const verbs = new Set<string>();
    const panels = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      const w = randomWalkthrough(seed);
      w.layout.panes.forEach((p) => panels.add(p.panel));
      for (const step of w.steps) {
        for (const call of step.calls) {
          for (const list of Object.values(call.effects ?? {})) {
            for (const effect of list) {
              for (const key of ['add', 'update', 'read', 'remove', 'focus', 'set']) {
                if (key in effect) verbs.add(key);
              }
            }
          }
        }
      }
    }
    expect([...verbs].sort()).toEqual(['add', 'focus', 'read', 'remove', 'set', 'update']);
    expect([...panels].sort()).toEqual(
      ['boxes', 'code', 'flow', 'graph', 'payload', 'schema', 'sequence', 'table'].sort(),
    );
  });

  it('state at a cursor equals the independent model, in any visiting order', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer(), (seed, order) => {
        const w = load(randomWalkthrough(seed, { steps: 6, calls: 4 }));
        const folder = createFolder(w);
        for (const { s, c } of shuffled(cursorsOf(w), order)) {
          const views = folder.at(s, c);
          const model = modelAt(w, s, c);
          for (const pane of w.panes) {
            expect(
              project(views[pane.id]!.state),
              `seed ${seed}, pane ${pane.id} at ${s}.${c}`,
            ).toEqual(model[pane.id]);
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it('the cached answer equals a recompute from zero, and the shown focus pane equals the model', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer(), (seed, order) => {
        const w = load(randomWalkthrough(seed, { steps: 6, calls: 4 }));
        const folder = createFolder(w);
        for (const { s, c } of shuffled(cursorsOf(w), order)) {
          expect(folder.at(s, c), `seed ${seed} at ${s}.${c}`).toEqual(folder.fromZero(s, c));
          expect(folder.focusPane(s, c)).toBe(modelFocusPane(w, s, c));
        }
      }),
      { numRuns: 60 },
    );
  });

  it('stepping backwards gives exactly the states seen stepping forwards', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const w = load(randomWalkthrough(seed, { steps: 5, calls: 5 }));
        const forward = createFolder(w);
        const seen = cursorsOf(w).map(({ s, c }) => JSON.stringify(forward.at(s, c)));
        const backward = createFolder(w);
        const again = [...cursorsOf(w)]
          .reverse()
          .map(({ s, c }) => JSON.stringify(backward.at(s, c)));
        expect(again.reverse()).toEqual(seen);
      }),
      { numRuns: 40 },
    );
  });

  it('reducers never mutate a state they were handed (deep-frozen walk)', () => {
    const freeze = (value: unknown): void => {
      if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(freeze);
      }
    };
    for (let seed = 1; seed <= 30; seed += 1) {
      const w = load(randomWalkthrough(seed, { steps: 4, calls: 4 }));
      const folder = createFolder(w);
      for (const { s, c } of cursorsOf(w)) {
        const views = folder.at(s, c);
        Object.values(views).forEach((v) => freeze(v.state));
      }
      // A second pass over frozen snapshots would throw in strict mode if a reducer mutated.
      for (const { s, c } of cursorsOf(w)) expect(() => folder.at(s, c)).not.toThrow();
    }
  });
});

describe('re-adding, removing and patching the same element', () => {
  const table = (calls: Record<string, unknown>[]) =>
    wrap(
      'readd',
      [
        {
          id: 't',
          panel: 'table',
          content: {
            columns: [{ id: 'v', label: 'V' }],
            rows: [{ id: 'r', cells: { v: 'base' } }],
            initial: false,
          },
        },
      ],
      [{ id: 's', title: 'S', calls: calls as never }],
    );

  it('a patch does not survive remove and re-add', () => {
    const calls: Record<string, unknown>[] = [
      { id: 'c0', label: 'add', effects: { t: [{ add: 'r' }] } },
    ];
    for (let i = 0; i < 25; i += 1) {
      calls.push(
        {
          id: `u${i}`,
          label: 'u',
          effects: { t: [{ update: 'r', fields: { v: `v${i}`, tone: 'warn' } }] },
        },
        { id: `x${i}`, label: 'x', effects: { t: [{ remove: 'r' }] } },
        { id: `a${i}`, label: 'a', effects: { t: [{ add: 'r' }] } },
      );
    }
    const w = load(table(calls));
    const folder = createFolder(w);
    const last = calls.length - 1;
    const state = folder.at(0, last).t!.state as ElementsState;
    expect(state.present).toEqual(['r']);
    expect(state.patches).toEqual({});
    expect(folder.at(0, last - 1).t!.state).toMatchObject({ present: [] });
  });

  it('add, update and remove in one call leave the element absent and unpatched', () => {
    const w = load(
      table([
        {
          id: 'c0',
          label: 'all at once',
          effects: { t: [{ add: 'r' }, { update: 'r', fields: { v: 'x' } }, { remove: 'r' }] },
        },
      ]),
    );
    expect(createFolder(w).at(0, 0).t!.state).toMatchObject({ present: [], patches: {} });
  });

  it('read then remove in one call is accepted, remove then read is rejected', () => {
    const ok = loadConfig(
      table([
        { id: 'c0', label: 'a', effects: { t: [{ add: 'r' }, { read: 'r' }, { remove: 'r' }] } },
      ]),
      registry,
    );
    expect(ok.ok).toBe(true);
    const bad = loadConfig(
      table([
        { id: 'c0', label: 'a', effects: { t: [{ add: 'r' }, { remove: 'r' }, { read: 'r' }] } },
      ]),
      registry,
    );
    expect(bad.problems.filter((p) => p.severity === 'error')).toHaveLength(1);
    expect(bad.problems[0]).toMatchObject({
      rule: 'absent-element',
      path: ['steps', 0, 'calls', 0, 'effects', 't', 2, 'read'],
    });
  });

  it('adding a present element twice is a warning, not an error, and changes nothing', () => {
    const result = loadConfig(
      table([{ id: 'c0', label: 'a', effects: { t: [{ add: 'r' }, { add: 'r' }] } }]),
      registry,
    );
    expect(result.ok).toBe(true);
    expect(result.problems.map((p) => p.rule)).toEqual(['already-present']);
    expect(createFolder(result.walkthroughs[0]!).at(0, 0).t!.state).toMatchObject({
      present: ['r'],
    });
  });

  it('focus on an element is dropped when that element is removed, even if re-added later', () => {
    const w = load(
      table([
        { id: 'c0', label: 'a', effects: { t: [{ add: 'r' }, { focus: 'r' }] } },
        { id: 'c1', label: 'b', effects: { t: [{ remove: 'r' }] } },
        { id: 'c2', label: 'c', effects: { t: [{ add: 'r' }] } },
      ]),
    );
    const folder = createFolder(w);
    expect((folder.at(0, 0).t!.state as ElementsState).focus).toBe('r');
    expect((folder.at(0, 1).t!.state as ElementsState).focus).toBeUndefined();
    expect((folder.at(0, 2).t!.state as ElementsState).focus).toBeUndefined();
  });
});

describe('payload patches', () => {
  const payloadWalk = (value: unknown, updates: Record<string, unknown>[]) =>
    wrap(
      'pl',
      [{ id: 'p', panel: 'payload', content: { payloads: [{ id: 'doc', title: 'Doc', value }] } }],
      [
        {
          id: 's',
          title: 'S',
          calls: updates.map((fields, i) => ({
            id: `u${i}`,
            label: `u${i}`,
            effects: { p: [{ update: 'doc', fields }] },
          })),
        },
      ],
    );

  function valueAfter(w: ResolvedWalkthrough, c: number): unknown {
    const state = createFolder(w).at(0, c).p!.state as ElementsState;
    return patched(
      w.panes[0]!.content &&
        (w.panes[0]!.content as { payloads: { value: unknown }[] }).payloads[0]!.value,
      state.patches.doc,
    );
  }

  it('leaf-only updates apply in call order, whatever the path spelling', () => {
    const w = load(
      payloadWalk({ a: { n: 'old' }, list: [{ k: 'a' }, { k: 'b' }] }, [
        { 'a.n': 'one', 'list.1.k': 'B1' },
        { 'a.n': 'two' },
        { 'list.0.k': 'A3', 'a.n': 'three' },
      ]),
    );
    expect(valueAfter(w, 2)).toEqual({ a: { n: 'three' }, list: [{ k: 'A3' }, { k: 'B1' }] });
  });

  const parentThenChild = () =>
    load(payloadWalk({ a: { n: 'old' } }, [{ a: { n: 'x' } }, { 'a.n': 'y' }, { a: { n: 'z' } }]));
  const arrayReplaced = () =>
    load(payloadWalk([{ k: 'a' }], [{ '0.k': 'b' }, { '0': { k: 'c' } }]));

  it('precondition: the ordering configs pass lint and the first two calls behave', () => {
    expect(valueAfter(parentThenChild(), 0)).toEqual({ a: { n: 'x' } });
    expect(valueAfter(parentThenChild(), 1)).toEqual({ a: { n: 'y' } });
    expect(valueAfter(arrayReplaced(), 0)).toEqual([{ k: 'b' }]);
  });

  // DEFECT: patches are merged into one object, so an overwritten key keeps its old position in
  // the application order (src/core/effects.ts:68, src/panels/payload/paths.ts:57).
  it.fails('a later update of a parent path wins over an earlier update of its child', () => {
    expect(valueAfter(parentThenChild(), 2)).toEqual({ a: { n: 'z' } });
  });

  // Same defect with array positions: integer-like keys are also ordered first by JS objects.
  it.fails(
    'an array element replaced after one of its fields was updated shows the replacement',
    () => {
      expect(valueAfter(arrayReplaced(), 1)).toEqual([{ k: 'c' }]);
    },
  );
});
