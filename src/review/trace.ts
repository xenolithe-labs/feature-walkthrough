import { planStage, type Folder } from '../core';
import type { Analysis, CallFacts } from './analysis';
import { describePane } from './describe';
import type { TraceCall } from './schema';

/** Panes the Focus view fits on a desktop-sized stage. The trace says so; it is not measured. */
export const STAGE_CAPACITY = 3;

/**
 * Finds the calls a `--call` argument names: "<step id>.<call id>", or, when no call has that
 * key, "<step number>.<call number>" counted from 1. Ids hold no dots, so the first form is
 * never ambiguous.
 */
export function selectCalls(analysis: Analysis, spec: string): CallFacts[] {
  const named = analysis.calls.filter((item) => item.key === spec);
  if (named.length > 0) return named;
  const match = /^(\d+)\.(\d+)$/.exec(spec);
  if (match === null) return [];
  const s = Number(match[1]) - 1;
  const c = Number(match[2]) - 1;
  return analysis.calls.filter((item) => item.s === s && item.c === c);
}

/** What a reader sees at each of the given calls. */
export function traceOf(
  analysis: Analysis,
  calls: readonly CallFacts[] = analysis.calls,
  capacity = STAGE_CAPACITY,
): TraceCall[] {
  const { walkthrough } = analysis;
  const at = new Map(analysis.calls.map((item) => [`${item.s}.${item.c}`, item]));
  const folder: Pick<Folder, 'focusPane'> = {
    focusPane: (s, c) => at.get(`${s}.${c}`)?.focus,
  };
  return calls.map((item): TraceCall => {
    const { step, call } = item;
    const plan = planStage(walkthrough, folder, item.s, item.c, { capacity });
    const visible = new Set(item.visible);
    return {
      step: {
        index: item.s + 1,
        id: step.id,
        title: step.title,
        ...(step.text === undefined || step.text.trim() === '' ? {} : { text: step.text }),
      },
      call: {
        index: item.c + 1,
        id: call.id,
        key: item.key,
        label: call.label,
        ...(call.from === undefined ? {} : { from: call.from }),
        ...(call.to === undefined ? {} : { to: call.to }),
        ...(item.text === '' ? {} : { text: item.text }),
        ...(call.where === undefined ? {} : { where: call.where }),
        words: item.stats.words,
      },
      ...(item.focus === undefined ? {} : { focus: item.focus }),
      stage: {
        capacity,
        panes: plan.stage.ids,
        ...(plan.stage.primary === undefined ? {} : { primary: plan.stage.primary }),
        reasons: { ...plan.stage.reasons },
      },
      panes: walkthrough.panes
        .filter((pane) => visible.has(pane.id))
        .map((pane) => {
          const touch = item.touches[pane.id]!;
          return {
            id: pane.id,
            title: pane.title,
            panel: pane.panel.id,
            role: pane.role,
            did: {
              added: [...touch.added],
              updated: [...touch.updated],
              read: [...touch.read],
              removed: [...touch.removed],
            },
            lines: describePane(pane, item.after[pane.id]?.state, touch.effects, call),
          };
        }),
      hidden: walkthrough.panes.filter((pane) => !visible.has(pane.id)).map((pane) => pane.id),
    };
  });
}
