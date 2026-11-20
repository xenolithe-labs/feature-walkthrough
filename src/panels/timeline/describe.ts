/**
 * What a reader sees in a timeline pane, as text: where "now" is, then for each row the instants
 * that have happened, the spans that are drawn (still running, or finished) and the limits with
 * whether they held, marking what the current call touched.
 */
import type { Effect } from '../../core';
import { cap, elements, hitOf } from '../_shared/describe';
import {
  NOW,
  evaluateLimit,
  instantShown,
  nowOf,
  spanDrawn,
  type TimelineContent,
  type TimelineState,
} from './model';

export function describeTimeline(
  state: TimelineState,
  content: TimelineContent,
  current: Effect[],
): string[] {
  const shown = elements(state);
  const view = { ...shown, start: content.now ?? content.axis.from, moved: undefined };
  const here = new Set(shown.present);
  const hit = hitOf(current);
  const now = nowOf(content, shown.patches);
  const unit = content.axis.unit;
  const lines = [
    `now = ${now} ${unit} (axis ${content.axis.from} to ${content.axis.to})${hit.has(NOW) ? '*' : ''}`,
  ];
  for (const row of content.rows) {
    if (!here.has(row.id) && !hit.removed.has(row.id)) continue;
    const parts: string[] = [];
    for (const instant of content.instants.filter((item) => item.row === row.id)) {
      if (!instantShown(instant, view, now)) continue;
      const word = instant.label ?? instant.id;
      const status = (shown.patches[instant.id]?.state as string | undefined) ?? instant.state;
      const text = `${word}@${instant.at}${status === undefined || status === 'none' ? '' : ` ${status}`}`;
      parts.push(hit.has(instant.id) ? `>${text}<` : text);
    }
    for (const span of content.spans.filter((item) => item.row === row.id)) {
      const drawn = spanDrawn(span, view, now);
      if (drawn === null) continue;
      const status = (shown.patches[span.id]?.state as string | undefined) ?? span.state;
      const text = `${span.label ?? span.id} ${drawn.from}..${drawn.to}${drawn.open ? ' (running)' : ''}${status === undefined || status === 'none' ? '' : ` ${status}`}`;
      parts.push(hit.has(span.id) ? `>${text}<` : text);
    }
    for (const limit of content.limits.filter((item) => item.row === row.id)) {
      const result = evaluateLimit(content, limit, view, now);
      if (result.status === 'hidden') continue;
      const text = `limit ${limit.label ?? limit.id} ${result.status}${result.limitAt === null ? '' : ` (at ${result.limitAt})`}${result.late.length > 0 ? `, late: ${result.late.join(' ')}` : ''}`;
      parts.push(hit.has(limit.id) ? `>${text}<` : text);
    }
    lines.push(
      `${row.label ?? row.id}${hit.has(row.id) ? '*' : ''}: ${parts.length === 0 ? 'nothing yet' : cap(parts, 12)}`,
    );
  }
  return lines;
}
