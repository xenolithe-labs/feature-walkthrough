/**
 * The pure part of the bus panel: its content schema and the questions the view, the lint and
 * the tests ask of a state (offsets, the end of a partition, lag, which rules match an event).
 * No React, no CSS.
 */
import { z } from 'zod';
import { IdSchema, own, type ElementsState } from '../../core';
import { TONES } from '../_shared/changes';

/** What happened to an event. Drawn as a glyph, so that it does not rely on colour. */
export const EVENT_STATES = ['delivered', 'acked', 'failed', 'dead', 'none'] as const;
export type EventState = Exclude<(typeof EVENT_STATES)[number], 'none'>;

const Party = {
  id: IdSchema,
  label: z.string().optional(),
  /** A second line under the name. */
  sub: z.string().optional(),
  initial: z.boolean().optional(),
};

export const BusContent = z.strictObject({
  channels: z
    .array(
      z.strictObject({
        id: IdSchema,
        label: z.string().optional(),
        /**
         * topic: a log. Events have offsets and consumer groups have a committed offset and lag.
         * queue, bus: events in arrival order, without offsets.
         */
        kind: z.enum(['topic', 'queue', 'bus']).default('topic'),
        /** The partitions of a topic. Without them the channel has one row of events. */
        partitions: z.array(IdSchema).optional(),
        /**
         * Events in the order they reach the channel. In a topic the position in a partition is
         * the offset.
         */
        events: z
          .array(
            z.strictObject({
              id: IdSchema,
              label: z.string().optional(),
              partition: IdSchema.optional(),
              /** The body of the event, which rules match against. */
              data: z.record(z.string(), z.unknown()).optional(),
              /** Present before the first call. Events default to absent: a call publishes them. */
              initial: z.boolean().optional(),
            }),
          )
          .default([]),
        producers: z.array(z.strictObject(Party)).default([]),
        consumers: z.array(z.strictObject({ ...Party, group: z.string().optional() })).default([]),
        /**
         * The committed offset of a group in one partition: the offset of the next event the
         * group reads. `owner` is the consumer that has the partition now.
         */
        cursors: z
          .array(
            z.strictObject({
              id: IdSchema,
              partition: IdSchema.optional(),
              group: z.string().optional(),
              owner: IdSchema.nullable().default(null),
              at: z.number().int().default(0),
              initial: z.boolean().optional(),
            }),
          )
          .default([]),
        /** A rule on a bus: an event pattern, and the targets that get the events it matches. */
        rules: z
          .array(
            z.strictObject({
              id: IdSchema,
              label: z.string().optional(),
              pattern: z.record(z.string(), z.unknown()).optional(),
              targets: z.array(z.strictObject(Party)).default([]),
              initial: z.boolean().optional(),
            }),
          )
          .default([]),
        initial: z.boolean().optional(),
      }),
    )
    .min(1),
  /** Whether channels, producers, consumers, cursors and rules are present before the first call. */
  initial: z.boolean().default(true),
});
export type BusContent = z.infer<typeof BusContent>;
export type ChannelDecl = BusContent['channels'][number];
export type EventDecl = ChannelDecl['events'][number];
export type CursorDecl = ChannelDecl['cursors'][number];
export type RuleDecl = ChannelDecl['rules'][number];

export type ElementKind = 'channel' | 'event' | 'producer' | 'consumer' | 'cursor' | 'rule' | 'target';

export interface Located {
  id: string;
  kind: ElementKind;
  channel: ChannelDecl;
  label: string;
  initial: boolean;
  /** For a target: the rule it belongs to. */
  rule?: RuleDecl;
}

/** Every element with what it is and which channel it belongs to, in declaration order. */
export function elementsOf(content: BusContent): Located[] {
  const out: Located[] = [];
  for (const channel of content.channels) {
    const initial = (own1: boolean | undefined) => own1 ?? content.initial;
    out.push({
      id: channel.id,
      kind: 'channel',
      channel,
      label: channel.label ?? channel.id,
      initial: initial(channel.initial),
    });
    for (const event of channel.events) {
      out.push({
        id: event.id,
        kind: 'event',
        channel,
        label: event.label ?? event.id,
        initial: event.initial ?? false,
      });
    }
    for (const producer of channel.producers) {
      out.push({ id: producer.id, kind: 'producer', channel, label: producer.label ?? producer.id, initial: initial(producer.initial) });
    }
    for (const consumer of channel.consumers) {
      out.push({ id: consumer.id, kind: 'consumer', channel, label: consumer.label ?? consumer.id, initial: initial(consumer.initial) });
    }
    for (const cursor of channel.cursors) {
      out.push({ id: cursor.id, kind: 'cursor', channel, label: cursor.id, initial: initial(cursor.initial) });
    }
    for (const rule of channel.rules) {
      out.push({ id: rule.id, kind: 'rule', channel, label: rule.label ?? rule.id, initial: initial(rule.initial) });
      for (const target of rule.targets) {
        out.push({
          id: target.id,
          kind: 'target',
          channel,
          rule,
          label: target.label ?? target.id,
          initial: initial(target.initial),
        });
      }
    }
  }
  return out;
}

export function entitiesOf(content: BusContent) {
  return elementsOf(content).map(({ id, label, initial }) => ({ id, label, initial }));
}

type Patches = ElementsState['patches'];

/** The rows of a channel: its partitions, or one row without a name. */
export const lanesOf = (channel: ChannelDecl): (string | undefined)[] =>
  channel.partitions === undefined || channel.partitions.length === 0
    ? [undefined]
    : channel.partitions;

/** The events of one row, in arrival order. */
export const laneEvents = (channel: ChannelDecl, partition: string | undefined): EventDecl[] =>
  channel.events.filter((event) => event.partition === partition);

/** The offset of an event: its position in its partition. */
export function offsetOf(channel: ChannelDecl, event: EventDecl): number {
  return laneEvents(channel, event.partition).indexOf(event);
}

/**
 * The end of a partition: the offset the next event gets. It is one past the last event that is
 * present, so the end moves when a call publishes.
 */
export function endOffset(
  channel: ChannelDecl,
  partition: string | undefined,
  present: readonly string[],
): number {
  const events = laneEvents(channel, partition);
  let end = 0;
  events.forEach((event, index) => {
    if (present.includes(event.id)) end = index + 1;
  });
  return end;
}

/** The committed offset of a cursor now: a patched one, else the declared one. */
export function committedAt(cursor: CursorDecl, patches: Patches): number {
  const patched = own(patches, cursor.id)?.at;
  return typeof patched === 'number' && Number.isInteger(patched) ? patched : cursor.at;
}

/** The consumer that has a cursor's partition now, or null. */
export function ownerOf(cursor: CursorDecl, patches: Patches): string | null {
  const fields = own(patches, cursor.id);
  if (fields !== undefined && Object.hasOwn(fields, 'owner')) {
    const patched = fields.owner;
    if (patched === null || typeof patched === 'string') return patched;
  }
  return cursor.owner;
}

/** Lag: how many events are in the partition past the committed offset. Derived, never written. */
export function lagOf(channel: ChannelDecl, cursor: CursorDecl, state: ElementsState): number {
  const end = endOffset(channel, cursor.partition, state.present);
  return Math.max(0, end - committedAt(cursor, state.patches));
}

export function eventState(event: EventDecl, patches: Patches): EventState | undefined {
  const patched = own(patches, event.id)?.state;
  return typeof patched === 'string' && patched !== 'none' && EVENT_STATES.includes(patched as never)
    ? (patched as EventState)
    : undefined;
}

// ---- event patterns --------------------------------------------------------------------------

export const PATTERN_OPERATORS = ['prefix', 'anything-but', 'exists'] as const;

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalar = (value: unknown) =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

/** Problems with an event pattern, as messages with the path inside the pattern. */
export function patternProblems(
  pattern: Record<string, unknown>,
  at: string[] = [],
): { path: string[]; message: string }[] {
  const problems: { path: string[]; message: string }[] = [];
  for (const [key, value] of Object.entries(pattern)) {
    const here = [...at, key];
    if (isPlain(value)) {
      problems.push(...patternProblems(value, here));
    } else if (!Array.isArray(value) || value.length === 0) {
      problems.push({
        path: here,
        message: `"${key}" must be a list of values to match, or a nested pattern`,
      });
    } else {
      value.forEach((item, index) => {
        if (isScalar(item)) return;
        const keys = isPlain(item) ? Object.keys(item) : [];
        const operator = keys[0];
        const operand = operator === undefined ? undefined : (item as Record<string, unknown>)[operator];
        const ok =
          keys.length === 1 &&
          ((operator === 'prefix' && typeof operand === 'string') ||
            (operator === 'exists' && typeof operand === 'boolean') ||
            (operator === 'anything-but' &&
              (isScalar(operand) || (Array.isArray(operand) && operand.every(isScalar)))));
        if (!ok) {
          problems.push({
            path: [...here, String(index)],
            message: `not a value or an operator this panel can evaluate (${PATTERN_OPERATORS.join(', ')})`,
          });
        }
      });
    }
  }
  return problems;
}

function matchesValue(want: unknown, found: unknown): boolean {
  if (Array.isArray(found)) return found.some((item) => matchesValue(want, item));
  if (isScalar(want)) return want === found;
  const operator = isPlain(want) ? Object.keys(want)[0] : undefined;
  const operand = operator === undefined ? undefined : (want as Record<string, unknown>)[operator];
  if (operator === 'prefix') return typeof found === 'string' && found.startsWith(String(operand));
  if (operator === 'anything-but') {
    const banned = Array.isArray(operand) ? operand : [operand];
    return found !== undefined && !banned.includes(found);
  }
  if (operator === 'exists') return (found !== undefined) === operand;
  return false;
}

/**
 * Whether an event body matches a pattern, the way an event bus reads one: every field of the
 * pattern must match (AND), and a field matches when any of its listed values does (OR). A
 * missing field matches only `{ "exists": false }`.
 */
export function patternMatches(pattern: Record<string, unknown>, data: Record<string, unknown>): boolean {
  return Object.entries(pattern).every(([key, want]) => {
    const found = own(data, key);
    if (isPlain(want)) {
      return isPlain(found) && patternMatches(want, found);
    }
    if (!Array.isArray(want)) return false;
    // `exists: false` is the one thing that matches a field that is not there.
    return want.some((item) => matchesValue(item, found));
  });
}

/**
 * The rules of a channel that match an event. A rule without a pattern matches every event.
 */
export function matchingRules(channel: ChannelDecl, event: EventDecl): RuleDecl[] {
  return channel.rules.filter(
    (rule) => rule.pattern === undefined || patternMatches(rule.pattern, event.data ?? {}),
  );
}
