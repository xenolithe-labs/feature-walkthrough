/**
 * The pure part of the timeline panel: its content schema, and the questions the view, the lint
 * and the tests ask of a state: what is visible at "now", whether a limit holds, which
 * instants are late. No React, no CSS.
 */
import { z } from 'zod';
import {
  IdSchema,
  effectTarget,
  own,
  reduceElements,
  type Effect,
  type ElementsState,
} from '../../core';
import { TONES } from '../_shared/changes';

/** `late` is also worked out: an instant that arrives after a limit ran out is late. */
export const DECLARED_STATES = ['ok', 'late', 'missed', 'failed', 'retried'] as const;
/** What a call can set: the same, and `none` to clear. */
export const STATES = [...DECLARED_STATES, 'none'] as const;
export type State = (typeof DECLARED_STATES)[number];

export const NOW = 'now';

const Ref = z.union([z.number(), IdSchema]);

export const TimelineContent = z
  .strictObject({
    axis: z.strictObject({
      /** What a number on the axis counts: "s", "ms", "min". Shown on the axis and in the card. */
      unit: z.string().min(1),
      /** The time at the left edge. */
      from: z.number().default(0),
      /** The time at the right edge. */
      to: z.number(),
      /** The distance between labelled ticks. */
      tick: z.number().positive(),
      /** The least width of a unit in pixels: below it the timeline scrolls sideways. */
      pxPerUnit: z.number().positive().default(8),
    }),
    /** Where the "now" marker starts. Defaults to the left edge. */
    now: z.number().optional(),
    rows: z
      .array(
        z.strictObject({
          id: IdSchema,
          label: z.string().optional(),
          sub: z.string().optional(),
          initial: z.boolean().optional(),
        }),
      )
      .min(1),
    /** Things that happen at one time: a heartbeat, an event, a retry attempt. */
    instants: z
      .array(
        z.strictObject({
          id: IdSchema,
          row: IdSchema,
          at: z.number(),
          label: z.string().optional(),
          kind: z.enum(['heartbeat', 'event']).default('event'),
          state: z.enum(DECLARED_STATES).optional(),
          tone: z.enum(TONES).optional(),
          initial: z.boolean().optional(),
        }),
      )
      .default([]),
    /** Things that take time: an attempt running, a timer, a backoff wait, a lease. */
    spans: z
      .array(
        z.strictObject({
          id: IdSchema,
          row: IdSchema,
          from: z.number(),
          to: z.number(),
          label: z.string().optional(),
          /** run: solid. wait: hatched, for a timer or a backoff. lease: an outline. */
          kind: z.enum(['run', 'wait', 'lease']).default('run'),
          state: z.enum(DECLARED_STATES).optional(),
          tone: z.enum(TONES).optional(),
          initial: z.boolean().optional(),
        }),
      )
      .default([]),
    /**
     * A time limit on a row, drawn on the axis. With `reset` it is a silence limit: no more than
     * `after` may pass without an instant of that kind (a heartbeat timeout), counted from
     * `from`. Without it, the limit is one deadline, `after` from `from`, that `by` (or the
     * span `from` names) has to meet.
     */
    limits: z
      .array(
        z.strictObject({
          id: IdSchema,
          row: IdSchema,
          after: z.number().positive(),
          /** Where it starts: a time, an instant, or a span (its start). */
          from: Ref,
          /** Silence limits: the kind of instant that restarts the limit. */
          reset: z.enum(['heartbeat', 'event']).optional(),
          /** Silence limits: where it stops applying: a time, an instant, or a span (its end). */
          until: Ref.optional(),
          /** Deadlines: what has to happen in time: an instant, or a span (its end). */
          by: IdSchema.optional(),
          label: z.string().optional(),
          tone: z.enum(TONES).optional(),
          initial: z.boolean().optional(),
        }),
      )
      .default([]),
    /** Whether rows, instants, spans and limits are present before the first call. */
    initial: z.boolean().default(true),
  })
  .refine((content) => content.axis.to > content.axis.from, {
    path: ['axis', 'to'],
    message: 'the axis must end after it starts',
  });
export type TimelineContent = z.infer<typeof TimelineContent>;
export type InstantDecl = TimelineContent['instants'][number];
export type SpanDecl = TimelineContent['spans'][number];
export type LimitDecl = TimelineContent['limits'][number];

/** Elements state, and where the "now" marker was before the call that is current moved it. */
export interface TimelineState extends ElementsState {
  /** Where "now" starts, from the content. */
  start: number;
  moved: { call: string; from: number } | undefined;
}

export function entitiesOf(content: TimelineContent) {
  const initial = (own1: boolean | undefined) => own1 ?? content.initial;
  return [
    { id: NOW, label: 'now', initial: true },
    ...content.rows.map((row) => ({
      id: row.id,
      label: row.label ?? row.id,
      initial: initial(row.initial),
    })),
    ...content.instants.map((item) => ({
      id: item.id,
      label: item.label ?? item.id,
      initial: initial(item.initial),
    })),
    ...content.spans.map((item) => ({
      id: item.id,
      label: item.label ?? item.id,
      initial: initial(item.initial),
    })),
    ...content.limits.map((item) => ({
      id: item.id,
      label: item.label ?? item.id,
      initial: initial(item.initial),
    })),
  ];
}

export const nowOf = (content: TimelineContent, patches: ElementsState['patches']): number => {
  const patched = own(patches, NOW)?.at;
  return typeof patched === 'number' ? patched : (content.now ?? content.axis.from);
};

/** The reducer: the shared one, and a note of where "now" was when a call moves it. */
export function reduce(state: TimelineState, effect: Effect, call: { id: string }): TimelineState {
  const next = reduceElements(state, effect);
  const { verb, id } = effectTarget(effect);
  const moves = verb === 'update' && id === NOW && typeof effect.fields?.at === 'number';
  const patched = own(state.patches, NOW)?.at;
  const moved =
    moves && state.moved?.call !== call.id
      ? { call: call.id, from: typeof patched === 'number' ? patched : state.start }
      : state.moved;
  return { ...state, ...next, moved };
}

// ---- what is visible at "now" ----------------------------------------------------------------

export const isPresent = (state: ElementsState, id: string) => state.present.includes(id);

/** An instant is shown once it is present and its time has come. */
export const instantShown = (item: InstantDecl, state: ElementsState, now: number) =>
  isPresent(state, item.id) && item.at <= now;

/** A span is drawn from its start to its end, or to "now" while it is still running. */
export function spanDrawn(
  item: SpanDecl,
  state: ElementsState,
  now: number,
): { from: number; to: number; open: boolean } | null {
  if (!isPresent(state, item.id) || item.from > now) return null;
  return { from: item.from, to: Math.min(item.to, now), open: item.to > now };
}

type Refs = Pick<TimelineContent, 'instants' | 'spans'>;

/** The time a reference means: a number, an instant, or the start or end of a span. */
export function refTime(
  content: Refs,
  ref: number | string,
  edge: 'start' | 'end',
): number | undefined {
  if (typeof ref === 'number') return ref;
  const instant = content.instants.find((item) => item.id === ref);
  if (instant !== undefined) return instant.at;
  const span = content.spans.find((item) => item.id === ref);
  return span === undefined ? undefined : edge === 'start' ? span.from : span.to;
}

export type SegmentKind = 'pending' | 'missed' | 'over' | 'met';

export interface LimitView {
  /** hidden: it has not started. pending: still running. met: it held. missed: it ran out. */
  status: 'hidden' | 'pending' | 'met' | 'missed';
  /** The time the limit that is still open runs out, or null once nothing is open. */
  limitAt: number | null;
  segments: { from: number; to: number; kind: SegmentKind }[];
  /** Instants that came after a limit had run out. */
  late: string[];
}

const HIDDEN: LimitView = { status: 'hidden', limitAt: null, segments: [], late: [] };

/**
 * Whether a limit holds at `now`, worked out from the instants and spans that have happened.
 * A silence limit runs out when more than `after` passes after its start or after the last
 * instant of the kind that resets it; the gap that crossed the limit is drawn from the last
 * instant to the limit (missed) and from the limit to the next instant or to "now" (over).
 */
export function evaluateLimit(
  content: TimelineContent,
  limit: LimitDecl,
  state: ElementsState,
  now: number,
): LimitView {
  if (!isPresent(state, limit.id)) return HIDDEN;
  const start = refTime(content, limit.from, 'start');
  if (start === undefined || start > now) return HIDDEN;

  if (limit.reset === undefined) {
    const limitAt = start + limit.after;
    const endRef = limit.by ?? (typeof limit.from === 'string' ? limit.from : undefined);
    const end = endRef === undefined ? undefined : refTime(content, endRef, 'end');
    if (end !== undefined && end <= now) {
      if (end <= limitAt) {
        return {
          status: 'met',
          limitAt,
          segments: [{ from: start, to: end, kind: 'met' }],
          late: [],
        };
      }
      const byInstant = content.instants.find((item) => item.id === limit.by);
      return {
        status: 'missed',
        limitAt,
        segments: [
          { from: start, to: limitAt, kind: 'missed' },
          { from: limitAt, to: end, kind: 'over' },
        ],
        late: byInstant === undefined ? [] : [byInstant.id],
      };
    }
    if (now >= limitAt) {
      return {
        status: 'missed',
        limitAt,
        segments: [
          { from: start, to: limitAt, kind: 'missed' },
          { from: limitAt, to: now, kind: 'over' },
        ],
        late: [],
      };
    }
    return {
      status: 'pending',
      limitAt,
      segments: [{ from: start, to: limitAt, kind: 'pending' }],
      late: [],
    };
  }

  const until = limit.until === undefined ? undefined : refTime(content, limit.until, 'end');
  const resets = content.instants
    .filter(
      (item) =>
        item.row === limit.row &&
        item.kind === limit.reset &&
        instantShown(item, state, now) &&
        item.at >= start &&
        (until === undefined || item.at <= until),
    )
    .sort((a, b) => a.at - b.at);
  const segments: LimitView['segments'] = [];
  const late: string[] = [];
  let missed = false;
  let previous = start;
  for (const instant of resets) {
    if (instant.at - previous > limit.after) {
      missed = true;
      segments.push(
        { from: previous, to: previous + limit.after, kind: 'missed' },
        { from: previous + limit.after, to: instant.at, kind: 'over' },
      );
      late.push(instant.id);
    }
    previous = instant.at;
  }
  const limitAt = previous + limit.after;
  if (until !== undefined && now >= until && until < limitAt) {
    return { status: missed ? 'missed' : 'met', limitAt: null, segments, late };
  }
  if (now >= limitAt) {
    const stop = until === undefined ? now : Math.min(now, until);
    segments.push(
      { from: previous, to: limitAt, kind: 'missed' },
      { from: limitAt, to: stop, kind: 'over' },
    );
    return { status: 'missed', limitAt, segments, late };
  }
  segments.push({ from: previous, to: limitAt, kind: 'pending' });
  return { status: missed ? 'missed' : 'pending', limitAt, segments, late };
}

/** Every instant that is late: the late ones of every limit. */
export function lateInstants(
  content: TimelineContent,
  state: ElementsState,
  now: number,
): Set<string> {
  const late = new Set<string>();
  for (const limit of content.limits) {
    for (const id of evaluateLimit(content, limit, state, now).late) late.add(id);
  }
  return late;
}

/** The state an instant or span is drawn in: what a call set, else what it declares, else late. */
export function stateOf(
  item: { id: string; state?: State | undefined },
  patches: ElementsState['patches'],
  late: ReadonlySet<string>,
): State | undefined {
  const patched = own(patches, item.id)?.state;
  if (typeof patched === 'string') {
    return patched === 'none' ? undefined : (patched as State);
  }
  return item.state ?? (late.has(item.id) ? 'late' : undefined);
}

/**
 * The elements the current call brought into view by moving "now": instants and spans whose
 * start fell after the old "now" and is at or before the new one.
 */
export function revealed(
  content: TimelineContent,
  state: TimelineState,
  callId: string,
  now: number,
): Set<string> {
  const out = new Set<string>();
  if (state.moved?.call !== callId) return out;
  const from = state.moved.from;
  const fresh = (time: number) => time > from && time <= now;
  for (const item of content.instants)
    if (isPresent(state, item.id) && fresh(item.at)) out.add(item.id);
  for (const item of content.spans)
    if (isPresent(state, item.id) && fresh(item.from)) out.add(item.id);
  for (const item of content.limits) {
    const start = refTime(content, item.from, 'start');
    if (isPresent(state, item.id) && start !== undefined && fresh(start)) out.add(item.id);
  }
  return out;
}

/**
 * Levels for labels that would overlap if they were all on one line: each label goes on the
 * lowest level where it starts clear of the one before. `x` and `width` are in pixels.
 */
export function stagger(items: { x: number; width: number }[], gap = 4): number[] {
  const order = items.map((_, index) => index).sort((a, b) => items[a]!.x - items[b]!.x);
  const ends: number[] = [];
  const levels: number[] = new Array<number>(items.length).fill(0);
  for (const index of order) {
    const item = items[index]!;
    const left = item.x - item.width / 2;
    let level = ends.findIndex((end) => end + gap <= left);
    if (level === -1) level = ends.length;
    ends[level] = item.x + item.width / 2;
    levels[index] = level;
  }
  return levels;
}

/** A time with its unit: "12 s". */
export const timeText = (content: TimelineContent, time: number) =>
  `${Number.isInteger(time) ? time : Number(time.toFixed(2))} ${content.axis.unit}`;
