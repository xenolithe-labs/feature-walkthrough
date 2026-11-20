import { describe, expect, it } from 'vitest';
import {
  activityOf,
  chooseStage,
  createFolder,
  loadConfig,
  planStage,
  recentlyTouched,
  stageCapacity,
  type ResolvedWalkthrough,
  type WalkthroughInput,
} from '../../src/core';
import { baseConfig, testRegistry } from '../helpers/registry';

function load(config: WalkthroughInput): ResolvedWalkthrough {
  const result = loadConfig(config, testRegistry());
  expect(result.problems).toEqual([]);
  return result.walkthroughs[0]!;
}

/** `count` fixed panes, one call per pane: call n reads item n of pane n. */
function many(count: number): WalkthroughInput {
  const ids = Array.from({ length: count }, (_, index) => `p${index}`);
  return {
    id: 'many',
    title: 'Many',
    layout: {
      panes: ids.map((id) => ({
        id,
        panel: 'items',
        content: { items: [{ id: 'i', initial: true }, { id: 'j' }] },
      })),
    },
    steps: [
      {
        id: 'only',
        title: 'Only',
        calls: ids.map((id) => ({ id: `c-${id}`, label: id, effects: { [id]: [{ read: 'i' }] } })),
      },
    ],
  };
}

const view = {
  visible: ['a', 'b', 'c', 'd'],
  activity: {},
  recent: [],
  pinned: [],
  capacity: 3,
} as const;
const act = (weight: number) => ({
  added: 0,
  updated: 0,
  read: weight,
  removed: 0,
  total: weight,
  weight,
});

describe('chooseStage', () => {
  it('puts the touched panes on stage, the strongest first, in declared order', () => {
    const stage = chooseStage({ ...view, activity: { a: act(1), c: act(9), d: act(4) } });
    expect(stage.ids).toEqual(['a', 'c', 'd']);
    expect(stage.primary).toBe('c');
  });

  it('gives the most room to the pane with the most to show, then to the strongest', () => {
    const activity = { a: act(1), c: act(9), d: act(4) };
    expect(chooseStage({ ...view, activity, size: { a: 3, c: 3, d: 12 } }).primary).toBe('d');
    expect(chooseStage({ ...view, activity, size: { a: 3, c: 3, d: 3 } }).primary).toBe('c');
    expect(chooseStage({ ...view, activity, size: { a: 3, c: 3, d: 12 } }).ids).toEqual([
      'a',
      'c',
      'd',
    ]);
  });

  it('drops the weakest touched pane when more are touched than fit', () => {
    const stage = chooseStage({
      ...view,
      capacity: 2,
      activity: { a: act(1), b: act(5), c: act(9) },
    });
    expect(stage.ids).toEqual(['b', 'c']);
  });

  it('breaks a tie by the order the config declares', () => {
    const stage = chooseStage({ ...view, capacity: 1, activity: { b: act(3), c: act(3) } });
    expect(stage.ids).toEqual(['b']);
  });

  it('keeps the stage as small as the call allows, but never one pane when there is room', () => {
    const one = chooseStage({ ...view, activity: { c: act(2) }, recent: ['a', 'b'] });
    expect(one.ids).toEqual(['a', 'c']);
    expect(one.reasons).toMatchObject({ c: 'touched', a: 'recent' });
    // A call that touches nothing keeps the panes the calls before it touched.
    const none = chooseStage({ ...view, recent: ['d', 'b', 'a'] });
    expect(none.ids).toEqual(['b', 'd']);
    // With no history at all, the first panes of the config.
    expect(chooseStage(view).ids).toEqual(['a', 'b']);
  });

  it('holds one pane when only one fits', () => {
    expect(
      chooseStage({ ...view, capacity: 1, activity: { b: act(1) }, recent: ['a'] }).ids,
    ).toEqual(['b']);
  });

  it('gives a swapped-in pane and then a pinned pane priority over what is touched', () => {
    const touchedPanes = { a: act(9), b: act(8), c: act(7) };
    const swapped = chooseStage({ ...view, capacity: 2, activity: touchedPanes, swappedIn: 'd' });
    expect(swapped.ids).toEqual(['a', 'd']);
    expect(swapped.reasons.d).toBe('swapped');
    const pinned = chooseStage({
      ...view,
      capacity: 2,
      activity: touchedPanes,
      swappedIn: 'd',
      pinned: ['c'],
    });
    expect(pinned.ids).toEqual(['c', 'd']);
    expect(pinned.primary).toBe('c');
  });

  it('keeps the newest pins when more were pinned than fit', () => {
    const stage = chooseStage({ ...view, capacity: 2, pinned: ['a', 'b', 'c'] });
    expect(stage.ids).toEqual(['b', 'c']);
  });

  it('ignores pins and a selection that name a pane that is not visible', () => {
    const stage = chooseStage({
      ...view,
      pinned: ['gone'],
      selected: 'gone',
      activity: { b: act(1) },
    });
    expect(stage.ids).toEqual(['a', 'b']);
  });

  it('shows the pane that holds the selected element', () => {
    const stage = chooseStage({
      ...view,
      capacity: 2,
      selected: 'd',
      activity: { a: act(9), b: act(8) },
    });
    expect(stage.ids).toEqual(['a', 'd']);
  });

  it('shows what exists when there are fewer panes than room', () => {
    const stage = chooseStage({ ...view, visible: ['a'], capacity: 3, activity: {} });
    expect(stage.ids).toEqual(['a']);
  });

  it('does not change the lists it is given', () => {
    const pinned = ['a', 'b'];
    chooseStage({ ...view, pinned });
    expect(pinned).toEqual(['a', 'b']);
  });
});

describe('stageCapacity', () => {
  it('holds three on a wide, tall stage, two on a wide one, one on a narrow one', () => {
    expect(stageCapacity(1036, 560)).toBe(3);
    expect(stageCapacity(1036, 400)).toBe(2);
    expect(stageCapacity(736, 600)).toBe(2);
    expect(stageCapacity(660, 600)).toBe(1);
    expect(stageCapacity(358, 470)).toBe(1);
  });

  it('holds one before it has been measured', () => {
    expect(stageCapacity(0, 0)).toBe(1);
    expect(stageCapacity(Number.NaN, 500)).toBe(1);
  });
});

describe('planStage', () => {
  const walkthrough = load(baseConfig());
  const folder = createFolder(walkthrough);
  const plan = (s: number, c: number, capacity = 3, extra = {}) =>
    planStage(walkthrough, folder, s, c, { capacity, ...extra });

  it('counts what a call does to each pane, in elements', () => {
    const pane = walkthrough.panes.find((item) => item.id === 'things')!;
    const call = walkthrough.steps[1]!.calls[0]!;
    expect(activityOf(pane, call)).toMatchObject({ updated: 1, added: 0, read: 0, total: 1 });
    const none = walkthrough.steps[1]!.calls[2]!;
    expect(activityOf(pane, none).total).toBe(0);
  });

  it('weighs a panel’s own effects below the ones the author wrote', () => {
    const log = walkthrough.panes.find((item) => item.id === 'log')!;
    const things = walkthrough.panes.find((item) => item.id === 'things')!;
    const call = walkthrough.steps[0]!.calls[1]!;
    // One implied message against one written add.
    expect(activityOf(log, call).total).toBe(activityOf(things, call).total);
    expect(activityOf(log, call).weight).toBeLessThan(activityOf(things, call).weight);
  });

  it('offers only the panes the grid shows: the fixed ones and the current focus pane', () => {
    expect(plan(0, 0).visible.map((pane) => pane.id)).toEqual(['things', 'log']);
    expect(plan(1, 0).visible.map((pane) => pane.id)).toEqual(['things', 'other']);
  });

  it('notices a swap on the call that makes it, and only then', () => {
    expect(plan(0, 0).swappedIn).toBeUndefined();
    expect(plan(1, 0).swappedIn).toBe('other');
    expect(plan(1, 1).swappedIn).toBeUndefined();
    expect(plan(1, 0, 1).stage.ids).toEqual(['other']);
  });

  it('keeps the previous stage on a call that touches nothing', () => {
    const rest = plan(1, 2);
    expect(Object.values(rest.activity).every((item) => item.total === 0)).toBe(true);
    expect(rest.stage.ids).toEqual(['things', 'other']);
  });

  it('is the same however the reader got there', () => {
    const fresh = planStage(walkthrough, createFolder(walkthrough), 1, 1, { capacity: 2 });
    plan(1, 2);
    plan(0, 0);
    expect(plan(1, 1, 2).stage).toEqual(fresh.stage);
  });

  it('puts the pane of a selected element on stage', () => {
    expect(plan(0, 0, 1, { selection: 'x' }).stage.ids).toEqual(['things']);
    expect(plan(1, 0, 1, { selection: 'x' }).stage.ids).toEqual(['other']);
    // `x` is in the pane that is not visible at the start, so nothing changes there.
    expect(plan(0, 0, 1, { selection: 'seed' }).stage.ids).toEqual(['things']);
  });

  it('finds the panes earlier calls touched, most recent first', () => {
    const touched = recentlyTouched(walkthrough, 1, 1, plan(1, 1).visible);
    expect(touched).toEqual(['things', 'other']);
  });

  it('copes with two panes and with eight', () => {
    const two = load(many(2));
    expect(planStage(two, createFolder(two), 0, 1, { capacity: 3 }).stage.ids).toEqual([
      'p0',
      'p1',
    ]);
    const eight = load(many(8));
    const folder8 = createFolder(eight);
    const at = planStage(eight, folder8, 0, 5, { capacity: 3 });
    expect(at.visible).toHaveLength(8);
    expect(at.stage.ids).toEqual(['p4', 'p5']);
    expect(at.stage.primary).toBe('p5');
    expect(planStage(eight, folder8, 0, 5, { capacity: 1 }).stage.ids).toEqual(['p5']);
  });
});
