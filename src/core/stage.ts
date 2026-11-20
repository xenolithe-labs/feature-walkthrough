/**
 * Which panes the Focus view puts on its stage for a call.
 *
 * The answer is a pure function of the walkthrough and the cursor (plus what the reader pinned
 * and selected), never of how the reader got there: a link to a call shows the same stage.
 * It reads only the effects of calls, so it needs no hint in the config.
 */
import { effectsOf, touched, writtenEffects } from './effects';
import type { Call } from './schema';
import type { Folder } from './fold';
import type { ResolvedPane, ResolvedWalkthrough } from './types';

/** What one call does to one pane, counted in distinct elements. */
export interface PaneActivity {
  added: number;
  updated: number;
  read: number;
  removed: number;
  /** All four counts added up. */
  total: number;
  /** How strongly the call is about this pane: changes weigh more than reads. */
  weight: number;
}

export const NO_ACTIVITY: PaneActivity = {
  added: 0,
  updated: 0,
  read: 0,
  removed: 0,
  total: 0,
  weight: 0,
};

/**
 * Effects a panel adds on its own (a sequence pane draws every call's message) say little about
 * what a call is about, so they weigh less than effects the author wrote.
 */
const WRITTEN = 4;
const IMPLICIT = 1;

export function activityOf(pane: ResolvedPane, call: Call): PaneActivity {
  const all = touched(effectsOf(pane, call));
  if (!all.any) return NO_ACTIVITY;
  const written = touched(writtenEffects(call, pane.id));
  const changes = all.added.size + all.updated.size + all.removed.size;
  const writtenChanges = written.added.size + written.updated.size + written.removed.size;
  return {
    added: all.added.size,
    updated: all.updated.size,
    read: all.read.size,
    removed: all.removed.size,
    total: changes + all.read.size,
    weight:
      writtenChanges * WRITTEN * 2 +
      written.read.size * WRITTEN +
      (changes - writtenChanges) * IMPLICIT * 2 +
      (all.read.size - written.read.size) * IMPLICIT,
  };
}

/** The panes the grid view shows at a cursor: every fixed pane and the current focus pane. */
export function visiblePanes(
  panes: readonly ResolvedPane[],
  focusId: string | undefined,
): ResolvedPane[] {
  return panes.filter((pane) => pane.role === 'fixed' || pane.id === focusId);
}

/**
 * Panes that calls before the cursor touched, most recent first. They fill a stage slot that the
 * current call leaves free, so the stage does not jump to something unrelated.
 */
export function recentlyTouched(
  walkthrough: ResolvedWalkthrough,
  s: number,
  c: number,
  among: readonly ResolvedPane[],
  limit = 80,
): string[] {
  const found: string[] = [];
  let looked = 0;
  for (let step = s; step >= 0 && looked < limit; step -= 1) {
    const calls = walkthrough.steps[step]!.calls;
    for (let i = step === s ? c - 1 : calls.length - 1; i >= 0 && looked < limit; i -= 1) {
      looked += 1;
      const ranked = among
        .filter((pane) => !found.includes(pane.id) && activityOf(pane, calls[i]!).total > 0)
        .sort((a, b) => activityOf(b, calls[i]!).weight - activityOf(a, calls[i]!).weight);
      for (const pane of ranked) found.push(pane.id);
      if (found.length >= among.length) return found;
    }
  }
  return found;
}

export type StageReason = 'pinned' | 'swapped' | 'selected' | 'touched' | 'recent' | 'default';

export interface StageInput {
  /** The panes that can be on stage, in the order the config declares them. */
  visible: readonly string[];
  /** The current call's activity per pane. */
  activity: Readonly<Record<string, PaneActivity>>;
  /** Panes touched by earlier calls, most recent first. */
  recent: readonly string[];
  /** A focus pane that this call put in the shared slot. */
  swappedIn?: string | undefined;
  /** The pane that holds the selected element. */
  selected?: string | undefined;
  /** What the reader pinned, oldest first. */
  pinned: readonly string[];
  /** How much each pane can show (its declared elements): the one with most gets the most room. */
  size?: Readonly<Record<string, number>>;
  /** How many panes fit. */
  capacity: number;
}

export interface Stage {
  /** Panes on stage, in declared order, so that they do not trade places between calls. */
  ids: string[];
  /** The pane with the most to show, which the view gives the most room. */
  primary: string | undefined;
  reasons: Readonly<Record<string, StageReason>>;
}

/** The fewest panes a stage shows when there is room: one pane alone has no context. */
const LEAST = 2;

/**
 * Pure choice. Pinned panes come first, then a swapped-in pane, the selected one and the panes
 * the call touches, strongest first. Only if that leaves fewer than two does it add panes that
 * earlier calls touched, so the stage is as small as the call allows and never jumps to nothing.
 */
export function chooseStage(input: StageInput): Stage {
  const capacity = Math.max(1, Math.floor(input.capacity));
  const valid = new Set(input.visible);
  const order = new Map(input.visible.map((id, index) => [id, index] as const));
  const chosen: string[] = [];
  const reasons: Record<string, StageReason> = {};
  const take = (id: string | undefined, reason: StageReason, limit = capacity) => {
    if (id === undefined || !valid.has(id) || chosen.includes(id) || chosen.length >= limit) {
      return;
    }
    chosen.push(id);
    reasons[id] = reason;
  };

  // The newest pins win when more were pinned than fit.
  for (const id of [...input.pinned].reverse()) take(id, 'pinned');
  take(input.swappedIn, 'swapped');
  take(input.selected, 'selected');
  const touchedNow = input.visible
    .filter((id) => (input.activity[id]?.total ?? 0) > 0)
    .sort(
      (a, b) =>
        (input.activity[b]?.weight ?? 0) - (input.activity[a]?.weight ?? 0) ||
        order.get(a)! - order.get(b)!,
    );
  for (const id of touchedNow) take(id, 'touched');
  const least = Math.min(LEAST, capacity);
  for (const id of input.recent) take(id, 'recent', least);
  for (const id of input.visible) take(id, 'default', least);

  // Room goes to the pane with the most to show, not to the one the call is most about: a pane
  // of a few rows needs little, and the call's panes are all on stage anyway.
  const ranked = [...chosen].sort(
    (a, b) =>
      (input.size?.[b] ?? 0) - (input.size?.[a] ?? 0) ||
      (input.activity[b]?.weight ?? 0) - (input.activity[a]?.weight ?? 0) ||
      order.get(a)! - order.get(b)!,
  );
  return {
    ids: [...chosen].sort((a, b) => order.get(a)! - order.get(b)!),
    primary: ranked[0],
    reasons,
  };
}

/**
 * How many panes a stage of this size holds: three (one large, two beside it), two side by side,
 * or one. A phone gets one: the bar of panes names the others.
 */
export function stageCapacity(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0) return 1;
  if (width >= 940 && height >= 500) return 3;
  if (width >= 680) return 2;
  return 1;
}

export interface StagePlan {
  /** Panes the grid view would show, in declared order. */
  visible: ResolvedPane[];
  activity: Record<string, PaneActivity>;
  stage: Stage;
  /** The focus pane this call put in the shared slot, when it differs from the call before. */
  swappedIn: string | undefined;
  focusId: string | undefined;
}

export interface StageOptions {
  capacity: number;
  pinned?: readonly string[];
  /** The id of the selected element, if any. */
  selection?: string | undefined;
}

/** The whole decision for one call. */
export function planStage(
  walkthrough: ResolvedWalkthrough,
  folder: Pick<Folder, 'focusPane'>,
  s: number,
  c: number,
  options: StageOptions,
): StagePlan {
  const focusId = folder.focusPane(s, c);
  const visible = visiblePanes(walkthrough.panes, focusId);
  const call = walkthrough.steps[s]!.calls[c]!;
  const activity: Record<string, PaneActivity> = {};
  for (const pane of visible) activity[pane.id] = activityOf(pane, call);

  let swappedIn: string | undefined;
  if (focusId !== undefined && (s > 0 || c > 0)) {
    const before =
      c > 0 ? { s, c: c - 1 } : { s: s - 1, c: walkthrough.steps[s - 1]!.calls.length - 1 };
    if (folder.focusPane(before.s, before.c) !== focusId) swappedIn = focusId;
  }

  const selected =
    options.selection === undefined
      ? undefined
      : visible.find((pane) => pane.entities.some((entity) => entity.id === options.selection))?.id;

  const stage = chooseStage({
    visible: visible.map((pane) => pane.id),
    activity,
    recent: recentlyTouched(walkthrough, s, c, visible),
    swappedIn,
    selected,
    pinned: options.pinned ?? [],
    size: Object.fromEntries(visible.map((pane) => [pane.id, pane.entities.length])),
    capacity: options.capacity,
  });
  return { visible, activity, stage, swappedIn, focusId };
}
