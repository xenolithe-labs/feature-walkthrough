/**
 * The pure part of the bytes panel: its content schema, the geometry that is worked out from it
 * (offsets, rows, the pieces of a field that straddles a row) and the readings of values. No
 * React, no CSS: the view, the lint and the tests all ask this file.
 *
 * Nothing here is written by the author. A field has a size and a value; where it starts, which
 * row it falls on, how many pieces it is drawn in and how long the frame is are all derived.
 */
import { z } from 'zod';
import { IdSchema, RefSchema, own, type ElementsState } from '../../core';
import { TONES } from '../_shared/changes';

export const UNITS = ['bits', 'bytes', 'segments'] as const;
export type Unit = (typeof UNITS)[number];

/** The id a frame's parser cursor has: `<frame>.cursor`. A field may not be called `cursor`. */
export const CURSOR = 'cursor';

/** A fixed field never draws more rows than this unless it says it is `variable`. */
const MAX_SLOTS = 1 << 20;

/** The same link a `payload` leaf has: `{ "$ref": "<element id>", "text": "shown text" }`. */
const LinkSchema = z.strictObject({ $ref: RefSchema, text: z.string().optional() });

const FieldSchema = z.strictObject({
  id: IdSchema,
  /** The name of the field. Defaults to its id. */
  label: z.string().min(1).optional(),
  /** What is drawn in a field too narrow for its label, such as "SYN" or "S". */
  short: z.string().min(1).optional(),
  /**
   * Bits or bytes (the frame's unit) for a fixed field. In a `segments` frame it is the length of
   * the text in characters, and is only there to be checked. Leave it out for a `variable` field
   * whose size is not known.
   */
  size: z.number().int().positive().max(MAX_SLOTS).optional(),
  /**
   * A field whose length varies (options, a payload). With a `size` that is its length here and
   * rows past the second are drawn as a gap; without one it runs on and must be the last field.
   */
  variable: z.boolean().default(false),
  /**
   * The value. In a `bits` frame a number or text that reads as one (`0x01bb`, `0b101`, `443`).
   * In a `bytes` frame a number, or hex digits (`16 03 03`, `0x1603`). In a `segments` frame the
   * text of the segment.
   */
  value: z.union([z.string(), z.number()]).optional(),
  /** What the value means: the hex is `0x01bb`, the meaning is `443 (https)`. */
  decoded: z.string().optional(),
  /** A link to an element in another pane, with the same shape as a `payload` link. */
  link: LinkSchema.optional(),
  /**
   * This field's value counts something: how many `per`-sized pieces the fields `of` it hold,
   * in the frame's unit. TCP's Data Offset counts 32-bit words of the header; a length counts
   * bytes of what follows. Lint checks the value against the sizes at every call.
   */
  counts: z
    .strictObject({
      of: z.union([IdSchema, z.strictObject({ from: IdSchema, to: IdSchema })]),
      per: z.number().int().positive().default(1),
    })
    .optional(),
  tone: z.enum(TONES).optional(),
});

const CursorSchema = z.strictObject({
  /** An offset in the frame's unit: the next one to read. `null` points at nothing. */
  at: z.number().int().min(0).nullable().default(0),
  label: z.string().min(1).default('next'),
  tone: z.enum(TONES).optional(),
});

const FrameSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1),
  /** A second, smaller line: what carries it, or who sends it. */
  sub: z.string().optional(),
  unit: z.enum(UNITS),
  /** Bits or bytes per row. Defaults to 32 for bits (the way RFCs draw headers) and 16 for bytes. */
  width: z.number().int().min(1).max(128).optional(),
  /** Bytes: an ASCII gutter at the end of each row, as a hex dump has. */
  ascii: z.boolean().default(false),
  /** Bits: a ruler of bit positions above the rows. */
  ruler: z.boolean().default(true),
  /** Segments: what is written between two segments. */
  separator: z.string().min(1).default('.'),
  /** The length the frame is said to have, in its unit. Lint checks it against the fields. */
  length: z.number().int().positive().optional(),
  /** The field of another frame this one is carried in: `frame.field`. It is drawn indented. */
  inside: RefSchema.optional(),
  /** A parser position, moved by `update` with `fields.at`. */
  cursor: CursorSchema.optional(),
  fields: z.array(FieldSchema).min(1),
  tone: z.enum(TONES).optional(),
  /** Present before the first call. Defaults to the pane's `initial`. */
  initial: z.boolean().optional(),
});

export const BytesContent = z.strictObject({
  frames: z.array(FrameSchema).min(1),
  /** Whether frames are present before the first call unless they say otherwise. */
  initial: z.boolean().default(true),
});
export type BytesContent = z.infer<typeof BytesContent>;
export type FrameDecl = BytesContent['frames'][number];
export type FieldDecl = FrameDecl['fields'][number];

/** What an `update` may set. A field's size is never one of them: offsets never move. */
export const FRAME_FIELDS = ['title', 'sub', 'tone'] as const;
export const FIELD_FIELDS = ['value', 'decoded', 'tone'] as const;
export const CURSOR_FIELDS = ['at', 'label', 'tone'] as const;

export const fieldId = (frame: string, field: string) => `${frame}.${field}`;
export const cursorId = (frame: string) => `${frame}.${CURSOR}`;

export const rowWidth = (frame: FrameDecl) => frame.width ?? (frame.unit === 'bits' ? 32 : 16);

export function entitiesOf(content: BytesContent) {
  return content.frames.flatMap((frame) => {
    const initial = frame.initial ?? content.initial;
    return [
      { id: frame.id, label: frame.title, initial },
      // Fields and the cursor have no presence of their own: they are drawn while the frame is.
      // Core lint only knows each id's own history, so they are present from the start and the
      // panel's lint answers for the frame (`bytes/absent-frame`).
      ...frame.fields.map((field) => ({
        id: fieldId(frame.id, field.id),
        label: field.label ?? field.id,
        initial: true,
      })),
      ...(frame.cursor === undefined
        ? []
        : [{ id: cursorId(frame.id), label: `${frame.id} cursor`, initial: true }]),
    ];
  });
}

/** The ids of everything that belongs to a frame, for dropping its changes when it is removed. */
export const childrenOf = (content: BytesContent): Record<string, readonly string[]> =>
  Object.fromEntries(
    content.frames.map((frame) => [
      frame.id,
      [
        ...frame.fields.map((field) => fieldId(frame.id, field.id)),
        ...(frame.cursor === undefined ? [] : [cursorId(frame.id)]),
      ],
    ]),
  );

type Patches = ElementsState['patches'];

/** The value of a field now: a patched one, else the declared one. */
export function valueOf(
  frame: FrameDecl,
  field: FieldDecl,
  patches: Patches,
): string | number | undefined {
  const patched: unknown = own(patches, fieldId(frame.id, field.id))?.value;
  return typeof patched === 'string' || typeof patched === 'number' ? patched : field.value;
}

export function decodedOf(
  frame: FrameDecl,
  field: FieldDecl,
  patches: Patches,
): string | undefined {
  const patched: unknown = own(patches, fieldId(frame.id, field.id))?.decoded;
  return typeof patched === 'string' ? patched : field.decoded;
}

/** Where the cursor of a frame is now: an offset, or null for nothing. */
export function cursorAt(frame: FrameDecl, patches: Patches): number | null {
  if (frame.cursor === undefined) return null;
  const patched: unknown = own(patches, cursorId(frame.id))?.at;
  if (patched === null) return null;
  if (typeof patched === 'number' && Number.isInteger(patched) && patched >= 0) return patched;
  return frame.cursor.at;
}

// ---- values ----------------------------------------------------------------------------------

/** The text of a `value` as bytes: hex digits, with spaces, underscores and a `0x` allowed. */
export function hexBytes(text: string): number[] | undefined {
  const digits = text.replace(/^\s*0x/i, '').replace(/[\s_]/g, '');
  if (!/^[0-9a-f]*$/i.test(digits) || digits.length % 2 !== 0) return undefined;
  return Array.from({ length: digits.length / 2 }, (_, i) =>
    parseInt(digits.slice(i * 2, i * 2 + 2), 16),
  );
}

/**
 * The number a value stands for, or undefined when it is not numeric. In a bits frame text is
 * `0x…`, `0b…` or decimal; in a bytes frame text is hex digits. `-` and fractions are not numeric.
 */
export function numeric(unit: Unit, value: string | number | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : undefined;
  }
  const text = value.trim().replace(/_/g, '');
  if (unit === 'bytes') {
    const bytes = hexBytes(text);
    return bytes === undefined || bytes.length === 0
      ? undefined
      : bytes.reduce((sum, byte) => sum * 256n + BigInt(byte), 0n);
  }
  if (unit === 'segments') return undefined;
  if (/^0x[0-9a-f]+$/i.test(text) || /^0b[01]+$/i.test(text) || /^\d+$/.test(text)) {
    return BigInt(text);
  }
  return undefined;
}

/** What a judge says about a value that is meant to be a number, or null when it is fine. */
export function judgeValue(
  unit: Unit,
  size: number | undefined,
  value: unknown,
  what: string,
): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return `${what} takes text or a number; got ${JSON.stringify(value)}`;
  }
  if (unit === 'segments') return null;
  if (typeof value === 'number' && !(Number.isSafeInteger(value) && value >= 0)) {
    return `${what} is a whole number from 0 up; got ${value}`;
  }
  if (unit === 'bytes') {
    if (typeof value === 'string') {
      const bytes = hexBytes(value);
      if (bytes === undefined) {
        return `${what} is hex digits in pairs ("16 03 03"); got ${JSON.stringify(value)}`;
      }
      if (size !== undefined && bytes.length !== size) {
        return `${what} is ${bytes.length} byte${bytes.length === 1 ? '' : 's'} but the field is ${size}`;
      }
      return null;
    }
  }
  const number = numeric(unit, value);
  if (number === undefined) {
    // Text that is not a number is allowed in a bits field (an opaque value), not in a bytes one.
    return unit === 'bytes' ? `${what} is not a number` : null;
  }
  if (size !== undefined && number >= 1n << BigInt(size * (unit === 'bytes' ? 8 : 1))) {
    return `${what} ${String(value)} does not fit ${size} ${unit === 'bytes' ? 'byte' : 'bit'}${size === 1 ? '' : 's'}`;
  }
  return null;
}

/** The bytes of a field's value, padded or left as they are, for a hex view. Undefined if unknown. */
export function bytesOfField(
  field: FieldDecl,
  value: string | number | undefined,
): number[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    const bytes = hexBytes(value);
    if (bytes !== undefined) return bytes;
  }
  const number = numeric('bytes', value);
  if (number === undefined || field.size === undefined) return undefined;
  const hex = number.toString(16).padStart(field.size * 2, '0');
  return hexBytes(hex);
}

// ---- geometry ----------------------------------------------------------------------------------

export interface Placed {
  /** The field's own id, such as `seq`. */
  id: string;
  /** Where it starts, in the frame's unit. For segments: characters into the joined text. */
  offset: number;
  /** Its size, or null for a field that runs on to an end nobody knows. */
  size: number | null;
}

export interface Measure {
  fields: Placed[];
  /** The length of the whole frame, or null while the last field's size is unknown. */
  total: number | null;
}

/**
 * Where every field starts and how long the frame is. Bits and bytes use the declared sizes; for
 * segments the size is the length of the text now, so `text` gives each field's text. A field
 * without a size comes out as null, which is only meaningful for the last one.
 */
export function measure(
  frame: FrameDecl,
  text?: (field: FieldDecl) => string | undefined,
): Measure {
  const placed: Placed[] = [];
  let offset = 0;
  let unknown = false;
  frame.fields.forEach((field, index) => {
    let size: number | null;
    if (frame.unit === 'segments') {
      size = (text?.(field) ?? (typeof field.value === 'string' ? field.value : '')).length;
    } else {
      size = field.size ?? null;
    }
    placed.push({ id: field.id, offset, size });
    if (size === null) unknown = true;
    else offset += size;
    if (frame.unit === 'segments' && index < frame.fields.length - 1)
      offset += frame.separator.length;
  });
  return { fields: placed, total: unknown ? null : offset };
}

/** One drawn rectangle of a field: a field that straddles a row boundary has several. */
export interface Piece {
  field: string;
  /** Rows start at 0. Rows an elided field skips are not counted. */
  row: number;
  /** The column the piece starts in, 0 to width - 1. */
  col: number;
  /** How many columns it covers. */
  span: number;
  /** Which piece of the field this is (from 0) and how many it has. */
  part: number;
  parts: number;
  /** The absolute offset of its first column. */
  from: number;
  /** How many slots of the field come before this piece (for reading the bytes it holds). */
  skip: number;
  /**
   * `cells` is an ordinary piece; `open` a field with no known end, drawn to the end of its row;
   * `gap` stands for `hidden` slots of a variable field that are not drawn.
   */
  kind: 'cells' | 'open' | 'gap';
  hidden: number;
}

export interface Layout {
  width: number;
  rows: number;
  pieces: Piece[];
}

/**
 * Lays out a bits or bytes frame in rows of `width`. A field that crosses a row boundary is cut
 * into pieces, one per row it touches. A `variable` field of known size that would fill more than
 * one whole row in the middle has those rows replaced by one gap row, so a 1400-byte payload does
 * not draw 88 rows; the offsets after it are still the real ones.
 */
export function layout(frame: FrameDecl, width: number = rowWidth(frame)): Layout {
  const pieces: Piece[] = [];
  const geometry = measure(frame);
  let skipped = 0;
  frame.fields.forEach((field, index) => {
    const at = geometry.fields[index]!;
    const start = at.offset;
    if (at.size === null) {
      const col = start % width;
      pieces.push({
        field: field.id,
        row: Math.floor(start / width) - skipped,
        col,
        span: width - col,
        part: 0,
        parts: 1,
        from: start,
        skip: 0,
        kind: 'open',
        hidden: 0,
      });
      return;
    }
    const end = start + at.size;
    const first = Math.floor(start / width);
    const last = Math.floor((end - 1) / width);
    const middle = last - first - 1;
    // Rows a gap drops from the drawing, counted before this field and after it.
    const before = skipped;
    const elide = field.variable && middle > 1;
    const after = elide ? before + middle - 1 : before;
    const parts: Omit<Piece, 'part' | 'parts'>[] = [];
    const make = (
      row: number,
      shift: number,
      from: number,
      to: number,
      kind: Piece['kind'],
      hidden = 0,
    ) =>
      parts.push({
        field: field.id,
        row: row - shift,
        col: kind === 'gap' ? 0 : from % width,
        span: kind === 'gap' ? width : to - from,
        from,
        skip: from - start,
        kind,
        hidden,
      });
    if (first === last) {
      make(first, before, start, end, 'cells');
    } else {
      make(first, before, start, (first + 1) * width, 'cells');
      if (elide) {
        make(first + 1, before, (first + 1) * width, last * width, 'gap', middle * width);
      } else {
        for (let row = first + 1; row < last; row += 1) {
          make(row, before, row * width, (row + 1) * width, 'cells');
        }
      }
      make(last, after, last * width, end, 'cells');
    }
    skipped = after;
    parts.forEach((part, position) =>
      pieces.push({ ...part, part: position, parts: parts.length }),
    );
  });
  const rows = pieces.reduce((most, piece) => Math.max(most, piece.row + 1), 0);
  return { width, rows, pieces };
}

/**
 * The row width to draw at. A pane that cannot give each column `minColumn` pixels halves the
 * row (32 becomes 16, then 8) while the width stays even and at least 8. A field that was one
 * piece may then be two: the frame is the same, drawn narrower.
 */
export function fitWidth(declared: number, available: number, minColumn: number): number {
  let width = declared;
  if (available <= 0) return width;
  while (width > 8 && width % 2 === 0 && available / width < minColumn) width /= 2;
  return width;
}

export interface CursorPlace {
  row: number;
  col: number;
  /** `end` draws the bar at the right edge of the cell: the cursor is at the end of the frame. */
  edge: 'start' | 'end';
}

/** Where a cursor at `at` is drawn in a layout, or undefined when it cannot be placed. */
export function placeCursor(
  drawn: Layout,
  at: number,
  total: number | null,
): CursorPlace | undefined {
  const holds = (piece: Piece) => {
    const length = piece.kind === 'gap' ? piece.hidden : piece.span;
    return at >= piece.from && at < piece.from + length;
  };
  const piece = drawn.pieces.find(holds);
  if (piece !== undefined) {
    return {
      row: piece.row,
      col: piece.kind === 'gap' ? 0 : piece.col + (at - piece.from),
      edge: 'start',
    };
  }
  if (total !== null && at === total) {
    const last = drawn.pieces.at(-1);
    if (last === undefined) return undefined;
    return { row: last.row, col: last.col + last.span - 1, edge: 'end' };
  }
  return undefined;
}

// ---- readings ---------------------------------------------------------------------------------

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Where a field is, in words: `bits 96–127`, `byte 4`, `characters 12–47`. */
export function whereIs(unit: Unit, offset: number, size: number | null): string {
  const word = unit === 'bits' ? 'bit' : unit === 'bytes' ? 'byte' : 'character';
  if (size === null) return `${word} ${offset} onwards`;
  if (size === 0) return `${word} ${offset}, empty`;
  if (size === 1) return `${word} ${offset}`;
  return `${word}s ${offset}–${offset + size - 1}`;
}

/** The length of a frame in words: `20 bytes (160 bits)`. */
export function describeTotal(unit: Unit, total: number | null, fields: number): string {
  if (total === null) return 'length not fixed';
  if (unit === 'bits') {
    return total % 8 === 0
      ? `${plural(total / 8, 'byte')} (${plural(total, 'bit')})`
      : plural(total, 'bit');
  }
  if (unit === 'bytes') return plural(total, 'byte');
  return `${plural(total, 'character')} in ${plural(fields, 'segment')}`;
}

/** What `size` of a field is, in words. */
export function describeSize(unit: Unit, size: number | null): string {
  if (size === null) return 'variable length';
  if (unit === 'bits') return plural(size, 'bit');
  if (unit === 'bytes') return plural(size, 'byte');
  return plural(size, 'character');
}

/** Slots (bits or bytes) the fields `of` hold, or undefined when one of them has no known size. */
export function countedSlots(
  frame: FrameDecl,
  of: NonNullable<FieldDecl['counts']>['of'],
): number | undefined {
  const ids = frame.fields.map((field) => field.id);
  const from = typeof of === 'string' ? of : of.from;
  const to = typeof of === 'string' ? of : of.to;
  const a = ids.indexOf(from);
  const b = ids.indexOf(to);
  if (a < 0 || b < 0 || a > b) return undefined;
  const sizes = frame.fields.slice(a, b + 1).map((field) => field.size);
  return sizes.some((size) => size === undefined)
    ? undefined
    : sizes.reduce<number>((sum, size) => sum + size!, 0);
}

/** The value a counting field should have, or undefined when it cannot be said. */
export function expectedCount(frame: FrameDecl, field: FieldDecl): number | undefined {
  if (field.counts === undefined || frame.unit === 'segments') return undefined;
  const slots = countedSlots(frame, field.counts.of);
  if (slots === undefined || slots % field.counts.per !== 0) return undefined;
  return slots / field.counts.per;
}
