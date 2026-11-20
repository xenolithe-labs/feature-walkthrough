/**
 * Record nodes: a node made of named slots. Everything here is pure, so that the renderer, the
 * edge routing, the layout sizes and lint all agree on one geometry and nothing is measured in
 * the DOM.
 *
 * A slot is an element whose id is `<node>.<slot>`. A pointer is a slot that an edge starts from.
 */
import { z } from 'zod';
import { IdSchema, RefSchema, own, writtenEffects } from '../../core';
import type { Walkthrough } from '../../core';
import { TONES } from '../_shared/changes';

export const SlotSchema = z.strictObject({
  id: IdSchema,
  /** The text in the slot. Numbers are shown as written. */
  value: z.union([z.string(), z.number()]).optional(),
  /** Shown instead of the id as the slot's name. */
  label: z.string().optional(),
  tone: z.enum(TONES).optional(),
  /** Reserve room for text this wide (in characters) even if no value is that long. */
  width: z.number().int().min(1).max(40).optional(),
  /** Present before the first call. Defaults to true: a slot comes with its node. */
  initial: z.boolean().optional(),
});
export type SlotDecl = z.infer<typeof SlotSchema>;

/** An edge end: a node id, or `node.slot`. */
export const EndSchema = RefSchema.refine(
  (ref) => ref.split('.').length <= 2 && !ref.includes(':'),
  {
    message: 'an edge end is a node id, or "<node>.<slot>"',
  },
);

/** A node id and, when the end names one, the slot. */
export function splitEnd(end: string): { node: string; slot: string | undefined } {
  const dot = end.indexOf('.');
  return dot < 0
    ? { node: end, slot: undefined }
    : { node: end.slice(0, dot), slot: end.slice(dot + 1) };
}

export const slotId = (node: string, slot: string) => `${node}.${slot}`;

export type SlotDirection = 'row' | 'column';

export interface RecordShape {
  id: string;
  slots: readonly SlotDecl[];
  direction: SlotDirection;
  /** Draw the node's label as a caption strip above the slots. */
  head: boolean;
  /** Draw each slot's name beside or above its value. */
  names: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordGeometry {
  width: number;
  height: number;
  /** The caption strip, or undefined when there is none. */
  head: Rect | undefined;
  /** Where each slot is, relative to the node's top left, by slot id. */
  slots: Record<string, Rect>;
}

const CHAR = 7.8;
const NAME_CHAR = 6.2;
export const HEAD_HEIGHT = 20;
const ROW_SLOT_HEIGHT = 44;
const ROW_SLOT_HEIGHT_PLAIN = 34;
const COLUMN_SLOT_HEIGHT = 28;
const MIN_SLOT_WIDTH = 34;

/** Text of a value as it is shown. */
export const valueText = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

/**
 * The longest text each slot of a node ever shows: its declared value and every `value` written
 * to it by any call of the walkthrough. Sizes use this, so a slot does not change width as the
 * cursor moves and nothing around it shifts.
 */
export function widestValues(
  paneId: string,
  nodes: readonly { id: string; slots?: readonly SlotDecl[] | undefined }[],
  walkthrough: Walkthrough,
): Map<string, number> {
  const widest = new Map<string, number>();
  const grow = (id: string, length: number) =>
    widest.set(id, Math.max(widest.get(id) ?? 0, length));
  for (const node of nodes) {
    for (const slot of node.slots ?? []) {
      grow(slotId(node.id, slot.id), Math.max(valueText(slot.value).length, slot.width ?? 0));
    }
  }
  for (const step of walkthrough.steps) {
    for (const call of step.calls) {
      for (const effect of writtenEffects(call, paneId)) {
        if (effect.update === undefined || !widest.has(effect.update)) continue;
        const value: unknown = own(effect.fields, 'value');
        if (value !== undefined) grow(effect.update, valueText(value).length);
      }
    }
  }
  return widest;
}

/** The size and the slots' places of a record node. */
export function recordGeometry(
  shape: RecordShape,
  label: string,
  widest: ReadonlyMap<string, number>,
): RecordGeometry {
  const head = shape.head ? HEAD_HEIGHT : 0;
  const slots: Record<string, Rect> = {};
  const nameOf = (slot: SlotDecl) => slot.label ?? slot.id;
  const textWidth = (slot: SlotDecl) => (widest.get(slotId(shape.id, slot.id)) ?? 0) * CHAR;
  if (shape.direction === 'row') {
    const height = shape.names ? ROW_SLOT_HEIGHT : ROW_SLOT_HEIGHT_PLAIN;
    let x = 0;
    for (const slot of shape.slots) {
      const nameWidth = shape.names ? nameOf(slot).length * NAME_CHAR : 0;
      const width = Math.ceil(Math.max(MIN_SLOT_WIDTH, textWidth(slot) + 18, nameWidth + 14));
      slots[slot.id] = { x, y: head, width, height };
      x += width;
    }
    const captionWidth = shape.head ? label.length * 7 + 20 : 0;
    const total = Math.max(x, Math.ceil(captionWidth));
    // A caption wider than the slots gives its extra room to the last slot.
    const last = shape.slots.at(-1);
    if (last !== undefined && total > x) slots[last.id]!.width += total - x;
    return {
      width: total,
      height: head + height,
      head: shape.head ? { x: 0, y: 0, width: total, height: head } : undefined,
      slots,
    };
  }
  let widthOfAll = 0;
  for (const slot of shape.slots) {
    const nameWidth = shape.names ? nameOf(slot).length * NAME_CHAR + 10 : 0;
    widthOfAll = Math.max(widthOfAll, nameWidth + textWidth(slot) + 26);
  }
  widthOfAll = Math.ceil(
    Math.max(widthOfAll, MIN_SLOT_WIDTH + 20, shape.head ? label.length * 7 + 20 : 0),
  );
  let y = head;
  for (const slot of shape.slots) {
    slots[slot.id] = { x: 0, y, width: widthOfAll, height: COLUMN_SLOT_HEIGHT };
    y += COLUMN_SLOT_HEIGHT;
  }
  return {
    width: widthOfAll,
    height: y,
    head: shape.head ? { x: 0, y: 0, width: widthOfAll, height: head } : undefined,
    slots,
  };
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * The sides of a slot that lie on the node's outer border, where an arrow can leave or arrive
 * without crossing another slot. In a row only the first slot has a left side and only the last
 * a right side; the caption strip covers the top.
 */
export function openSides(shape: RecordShape, slot: string): Side[] {
  const index = shape.slots.findIndex((item) => item.id === slot);
  if (index < 0) return [];
  const first = index === 0;
  const last = index === shape.slots.length - 1;
  if (shape.direction === 'row') {
    return [
      ...(shape.head ? [] : (['top'] as const)),
      'bottom',
      ...(first ? (['left'] as const) : []),
      ...(last ? (['right'] as const) : []),
    ];
  }
  return [
    'left',
    'right',
    ...(first && !shape.head ? (['top'] as const) : []),
    ...(last ? (['bottom'] as const) : []),
  ];
}

export const NORMALS: Record<Side, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export function sidePoint(rect: Rect, side: Side): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }
}

/** Problems with the slot ids and edge ends of one pane, as plain messages with their place. */
export interface SlotProblem {
  rule: string;
  path: (string | number)[];
  message: string;
}

export interface EdgeLike {
  id?: string | undefined;
  from: string;
  to: string;
}

export const edgeIdOf = (edge: EdgeLike) => edge.id ?? `${edge.from}.${edge.to}`;

/**
 * Lint for slots: a node's slot ids are unique and an edge end names a slot the node has. Ids
 * that collide once derived (a slot `b` of node `a` and an edge from `a` to `b` are both `a.b`)
 * are reported by the core's duplicate-id check, which sees every element of the pane.
 */
export function slotProblems(
  nodes: readonly { id: string; slots?: readonly SlotDecl[] | undefined }[],
  edges: readonly EdgeLike[],
  base: (string | number)[],
): SlotProblem[] {
  const problems: SlotProblem[] = [];
  const slotsOf = new Map(
    nodes.map((node) => [node.id, new Set((node.slots ?? []).map((s) => s.id))]),
  );
  nodes.forEach((node, n) => {
    const seen = new Set<string>();
    (node.slots ?? []).forEach((slot, s) => {
      if (seen.has(slot.id)) {
        problems.push({
          rule: 'duplicate-slot',
          path: [...base, 'nodes', n, 'slots', s, 'id'],
          message: `node "${node.id}" has two slots with the id "${slot.id}"`,
        });
      }
      seen.add(slot.id);
    });
  });
  edges.forEach((edge, e) => {
    for (const end of ['from', 'to'] as const) {
      const { node, slot } = splitEnd(edge[end]);
      const slots = slotsOf.get(node);
      if (slot === undefined || slots === undefined) continue;
      if (!slots.has(slot)) {
        problems.push({
          rule: 'unknown-slot',
          path: [...base, 'edges', e, end],
          message:
            slots.size === 0
              ? `edge "${edgeIdOf(edge)}" names slot "${slot}" of node "${node}", which has no slots`
              : `edge "${edgeIdOf(edge)}" names slot "${slot}" of node "${node}". Its slots: ${[...slots].join(', ')}`,
        });
      }
    }
  });
  return problems;
}

/** Judges `fields` of a slot: `value` is text or a number. */
export function judgeSlotField(field: string, value: unknown): string | null | undefined {
  if (field !== 'value') return undefined;
  return typeof value === 'string' || typeof value === 'number'
    ? null
    : 'the field "value" takes text or a number';
}
