/**
 * What a reader sees in an array pane, as text: each array as its values in brackets, with the
 * cells the current call touched in `>..<`, then its pointers and ranges.
 *
 *   items: [12 19 23 >31< 46 58] lo=3 hi=5 mid=3* window=3..5
 */
import type { Effect } from '../../core';
import { elements, hitOf } from '../_shared/describe';
import {
  arrayOf,
  cellId,
  cellValue,
  pointerAt,
  rangeBounds,
  slotCount,
  type ArrayContent,
} from './model';

/** Cells a line shows before it elides the middle. */
const MOST_CELLS = 40;

export function describeArray(state: unknown, content: ArrayContent, current: Effect[]): string[] {
  const shown = elements(state);
  const present = new Set(shown.present);
  const hit = hitOf(current);
  const lines: string[] = [];
  for (const array of content.arrays) {
    const cells: string[] = [];
    const total = slotCount(array);
    for (let index = 0; index < total; index += 1) {
      const id = cellId(array.id, index);
      const here = present.has(id);
      if (!here && !hit.removed.has(id)) {
        cells.push('_');
        continue;
      }
      const text = here ? String(cellValue(array, index, shown.patches)) : '';
      // An empty slot is drawn as _, whether it is absent or present and empty.
      const value = text === '' ? '_' : text;
      cells.push(hit.has(id) ? `>${value}<` : value);
    }
    const body =
      cells.length > MOST_CELLS
        ? `${cells.slice(0, MOST_CELLS).join(' ')} … (${cells.length} cells)`
        : cells.join(' ');
    const marks: string[] = [];
    for (const pointer of content.pointers) {
      if (arrayOf(content, pointer)?.id !== array.id || !present.has(pointer.id)) continue;
      const at = pointerAt(pointer, shown.patches);
      marks.push(`${pointer.id}=${at === null ? 'none' : at}${hit.has(pointer.id) ? '*' : ''}`);
    }
    for (const range of content.ranges) {
      if (arrayOf(content, range)?.id !== array.id || !present.has(range.id)) continue;
      const bounds = rangeBounds(content, range, shown);
      const text =
        bounds === null
          ? 'none'
          : bounds.from > bounds.to
            ? 'empty'
            : `${bounds.from}..${bounds.to}`;
      marks.push(`${range.id}=${text}${hit.has(range.id) ? '*' : ''}`);
    }
    lines.push(
      `${array.label ?? array.id}: [${body}]${marks.length === 0 ? '' : ` ${marks.join(' ')}`}`,
    );
  }
  return lines;
}
