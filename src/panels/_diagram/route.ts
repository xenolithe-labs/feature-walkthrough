/**
 * Routed edges: what a layout returns for an edge, how it becomes an SVG path, and the plain
 * geometry (flattening, rectangle hits, crossings) that gates, the traffic dot, the tests and the
 * layout lint all share. Pure: no React and no browser.
 *
 * All coordinates are absolute (flow space): a layout resolves the coordinate system of a group
 * before it hands a route out, so a route never needs to know which container it was found in.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How the points are joined:
 * `orthogonal` straight segments with rounded corners; `polyline` the same with small corners;
 * `curved` a smooth curve through every point; `bezier` exactly four points, one cubic curve;
 * `straight` the first and last point only.
 */
export type RouteStyle = 'orthogonal' | 'polyline' | 'curved' | 'bezier' | 'straight';

export interface Route {
  /** From the source's border to the target's border. At least two points. */
  points: Point[];
  style: RouteStyle;
  /** Where the layout put the label (top left, size), if the edge has one. */
  label?: Rect | undefined;
}

/** The arrowhead of an edge: its tip, and the unit vector the edge arrives along. */
export interface Head {
  tip: Point;
  ux: number;
  uy: number;
}

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Consecutive duplicate points removed, so every segment has a direction. */
export function tidy(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) if (out.length === 0 || !same(out.at(-1)!, point)) out.push(point);
  return out;
}

/** The unit direction of a segment, or zero for an empty one. */
export function direction(a: Point, b: Point): { ux: number; uy: number } {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length < 1e-9 ? { ux: 0, uy: 0 } : { ux: (b.x - a.x) / length, uy: (b.y - a.y) / length };
}

/**
 * The route with its last `by` pixels cut off, so the line stops where the arrowhead begins; and the
 * head, which sits at the original end. A route shorter than the cut is left whole.
 */
export function withHead(
  points: readonly Point[],
  by: number,
): { line: Point[]; head: Head } | undefined {
  const pts = tidy(points);
  if (pts.length < 2) return undefined;
  const end = pts.at(-1)!;
  // Walk back from the end to find the direction the line arrives along.
  let before = pts.at(-2)!;
  const { ux, uy } = direction(before, end);
  const line = pts.slice();
  const last = Math.hypot(end.x - before.x, end.y - before.y);
  if (last > by + 1) {
    before = { x: end.x - ux * by, y: end.y - uy * by };
    line[line.length - 1] = before;
  }
  return { line, head: { tip: end, ux, uy } };
}

/** The three corners of an arrowhead. `grow` makes it bigger for a heavy edge. */
export function headPoints(head: Head, grow = 0): string {
  const length = 10 + grow * 2;
  const half = 4.5 + grow;
  const base = { x: head.tip.x - head.ux * length, y: head.tip.y - head.uy * length };
  return [
    `${head.tip.x},${head.tip.y}`,
    `${base.x - head.uy * half},${base.y + head.ux * half}`,
    `${base.x + head.uy * half},${base.y - head.ux * half}`,
  ].join(' ');
}

const fixed = (n: number) => Math.round(n * 100) / 100;

/** SVG path data for points joined in a style. */
export function pathOf(points: readonly Point[], style: RouteStyle, radius = 9): string {
  const pts = tidy(points);
  if (pts.length === 0) return '';
  const first = pts[0]!;
  let d = `M${fixed(first.x)},${fixed(first.y)}`;
  if (pts.length === 1) return d;
  if (style === 'straight' || pts.length === 2) {
    const end = pts.at(-1)!;
    return `${d} L${fixed(end.x)},${fixed(end.y)}`;
  }
  if (style === 'bezier' && pts.length === 4) {
    const [, c1, c2, end] = pts as [Point, Point, Point, Point];
    return `${d} C${fixed(c1.x)},${fixed(c1.y)} ${fixed(c2.x)},${fixed(c2.y)} ${fixed(end.x)},${fixed(end.y)}`;
  }
  if (style === 'curved') {
    for (let i = 0; i < pts.length - 1; i += 1) {
      const p0 = pts[Math.max(0, i - 1)]!;
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      d += ` C${fixed(c1.x)},${fixed(c1.y)} ${fixed(c2.x)},${fixed(c2.y)} ${fixed(p2.x)},${fixed(p2.y)}`;
    }
    return d;
  }
  const r = style === 'polyline' ? Math.min(radius, 4) : radius;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const a = pts[i - 1]!;
    const corner = pts[i]!;
    const b = pts[i + 1]!;
    const back = Math.min(r, Math.hypot(corner.x - a.x, corner.y - a.y) / 2);
    const forward = Math.min(r, Math.hypot(b.x - corner.x, b.y - corner.y) / 2);
    const din = direction(a, corner);
    const dout = direction(corner, b);
    const start = { x: corner.x - din.ux * back, y: corner.y - din.uy * back };
    const stop = { x: corner.x + dout.ux * forward, y: corner.y + dout.uy * forward };
    d += ` L${fixed(start.x)},${fixed(start.y)} Q${fixed(corner.x)},${fixed(corner.y)} ${fixed(stop.x)},${fixed(stop.y)}`;
  }
  const end = pts.at(-1)!;
  return `${d} L${fixed(end.x)},${fixed(end.y)}`;
}

/** The route as a polyline dense enough to test against: curves are sampled. */
export function flatten(points: readonly Point[], style: RouteStyle): Point[] {
  const pts = tidy(points);
  if (style === 'bezier' && pts.length === 4) {
    const [p0, p1, p2, p3] = pts as [Point, Point, Point, Point];
    return Array.from({ length: 17 }, (_, i) => cubic(p0, p1, p2, p3, i / 16));
  }
  if (style === 'curved' && pts.length > 2) {
    const out: Point[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const p0 = pts[Math.max(0, i - 1)]!;
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      for (let k = 1; k <= 8; k += 1) out.push(cubic(p1, c1, c2, p2, k / 8));
    }
    return out;
  }
  if (style === 'straight') return [pts[0]!, pts.at(-1)!];
  return pts;
}

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Whether the segment a-b passes through the inside of a rectangle (touching the border does not count). */
export function segmentHitsRect(a: Point, b: Point, rect: Rect, margin = 0): boolean {
  const left = rect.x + margin;
  const right = rect.x + rect.width - margin;
  const top = rect.y + margin;
  const bottom = rect.y + rect.height - margin;
  if (right <= left || bottom <= top) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q > 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, a.x - left) &&
    clip(dx, right - a.x) &&
    clip(-dy, a.y - top) &&
    clip(dy, bottom - a.y) &&
    t1 - t0 > 1e-9
  );
}

/** Whether a polyline passes through the inside of a rectangle. */
export function polylineHitsRect(points: readonly Point[], rect: Rect, margin = 0): boolean {
  for (let i = 0; i < points.length - 1; i += 1) {
    if (segmentHitsRect(points[i]!, points[i + 1]!, rect, margin)) return true;
  }
  return false;
}

/** Where a polyline first meets the border of a rectangle, walking from its start. */
export function firstBorderCrossing(rect: Rect, points: readonly Point[]): Point | undefined {
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const hit = borderHit(rect, a, b);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function borderHit(rect: Rect, a: Point, b: Point): Point | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let best: number | undefined;
  const sides: [number, number, boolean][] = [
    [rect.x, dx, true],
    [rect.x + rect.width, dx, true],
    [rect.y, dy, false],
    [rect.y + rect.height, dy, false],
  ];
  for (const [at, delta, vertical] of sides) {
    if (delta === 0) continue;
    const t = (at - (vertical ? a.x : a.y)) / delta;
    if (t < 0 || t > 1) continue;
    const other = vertical ? a.y + dy * t : a.x + dx * t;
    const [low, high] = vertical ? [rect.y, rect.y + rect.height] : [rect.x, rect.x + rect.width];
    if (other >= low && other <= high && (best === undefined || t < best)) best = t;
  }
  return best === undefined ? undefined : { x: a.x + dx * best, y: a.y + dy * best };
}

/** Whether two segments cross properly (not merely touch at an end, and not collinear). */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

/** How many times two polylines cross. */
export function polylineCrossings(p: readonly Point[], q: readonly Point[]): number {
  let count = 0;
  for (let i = 0; i < p.length - 1; i += 1) {
    for (let j = 0; j < q.length - 1; j += 1) {
      if (segmentsCross(p[i]!, p[i + 1]!, q[j]!, q[j + 1]!)) count += 1;
    }
  }
  return count;
}

/** The point at a fraction of a polyline's length. */
export function pointAlong(points: readonly Point[], fraction: number): Point {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
  }
  let left = total * fraction;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= length || i === points.length - 2) {
      const t = length === 0 ? 0 : Math.min(1, left / length);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= length;
  }
  return points[0]!;
}

export const rectsOverlap = (a: Rect, b: Rect, margin = 0): boolean =>
  a.x + a.width > b.x + margin &&
  b.x + b.width > a.x + margin &&
  a.y + a.height > b.y + margin &&
  b.y + b.height > a.y + margin;

/** Reverses a route, so a traffic dot can run from target to source. */
export const reversed = (points: readonly Point[]): Point[] => [...points].reverse();

/** The size of an edge label's pill, from its text alone (so layout needs no browser). */
export function labelSize(text: string): { width: number; height: number } {
  return { width: Math.round(Math.min(text.length, 40) * 6.1 + 14), height: 20 };
}

/** Where the line from a box's centre towards a point leaves the box. */
export function exitPoint(box: Rect, towards: Point): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx === 0 ? Infinity : box.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : box.height / 2 / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** The straight line a diagram draws between two boxes when an edge has no route. */
export function borderLine(a: Rect, b: Rect): [Point, Point] {
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  return [exitPoint(a, cb), exitPoint(b, ca)];
}
