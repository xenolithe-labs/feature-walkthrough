/**
 * A router for diagrams whose positions ELK did not choose (pinned nodes, grid cells): right-angle
 * lines that run around every node and never through one.
 *
 * The lines of a grid are drawn through the gaps between nodes. The grid is made of every
 * border, centre and a margin beside every node, and of the middle of every gap between two nodes. An edge leaves
 * and arrives through the middle of a side, at a right angle, and is found by A* over the grid with a
 * cost for bends and for sharing a stretch of line with an edge routed before it, so that
 * parallel edges spread over neighbouring lines instead of lying on top of each other.
 *
 * It is a pure function of boxes and requests, so the same input always gives the same routes.
 */
import type { Point, Rect } from './route';

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface Request {
  id: string;
  from: string;
  to: string;
  fromSide?: Side | undefined;
  toSide?: Side | undefined;
}

/** Past this many boxes the lattice is too big to search for every edge in time. */
export const MAX_ROUTED_BOXES = 70;
/** And this many edges: 200 edges between 70 boxes measured about 0.6 s. */
export const MAX_ROUTED_EDGES = 300;

const BEND = 26;
const SHARED = 18;
const HUG = 12;
const GAP = 30;

const DIRS = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: -1 },
] as const;
/** The direction an edge leaves a side in, as an index into DIRS. */
const OUT: Record<Side, number> = { right: 0, bottom: 1, left: 2, top: 3 };
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

const mid = (rect: Rect, side: Side): Point =>
  side === 'top'
    ? { x: rect.x + rect.width / 2, y: rect.y }
    : side === 'bottom'
      ? { x: rect.x + rect.width / 2, y: rect.y + rect.height }
      : side === 'left'
        ? { x: rect.x, y: rect.y + rect.height / 2 }
        : { x: rect.x + rect.width, y: rect.y + rect.height / 2 };

function lines(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    const rounded = Math.round(value * 2) / 2;
    if (out.length === 0 || rounded - out.at(-1)! > 0.25) out.push(rounded);
  }
  return out;
}

class Heap {
  private items: { f: number; at: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(f: number, at: number) {
    const items = this.items;
    items.push({ f, at });
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (items[p]!.f <= items[i]!.f) break;
      [items[p], items[i]] = [items[i]!, items[p]!];
      i = p;
    }
  }
  pop(): number {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l]!.f < items[m]!.f) m = l;
        if (r < items.length && items[r]!.f < items[m]!.f) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i]!, items[m]!];
        i = m;
      }
    }
    return top.at;
  }
}

/**
 * Routes for the requests, by id. `boxes` holds every node (absolute); `obstacles` names the ones a
 * line must go round (leaves: a group may be crossed). A request that cannot be routed is absent.
 */
export function routeOrthogonal(
  boxes: ReadonlyMap<string, Rect>,
  obstacles: readonly string[],
  requests: readonly Request[],
): Map<string, Point[]> {
  const result = new Map<string, Point[]>();
  const blockers = obstacles.map((id) => boxes.get(id)).filter((box) => box !== undefined);
  const ends = new Set(requests.flatMap((request) => [request.from, request.to]));
  const around = [...new Set([...obstacles, ...ends].filter((id) => boxes.has(id)))].map((id) =>
    boxes.get(id)!,
  );
  if (around.length === 0 || requests.length === 0) return result;

  const xValues: number[] = [];
  const yValues: number[] = [];
  const edgesX: number[] = [];
  const edgesY: number[] = [];
  for (const box of around) {
    xValues.push(
      box.x - HUG,
      box.x,
      box.x + box.width / 2,
      box.x + box.width,
      box.x + box.width + HUG,
    );
    yValues.push(
      box.y - HUG,
      box.y,
      box.y + box.height / 2,
      box.y + box.height,
      box.y + box.height + HUG,
    );
    edgesX.push(box.x, box.x + box.width);
    edgesY.push(box.y, box.y + box.height);
  }
  const gapsOf = (borders: number[], into: number[]) => {
    const sorted = lines(borders);
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      if (sorted[i + 1]! - sorted[i]! >= GAP) into.push((sorted[i]! + sorted[i + 1]!) / 2);
    }
  };
  gapsOf(edgesX, xValues);
  gapsOf(edgesY, yValues);
  const xs = lines(xValues);
  const ys = lines(yValues);
  const nx = xs.length;
  const ny = ys.length;
  const indexOf = (values: number[], value: number): number => {
    let low = 0;
    let high = values.length - 1;
    while (low < high) {
      const m = (low + high) >> 1;
      if (values[m]! < value - 0.25) low = m + 1;
      else high = m;
    }
    return low;
  };

  // vBlock[i * ny + j]: the stretch of line i between lines j and j+1 runs inside a box.
  const vBlock = new Uint8Array(nx * ny);
  const hBlock = new Uint8Array(nx * ny);
  for (const box of blockers) {
    const il = indexOf(xs, box.x);
    const ir = indexOf(xs, box.x + box.width);
    const it = indexOf(ys, box.y);
    const ib = indexOf(ys, box.y + box.height);
    for (let i = il + 1; i < ir; i += 1) for (let j = it; j < ib; j += 1) vBlock[i * ny + j] = 1;
    for (let j = it + 1; j < ib; j += 1) for (let i = il; i < ir; i += 1) hBlock[i * ny + j] = 1;
  }
  const vUsed = new Uint8Array(nx * ny);
  const hUsed = new Uint8Array(nx * ny);

  const stateCount = nx * ny * 4;
  const cost = new Float64Array(stateCount);
  const from = new Int32Array(stateCount);
  const seen = new Uint32Array(stateCount);
  let stamp = 0;

  for (const request of requests) {
    const a = boxes.get(request.from);
    const b = boxes.get(request.to);
    if (a === undefined || b === undefined || request.from === request.to) continue;
    const sourceSides = request.fromSide === undefined ? SIDES : [request.fromSide];
    const targetSides = request.toSide === undefined ? SIDES : [request.toSide];
    const targets = new Map<number, Side>();
    for (const side of targetSides) {
      const p = mid(b, side);
      // The line arrives going in, so a state at the border facing into the box ends it.
      targets.set((indexOf(xs, p.x) * ny + indexOf(ys, p.y)) * 4 + ((OUT[side] + 2) % 4), side);
    }
    const targetPoints = targetSides.map((side) => mid(b, side));
    const h = (i: number, j: number) => {
      let best = Infinity;
      for (const p of targetPoints)
        best = Math.min(best, Math.abs(xs[i]! - p.x) + Math.abs(ys[j]! - p.y));
      return best;
    };

    stamp += 1;
    const heap = new Heap();
    for (const side of sourceSides) {
      const p = mid(a, side);
      const state = (indexOf(xs, p.x) * ny + indexOf(ys, p.y)) * 4 + OUT[side];
      seen[state] = stamp;
      cost[state] = 0;
      from[state] = -1;
      heap.push(h(indexOf(xs, p.x), indexOf(ys, p.y)), state);
    }
    let found = -1;
    let guard = 0;
    while (heap.size > 0 && guard < 400000) {
      guard += 1;
      const state = heap.pop();
      const dir = state % 4;
      const vertex = (state - dir) / 4;
      const j = vertex % ny;
      const i = (vertex - j) / ny;
      if (targets.has(state)) {
        found = state;
        break;
      }
      const g = cost[state]!;
      for (let turn = 0; turn < 4; turn += 1) {
        if (turn === (dir + 2) % 4) continue;
        // A line leaves its side straight out, not along the border.
        if (from[state] === -1 && turn !== dir) continue;
        const ni = i + DIRS[turn]!.dx;
        const nj = j + DIRS[turn]!.dy;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        const segment =
          turn === 0
            ? i * ny + j
            : turn === 2
              ? ni * ny + j
              : turn === 1
                ? i * ny + j
                : i * ny + nj;
        const horizontal = turn === 0 || turn === 2;
        if ((horizontal ? hBlock : vBlock)[segment]) continue;
        const length = Math.abs(xs[ni]! - xs[i]!) + Math.abs(ys[nj]! - ys[j]!);
        const step =
          length + (turn === dir ? 0 : BEND) + ((horizontal ? hUsed : vUsed)[segment] ? SHARED : 0);
        const next = (ni * ny + nj) * 4 + turn;
        const total = g + step;
        if (seen[next] !== stamp || total < cost[next]!) {
          seen[next] = stamp;
          cost[next] = total;
          from[next] = state;
          heap.push(total + h(ni, nj), next);
        }
      }
    }
    if (found < 0) continue;
    const path: Point[] = [];
    for (let state = found; state >= 0; state = from[state]!) {
      const vertex = (state - (state % 4)) / 4;
      const j = vertex % ny;
      path.push({ x: xs[(vertex - j) / ny]!, y: ys[j]! });
      const previous = from[state]!;
      if (previous >= 0) {
        const pv = (previous - (previous % 4)) / 4;
        const pj = pv % ny;
        const pi = (pv - pj) / ny;
        const i = (vertex - j) / ny;
        const dir = state % 4;
        if (dir === 0 || dir === 2) hUsed[(dir === 0 ? pi : i) * ny + j] = 1;
        else vUsed[i * ny + (dir === 1 ? pj : j)] = 1;
      }
    }
    path.reverse();
    // Drop points in the middle of a straight run.
    const clean = path.filter((p, k) => {
      if (k === 0 || k === path.length - 1) return true;
      const q = path[k - 1]!;
      const r = path[k + 1]!;
      return !((q.x === p.x && p.x === r.x) || (q.y === p.y && p.y === r.y));
    });
    result.set(request.id, clean);
  }
  return result;
}
