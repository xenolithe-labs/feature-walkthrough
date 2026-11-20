/**
 * Where an arrow between records runs. One end may be a slot, which the arrow leaves from (or
 * arrives at) on a side of the slot that lies on the node's border; the other end may be a whole
 * node, which it meets on any of its four sides. Of every pairing of sides, the route is the one
 * with the shortest curve that does not cut through either node: a forward link goes straight
 * across, a pointer that goes back dips under the row and returns to the front.
 */
import { NORMALS, sidePoint, type Rect, type Side } from './slots';

export interface Point {
  x: number;
  y: number;
}

export interface End {
  /** The node's box in diagram coordinates. */
  box: Rect;
  /** The slot, in diagram coordinates, when the end is a slot. */
  slot?: Rect | undefined;
  /** For a slot: the sides that lie on the node's border. */
  sides?: readonly Side[] | undefined;
}

export interface Route {
  /** The path of the line, ending where the arrowhead starts. */
  d: string;
  /** The arrowhead: three points. */
  head: [Point, Point, Point];
  /** Where a label goes. */
  middle: Point;
  /** The dot drawn in the slot an arrow leaves from. */
  dot: Point | undefined;
  /** How far the curve strays, for tests. */
  length: number;
  start: Side;
  end: Side;
}

const ALL: readonly Side[] = ['right', 'left', 'bottom', 'top'];
const HEAD = 10;
/** Entering on the front or the top is natural; the back is not. Lower is better. */
/** The structure's own pointers dip underneath, which leaves the top for references. */
const END_BIAS: Record<Side, number> = { left: 0, bottom: 2, top: 12, right: 80 };
/** A reference (a variable pointing into a structure) arrives from above or below, not along the links. */
const REFERENCE_END_BIAS: Record<Side, number> = { top: 0, bottom: 4, left: 40, right: 80 };
const START_BIAS: Record<Side, number> = { right: 0, bottom: 0, top: 6, left: 6 };

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

const inside = (box: Rect, point: Point, shrink: number) =>
  point.x > box.x + shrink &&
  point.x < box.x + box.width - shrink &&
  point.y > box.y + shrink &&
  point.y < box.y + box.height - shrink;

function candidates(end: End): { side: Side; at: Point }[] {
  const rect = end.slot ?? end.box;
  const sides = end.slot === undefined ? ALL : (end.sides ?? ALL);
  return sides.map((side) => ({ side, at: sidePoint(rect, side) }));
}

interface Choice {
  from: { side: Side; at: Point };
  to: { side: Side; at: Point };
  reach: number;
  cost: number;
}

function curve(from: Point, fromSide: Side, to: Point, toSide: Side, reach: number) {
  const a = NORMALS[fromSide];
  const b = NORMALS[toSide];
  const base = { x: to.x + b.x * HEAD, y: to.y + b.y * HEAD };
  return {
    base,
    p1: { x: from.x + a.x * reach, y: from.y + a.y * reach },
    p2: { x: base.x + b.x * reach, y: base.y + b.y * reach },
  };
}

/** The route from one end to the other. Never returns an empty path: ends that coincide get a loop. */
export function route(
  from: End,
  to: End,
  same: boolean,
  reference = false,
  /** Boxes of other nodes that are shown: a route that runs through one is worse. */
  avoid: readonly Rect[] = [],
): Route {
  const endBias = reference ? REFERENCE_END_BIAS : END_BIAS;
  let best: Choice | undefined;
  for (const a of candidates(from)) {
    for (const b of candidates(to)) {
      const gap = Math.hypot(b.at.x - a.at.x, b.at.y - a.at.y);
      const reach = Math.min(Math.max(gap * 0.4, 18), same ? 36 : 64);
      const { base, p1, p2 } = curve(a.at, a.side, b.at, b.side, reach);
      let length = 0;
      let hits = 0;
      let before = a.at;
      for (let step = 1; step <= 32; step += 1) {
        const point = bezier(a.at, p1, p2, base, step / 32);
        length += Math.hypot(point.x - before.x, point.y - before.y);
        before = point;
        if (step < 32 && [from.box, to.box, ...avoid].some((box) => inside(box, point, 1)))
          hits += 1;
      }
      const cost = length + hits * 300 + START_BIAS[a.side] + endBias[b.side];
      if (best === undefined || cost < best.cost - 1e-6) best = { from: a, to: b, reach, cost };
    }
  }
  const choice = best!;
  const { base, p1, p2 } = curve(
    choice.from.at,
    choice.from.side,
    choice.to.at,
    choice.to.side,
    choice.reach,
  );
  const n = NORMALS[choice.to.side];
  const tip = choice.to.at;
  const head: [Point, Point, Point] = [
    tip,
    { x: base.x - n.y * 4.5, y: base.y + n.x * 4.5 },
    { x: base.x + n.y * 4.5, y: base.y - n.x * 4.5 },
  ];
  const slotCentre =
    from.slot === undefined
      ? undefined
      : { x: from.slot.x + from.slot.width / 2, y: from.slot.y + from.slot.height / 2 };
  const first = choice.from.at;
  const d =
    (slotCentre === undefined
      ? `M${first.x},${first.y}`
      : `M${slotCentre.x},${slotCentre.y} L${first.x},${first.y}`) +
    ` C${p1.x},${p1.y} ${p2.x},${p2.y} ${base.x},${base.y}`;
  return {
    d,
    head,
    middle: bezier(first, p1, p2, base, 0.5),
    dot: slotCentre,
    length: choice.cost,
    start: choice.from.side,
    end: choice.to.side,
  };
}
