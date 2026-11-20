/**
 * Glue between React Flow's internal nodes and `slot-route.ts`: turns a node's measured box and a
 * slot's place inside it into diagram coordinates and routes between them.
 */
import { route, type Point } from './slot-route';
import type { Rect, Side } from './slots';

/** A slot's place inside its node, as the panel worked it out. */
export interface SlotEnd {
  rect: Rect;
  sides: readonly Side[];
}

interface InternalLike {
  measured: { width?: number | undefined; height?: number | undefined };
  width?: number | undefined;
  height?: number | undefined;
  internals: { positionAbsolute: { x: number; y: number } };
}

function boxOf(node: InternalLike): Rect | undefined {
  const width = node.measured.width ?? node.width;
  const height = node.measured.height ?? node.height;
  if (width === undefined || height === undefined) return undefined;
  return { ...node.internals.positionAbsolute, width, height };
}

export function slotRoute(
  from: { box: InternalLike; slot: SlotEnd | undefined },
  to: { box: InternalLike; slot: SlotEnd | undefined },
  same: boolean,
  reference = false,
  avoid: readonly InternalLike[] = [],
): { path: string; head: Point[]; dot: Point | undefined; middle: Point } | undefined {
  const a = boxOf(from.box);
  const b = boxOf(to.box);
  if (a === undefined || b === undefined) return undefined;
  const place = (box: Rect, slot: SlotEnd | undefined) =>
    slot === undefined
      ? { box }
      : {
          box,
          slot: { ...slot.rect, x: slot.rect.x + box.x, y: slot.rect.y + box.y },
          sides: slot.sides,
        };
  const found = route(
    place(a, from.slot),
    place(b, to.slot),
    same,
    reference,
    avoid.flatMap((node) => boxOf(node) ?? []),
  );
  return { path: found.d, head: found.head, dot: found.dot, middle: found.middle };
}
