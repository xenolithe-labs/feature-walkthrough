/**
 * The pure part of the array panel: its content schema and the questions the
 * view, the lint and the tests ask of a state. No React, no CSS.
 */
import { z } from 'zod';
import { IdSchema, type ElementsState } from '../../core';
import { TONES } from '../_shared/changes';

const Scalar = z.union([z.string(), z.number()]);

export const ArrayContent = z.strictObject({
  arrays: z
    .array(
      z.strictObject({
        id: IdSchema,
        /** A name for the row of cells. Defaults to the id. */
        label: z.string().optional(),
        /** The values at the start. */
        cells: z.array(Scalar),
        /**
         * How many cells the array can ever have. Cells past `cells` start empty and absent
         * until a call adds them, which is how a queue or a stack grows without anything moving.
         */
        length: z.number().int().min(0).optional(),
        /** Present before the first call. Defaults to the pane's `initial`. */
        initial: z.boolean().optional(),
      }),
    )
    .min(1),
  pointers: z
    .array(
      z.strictObject({
        id: IdSchema,
        /** The array it points into. Optional when the pane has one array. */
        array: IdSchema.optional(),
        /** The cell index it starts at. `null` points at nothing. */
        at: z.number().int().nullable().default(null),
        label: z.string().optional(),
        /** Whether the pointer hangs under the cells or sits over them. */
        side: z.enum(['above', 'below']).default('below'),
        tone: z.enum(TONES).optional(),
        initial: z.boolean().optional(),
      }),
    )
    .default([]),
  ranges: z
    .array(
      z.strictObject({
        id: IdSchema,
        array: IdSchema.optional(),
        /** First and last cell, inclusive: an index, or the id of a pointer to follow. */
        from: z.union([z.number().int(), IdSchema]),
        to: z.union([z.number().int(), IdSchema]),
        label: z.string().optional(),
        tone: z.enum(TONES).optional(),
        /** Draw the cells outside the range as dimmed. */
        dim: z.boolean().default(false),
        initial: z.boolean().optional(),
      }),
    )
    .default([]),
  /** Whether elements are present before the first call unless they say otherwise. */
  initial: z.boolean().default(true),
});
export type ArrayContent = z.infer<typeof ArrayContent>;
export type ArrayDecl = ArrayContent['arrays'][number];
export type PointerDecl = ArrayContent['pointers'][number];
export type RangeDecl = ArrayContent['ranges'][number];

/** The element id of a cell: `<array>.<index>`. */
export const cellId = (array: string, index: number) => `${array}.${index}`;

export const slotCount = (array: ArrayDecl) => Math.max(array.length ?? 0, array.cells.length);

/** The array a pointer or range belongs to: the one it names, or the pane's only one. */
export function arrayOf(content: ArrayContent, item: { array?: string | undefined }) {
  const id = item.array ?? (content.arrays.length === 1 ? content.arrays[0]!.id : undefined);
  return content.arrays.find((array) => array.id === id);
}

export function entitiesOf(content: ArrayContent) {
  return [
    ...content.arrays.flatMap((array) =>
      Array.from({ length: slotCount(array) }, (_, index) => ({
        id: cellId(array.id, index),
        label: `${array.label ?? array.id}[${index}]`,
        initial: index < array.cells.length && (array.initial ?? content.initial),
      })),
    ),
    ...content.pointers.map((pointer) => ({
      id: pointer.id,
      label: pointer.label ?? pointer.id,
      initial: pointer.initial ?? content.initial,
    })),
    ...content.ranges.map((range) => ({
      id: range.id,
      label: range.label ?? range.id,
      initial: range.initial ?? content.initial,
    })),
  ];
}

type Patches = ElementsState['patches'];

/** The text of a cell: a patched value, else the declared one, else empty. */
export function cellValue(array: ArrayDecl, index: number, patches: Patches): string | number {
  const patched: unknown = patches[cellId(array.id, index)]?.value;
  if (typeof patched === 'string' || typeof patched === 'number') return patched;
  return array.cells[index] ?? '';
}

/** Where a pointer points now: an index (possibly off either end), or null. */
export function pointerAt(pointer: PointerDecl, patches: Patches): number | null {
  const patched = patches[pointer.id]?.at;
  if (patched === null || (typeof patched === 'number' && Number.isInteger(patched)))
    return patched;
  return pointer.at;
}

/**
 * A range as cell indexes, following any pointers it is bound to. `null` when a pointer it
 * follows points at nothing or is not present. `from > to` is an empty range and is allowed.
 */
export function rangeBounds(
  content: ArrayContent,
  range: RangeDecl,
  state: ElementsState,
): { from: number; to: number } | null {
  const end = (value: number | string, key: 'from' | 'to'): number | null => {
    const patched = state.patches[range.id]?.[key];
    const chosen = typeof patched === 'number' || typeof patched === 'string' ? patched : value;
    if (typeof chosen === 'number') return chosen;
    const pointer = content.pointers.find((item) => item.id === chosen);
    if (pointer === undefined || !state.present.includes(pointer.id)) return null;
    return pointerAt(pointer, state.patches);
  };
  const from = end(range.from, 'from');
  const to = end(range.to, 'to');
  return from === null || to === null ? null : { from, to };
}

/** The values of one array now, for the cells that are present. Used by tests and the card. */
export function valuesOf(
  content: ArrayContent,
  state: ElementsState,
  arrayId: string,
): (string | number)[] {
  const array = content.arrays.find((item) => item.id === arrayId);
  if (array === undefined) throw new Error(`no array "${arrayId}"`);
  const values: (string | number)[] = [];
  for (let index = 0; index < slotCount(array); index += 1) {
    if (state.present.includes(cellId(array.id, index))) {
      values.push(cellValue(array, index, state.patches));
    }
  }
  return values;
}

/** What a pointer is pointing at, in words: "index 3 (value 12)", "past the end". */
export function describePointer(
  content: ArrayContent,
  pointer: PointerDecl,
  state: ElementsState,
): string {
  const at = pointerAt(pointer, state.patches);
  if (at === null) return 'nothing';
  const array = arrayOf(content, pointer);
  if (array === undefined) return `index ${at}`;
  if (at < 0) return `index ${at}, before the start`;
  if (at >= slotCount(array)) return `index ${at}, past the end`;
  if (!state.present.includes(cellId(array.id, at))) return `index ${at}, an empty slot`;
  return `index ${at} (value ${cellValue(array, at, state.patches)})`;
}
