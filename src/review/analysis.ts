/**
 * One pass over a resolved walkthrough, collecting what every rule, the stats and the trace need:
 * for each call its text, what it touches in each pane, which panes are visible, and the pane
 * states before and after it. Pure; nothing here knows a panel type.
 */
import {
  createFolder,
  effectTarget,
  effectsOf,
  touched,
  type Call,
  type Effect,
  type PathSegment,
  type PaneViews,
  type ResolvedPane,
  type ResolvedWalkthrough,
  type Step,
  type Touched,
} from '../core';
import { textStats, type TextStats } from './text';

/** What a call does to one pane, by element id, in the order the effects are applied. */
export interface PaneTouch extends Touched {
  focused: ReadonlySet<string>;
  /** Every effect, including the ones a panel adds on its own. */
  effects: Effect[];
}

export interface CallFacts {
  /** Position over the whole walkthrough, from 0. */
  index: number;
  s: number;
  c: number;
  step: Step;
  call: Call;
  /** "<step id>.<call id>": ids hold no dots, so this names a call without ambiguity. */
  key: string;
  /** Where the call is in the config. */
  path: PathSegment[];
  text: string;
  stats: TextStats;
  touches: Record<string, PaneTouch>;
  /** True when the call adds, updates, reads or removes something in some pane. */
  touchesAny: boolean;
  /** True when it adds, updates or removes something in some pane. */
  changesAny: boolean;
  /** A call from one lane to another: a sequence pane draws it. */
  isMessage: boolean;
  focus: string | undefined;
  /** Ids of the panes on screen at this call in the grid view. */
  visible: string[];
  /** Pane states before and after the call. */
  before: PaneViews;
  after: PaneViews;
}

export interface Analysis {
  walkthrough: ResolvedWalkthrough;
  prefix: PathSegment[];
  calls: CallFacts[];
  /** Each pane's elements by id. */
  elements: Map<string, Map<string, { label: string; initial: boolean }>>;
}

function touchOf(pane: ResolvedPane, call: Call): PaneTouch {
  const effects = effectsOf(pane, call);
  const base = touched(effects);
  const focused = new Set<string>();
  for (const effect of effects) {
    const { verb, id } = effectTarget(effect);
    if (verb === 'focus') focused.add(id);
  }
  return { ...base, focused, effects };
}

export function analyse(walkthrough: ResolvedWalkthrough, prefix: PathSegment[] = []): Analysis {
  const folder = createFolder(walkthrough);
  const initial: PaneViews = {};
  for (const pane of walkthrough.panes) {
    initial[pane.id] = { state: pane.panel.init(pane.content, walkthrough.source), current: [] };
  }
  const calls: CallFacts[] = [];
  let before = initial;
  let index = 0;
  walkthrough.steps.forEach((step, s) => {
    step.calls.forEach((call, c) => {
      const after = folder.at(s, c);
      const touches: Record<string, PaneTouch> = {};
      let touchesAny = false;
      let changesAny = false;
      for (const pane of walkthrough.panes) {
        const touch = touchOf(pane, call);
        touches[pane.id] = touch;
        if (touch.any) touchesAny = true;
        if (touch.added.size + touch.updated.size + touch.removed.size > 0) changesAny = true;
      }
      const focus = folder.focusPane(s, c);
      calls.push({
        index,
        s,
        c,
        step,
        call,
        key: `${step.id}.${call.id}`,
        path: [...prefix, 'steps', s, 'calls', c],
        text: (call.text ?? '').trim(),
        stats: textStats(call.text),
        touches,
        touchesAny,
        changesAny,
        isMessage: call.from !== undefined && call.to !== undefined,
        focus,
        visible: walkthrough.panes
          .filter((pane) => pane.role === 'fixed' || pane.id === focus)
          .map((pane) => pane.id),
        before,
        after,
      });
      before = after;
      index += 1;
    });
  });

  const elements = new Map<string, Map<string, { label: string; initial: boolean }>>();
  for (const pane of walkthrough.panes) {
    elements.set(
      pane.id,
      new Map(
        pane.entities.map((entity) => [
          entity.id,
          { label: entity.label ?? entity.id, initial: entity.initial === true },
        ]),
      ),
    );
  }
  return { walkthrough, prefix, calls, elements };
}
