/**
 * What a reader sees in a bus pane, as text: for each channel that is shown, its events by
 * partition in arrival order (with offsets and what happened to each), the consumer groups'
 * committed offsets and lag, and the producers, consumers and rules that are present.
 */
import type { Effect } from '../../core';
import { cap, clip, elements, hitOf } from '../_shared/describe';
import {
  committedAt,
  eventState,
  laneEvents,
  lagOf,
  lanesOf,
  ownerOf,
  type BusContent,
} from './model';

export function describeBus(state: unknown, content: BusContent, current: Effect[]): string[] {
  const shown = elements(state);
  const here = new Set(shown.present);
  const hit = hitOf(current);
  const lines: string[] = [];
  for (const channel of content.channels) {
    if (!here.has(channel.id) && !hit.removed.has(channel.id)) continue;
    lines.push(`${channel.kind} ${channel.label ?? channel.id}${hit.has(channel.id) ? '*' : ''}`);
    for (const partition of lanesOf(channel)) {
      const events = laneEvents(channel, partition).filter(
        (event) => here.has(event.id) || hit.removed.has(event.id),
      );
      if (events.length === 0 && channel.events.length === 0) continue;
      const text = events.map((event) => {
        const offset = laneEvents(channel, partition).indexOf(event);
        const status = eventState(event, shown.patches);
        const body = `${channel.kind === 'topic' ? `${offset}:` : ''}${event.label ?? event.id}${status === undefined ? '' : ` ${status}`}`;
        return hit.has(event.id) ? `>${body}<` : body;
      });
      lines.push(
        `  ${partition === undefined ? 'events' : partition}: ${text.length === 0 ? 'empty' : clip(text.join(' '), 220)}`,
      );
    }
    for (const cursor of channel.cursors.filter((item) => here.has(item.id))) {
      const owner = ownerOf(cursor, shown.patches);
      lines.push(
        `  group ${cursor.group ?? cursor.id}${cursor.partition === undefined ? '' : ` on ${cursor.partition}`}: committed ${committedAt(cursor, shown.patches)}, lag ${lagOf(channel, cursor, { ...shown, focus: undefined })}, owner ${owner ?? 'none'}${hit.has(cursor.id) ? '*' : ''}`,
      );
    }
    const parties = (items: readonly { id: string; label?: string | undefined }[]) =>
      items
        .filter((item) => here.has(item.id))
        .map((item) => `${item.label ?? item.id}${hit.has(item.id) ? '*' : ''}`);
    const producers = parties(channel.producers);
    if (producers.length > 0) lines.push(`  producers: ${cap(producers)}`);
    const consumers = parties(channel.consumers);
    if (consumers.length > 0) lines.push(`  consumers: ${cap(consumers)}`);
    for (const rule of channel.rules.filter((item) => here.has(item.id))) {
      const targets = parties(rule.targets);
      lines.push(
        `  rule ${rule.label ?? rule.id}${hit.has(rule.id) ? '*' : ''}${targets.length === 0 ? '' : ` -> ${cap(targets)}`}`,
      );
    }
  }
  return lines.length === 0 ? ['no channel shown'] : lines;
}
