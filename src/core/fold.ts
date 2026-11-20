import { effectsOf } from './effects';
import type { Effect } from './schema';
import type { ResolvedPane, ResolvedWalkthrough } from './types';

export interface PaneView {
  /** The pane's state after every call up to and including the cursor. */
  state: unknown;
  /** What the call at the cursor does to this pane. */
  current: Effect[];
}

export type PaneViews = Record<string, PaneView>;
type States = Record<string, unknown>;

export interface Folder {
  /** Pane states at a cursor. Uses a snapshot at the start of the step. */
  at(s: number, c: number): PaneViews;
  /** The same answer, recomputed from the first call. The reference for tests. */
  fromZero(s: number, c: number): PaneViews;
  /** The focus pane visible at a cursor: the last `show` at or before it. */
  focusPane(s: number, c: number): string | undefined;
}

function initial(walkthrough: ResolvedWalkthrough): States {
  const states: States = {};
  for (const pane of walkthrough.panes) {
    states[pane.id] = pane.panel.init(pane.content, walkthrough.source);
  }
  return states;
}

function applyCall(
  panes: ResolvedPane[],
  states: States,
  call: ResolvedWalkthrough['steps'][number]['calls'][number],
): States {
  const next: States = { ...states };
  for (const pane of panes) {
    let state = next[pane.id];
    for (const effect of effectsOf(pane, call)) {
      state = pane.panel.reduce(state, effect, call);
    }
    next[pane.id] = state;
  }
  return next;
}

function views(walkthrough: ResolvedWalkthrough, states: States, s: number, c: number): PaneViews {
  const call = walkthrough.steps[s]?.calls[c];
  const result: PaneViews = {};
  for (const pane of walkthrough.panes) {
    result[pane.id] = {
      state: states[pane.id],
      current: call === undefined ? [] : effectsOf(pane, call),
    };
  }
  return result;
}

export function createFolder(walkthrough: ResolvedWalkthrough): Folder {
  const { panes, steps } = walkthrough;
  // snapshots[k] holds every pane's state before the first call of step k.
  const snapshots: States[] = [initial(walkthrough)];
  const focusIds = panes.filter((pane) => pane.role === 'focus').map((pane) => pane.id);

  function snapshot(s: number): States {
    while (snapshots.length <= s) {
      const k = snapshots.length - 1;
      let states = snapshots[k]!;
      for (const call of steps[k]!.calls) states = applyCall(panes, states, call);
      snapshots.push(states);
    }
    return snapshots[s]!;
  }

  function check(s: number, c: number): void {
    if (steps[s]?.calls[c] === undefined) {
      throw new RangeError(`no call at step ${s}, call ${c} in "${walkthrough.id}"`);
    }
  }

  return {
    at(s, c) {
      check(s, c);
      let states = snapshot(s);
      for (let i = 0; i <= c; i += 1) states = applyCall(panes, states, steps[s]!.calls[i]!);
      return views(walkthrough, states, s, c);
    },

    fromZero(s, c) {
      check(s, c);
      let states = initial(walkthrough);
      for (let step = 0; step <= s; step += 1) {
        const calls = steps[step]!.calls;
        const last = step === s ? c : calls.length - 1;
        for (let i = 0; i <= last; i += 1) states = applyCall(panes, states, calls[i]!);
      }
      return views(walkthrough, states, s, c);
    },

    focusPane(s, c) {
      check(s, c);
      for (let step = s; step >= 0; step -= 1) {
        const calls = steps[step]!.calls;
        for (let i = step === s ? c : calls.length - 1; i >= 0; i -= 1) {
          const show = calls[i]!.show;
          if (show !== undefined && focusIds.includes(show)) return show;
        }
      }
      return focusIds[0];
    },
  };
}
