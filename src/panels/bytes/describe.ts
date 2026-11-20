/**
 * What a reader sees in a bytes pane, as text: each frame that is shown, its fields in order
 * with their values (and what the value means), the parser cursor, and which of them the
 * current call touched.
 */
import type { Effect } from '../../core';
import { MOST, clip, elements, hitOf, show } from '../_shared/describe';
import {
  cursorAt,
  cursorId,
  decodedOf,
  fieldId,
  rowWidth,
  valueOf,
  type BytesContent,
} from './model';

const MOST_FIELDS = 16;

export function describeBytes(state: unknown, content: BytesContent, current: Effect[]): string[] {
  const shown = elements(state);
  const here = new Set(shown.present);
  const hit = hitOf(current);
  const lines: string[] = [];
  for (const frame of content.frames) {
    if (!here.has(frame.id) && !hit.removed.has(frame.id)) continue;
    const tag = hit.removed.has(frame.id)
      ? ' (removed)'
      : hit.added.has(frame.id)
        ? ' (added)'
        : '';
    lines.push(
      `${frame.title}${hit.has(frame.id) ? '*' : ''}${tag} [${frame.unit}, ${rowWidth(frame)} per row${frame.inside === undefined ? '' : `, inside ${frame.inside}`}]`,
    );
    const fields = frame.fields.slice(0, MOST_FIELDS).map((field) => {
      const id = fieldId(frame.id, field.id);
      const value = valueOf(frame, field, shown.patches);
      const decoded = decodedOf(frame, field, shown.patches);
      const text = `${field.label ?? field.id}=${value === undefined ? '?' : clip(show(value), 24)}${decoded === undefined ? '' : ` (${clip(decoded, 24)})`}`;
      return hit.has(id) ? `>${text}<` : text;
    });
    lines.push(
      `  ${fields.join(' | ')}${frame.fields.length > MOST_FIELDS ? ` | and ${frame.fields.length - MOST_FIELDS} more fields` : ''}`,
    );
    if (frame.cursor !== undefined) {
      const at = cursorAt(frame, shown.patches);
      lines.push(
        `  ${frame.cursor.label} at ${at === null ? 'nothing' : at}${hit.has(cursorId(frame.id)) ? '*' : ''}`,
      );
    }
    if (lines.length > MOST * 3) break;
  }
  return lines.length === 0 ? ['no frame shown'] : lines;
}
