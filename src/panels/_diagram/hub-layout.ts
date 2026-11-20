/**
 * The hub layout (`layout: "hub"`): one node in the middle, and trees that fan out from it to the
 * left and to the right, level after level, with smooth curves from a parent to its children.
 *
 * It reuses the tidy-tree pass of tree-layout.ts: the hub and the subtrees on one side are laid out as
 * a tree growing to the right; the other side is the same pass mirrored. Which tree edges there are
 * is decided as for the tree layout (the first edge that points at a node makes its source the
 * parent). The hub is the root with the most descendants. Each child of the hub goes to the side its
 * `side` names; those without one go to the side that holds fewer nodes so far, in declared order.
 *
 * A node may be a disc with its label beneath (`disc` is the diameter; the node's own box then holds
 * both). A curve starts and ends on the disc, not on the box.
 */
import type { LayoutEdge, LayoutNode, Positions } from './layout';
import type { Point, Route } from './route';
import { treeLayout, treeParents } from './tree-layout';

export const HUB_GAPS = { level: 96, sibling: 22, forest: 90 } as const;

export interface HubNode extends LayoutNode {
  /** Which side of the hub a child of the hub goes to. */
  side?: 'left' | 'right' | undefined;
  /** The diameter of the disc the node is drawn as, when it is a circle. */
  disc?: number | undefined;
}

interface Anchor {
  cx: number;
  cy: number;
  /** Half the width of the thing a line meets: the disc's radius, or half the box. */
  rx: number;
  ry: number;
}

function anchorOf(node: HubNode, at: { x: number; y: number }): Anchor {
  if (node.disc !== undefined) {
    const r = node.disc / 2;
    return { cx: at.x + node.width / 2, cy: at.y + r, rx: r, ry: r };
  }
  return {
    cx: at.x + node.width / 2,
    cy: at.y + node.height / 2,
    rx: node.width / 2,
    ry: node.height / 2,
  };
}

/** A smooth S from one anchor to another: out of the facing sides along the dominant axis. */
export function curveBetween(a: Anchor, b: Anchor): Point[] {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  if (Math.abs(dx) >= Math.abs(dy) * 0.6) {
    const sign = dx >= 0 ? 1 : -1;
    const start = { x: a.cx + sign * a.rx, y: a.cy };
    const end = { x: b.cx - sign * b.rx, y: b.cy };
    const pull = Math.abs(end.x - start.x) * 0.5;
    return [
      start,
      { x: start.x + sign * pull, y: start.y },
      { x: end.x - sign * pull, y: end.y },
      end,
    ];
  }
  const sign = dy >= 0 ? 1 : -1;
  const start = { x: a.cx, y: a.cy + sign * a.ry };
  const end = { x: b.cx, y: b.cy - sign * b.ry };
  const pull = Math.abs(end.y - start.y) * 0.5;
  return [
    start,
    { x: start.x, y: start.y + sign * pull },
    { x: end.x, y: end.y - sign * pull },
    end,
  ];
}

const cubicAt = (p: Point[], t: number): Point => {
  const u = 1 - t;
  const [p0, p1, p2, p3] = p as [Point, Point, Point, Point];
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
};

export function hubLayout(
  nodes: readonly HubNode[],
  edges: readonly (LayoutEdge & { label?: string | undefined })[],
  labelOf: (text: string) => { width: number; height: number },
): { positions: Positions; routes: Record<string, Route> } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const parents = treeParents(nodes, edges);
  const kids = new Map<string, string[]>();
  for (const node of nodes) {
    const edge = parents.get(node.id);
    if (edge === undefined) continue;
    kids.set(edge.source, [...(kids.get(edge.source) ?? []), node.id]);
  }
  const size = new Map<string, number>();
  const count = (id: string): number => {
    const known = size.get(id);
    if (known !== undefined) return known;
    const total = 1 + (kids.get(id) ?? []).reduce((sum, kid) => sum + count(kid), 0);
    size.set(id, total);
    return total;
  };
  const roots = nodes.filter((node) => !parents.has(node.id));
  // The hub: the root with the most descendants, the earliest declared on a tie.
  const hub = [...roots].sort(
    (a, b) => count(b.id) - count(a.id) || order.get(a.id)! - order.get(b.id)!,
  )[0];
  const positions: Positions = {};
  const routes: Record<string, Route> = {};
  if (hub === undefined) return { positions, routes };

  const sideOf = new Map<string, 'left' | 'right'>();
  let leftCount = 0;
  let rightCount = 0;
  const hubKids = kids.get(hub.id) ?? [];
  for (const id of hubKids) {
    const side = (byId.get(id) as HubNode).side;
    if (side === undefined) continue;
    sideOf.set(id, side);
    if (side === 'left') leftCount += count(id);
    else rightCount += count(id);
  }
  for (const id of hubKids) {
    if (sideOf.has(id)) continue;
    const side = rightCount <= leftCount ? 'right' : 'left';
    sideOf.set(id, side);
    if (side === 'left') leftCount += count(id);
    else rightCount += count(id);
  }
  const below = (id: string, into: Set<string>) => {
    into.add(id);
    for (const kid of kids.get(id) ?? []) below(kid, into);
  };
  const members = { left: new Set<string>([hub.id]), right: new Set<string>([hub.id]) };
  for (const [id, side] of sideOf) below(id, members[side]);

  // Each side as a tree growing to the right of the hub, then the left one mirrored.
  const hubCx = hub.width / 2;
  const placed = new Map<string, { x: number; y: number }>();
  for (const side of ['right', 'left'] as const) {
    const set = members[side];
    const subset = nodes.filter((node) => set.has(node.id));
    if (subset.length === 1 && side === 'left' && members.right.size > 1) continue;
    const sub = treeLayout(
      subset,
      edges.filter((edge) => set.has(edge.source) && set.has(edge.target)),
      'RIGHT',
      { levelGap: HUB_GAPS.level, siblingGap: HUB_GAPS.sibling, forestGap: HUB_GAPS.forest },
    );
    const hubAt = sub[hub.id]!;
    const shiftY = -(hubAt.y + hub.height / 2);
    for (const node of subset) {
      const at = sub[node.id]!;
      const cy = at.y + shiftY;
      if (side === 'right') {
        placed.set(node.id, { x: at.x, y: cy });
      } else if (node.id !== hub.id) {
        // Mirror about the hub's centre line.
        const relative = at.x + node.width / 2 - (hubAt.x + hubCx);
        placed.set(node.id, { x: hubAt.x + hubCx - relative - node.width / 2, y: cy });
      }
    }
  }

  // Other trees (roots that are not the hub) go in a row beneath, left to right.
  let floor = -Infinity;
  for (const [id, at] of placed) floor = Math.max(floor, at.y + byId.get(id)!.height);
  let along = 0;
  for (const root of roots) {
    if (root.id === hub.id) continue;
    const set = new Set<string>();
    below(root.id, set);
    const subset = nodes.filter((node) => set.has(node.id));
    const sub = treeLayout(
      subset,
      edges.filter((edge) => set.has(edge.source) && set.has(edge.target)),
      'RIGHT',
      { levelGap: HUB_GAPS.level, siblingGap: HUB_GAPS.sibling, forestGap: HUB_GAPS.forest },
    );
    let low = Infinity;
    let right = -Infinity;
    for (const node of subset) {
      low = Math.min(low, sub[node.id]!.y);
      right = Math.max(right, sub[node.id]!.x + node.width);
    }
    for (const node of subset) {
      placed.set(node.id, {
        x: along + sub[node.id]!.x,
        y: (Number.isFinite(floor) ? floor + HUB_GAPS.forest : 0) + sub[node.id]!.y - low,
      });
    }
    along += right + HUB_GAPS.forest;
  }

  let minX = Infinity;
  let minY = Infinity;
  for (const at of placed.values()) {
    minX = Math.min(minX, at.x);
    minY = Math.min(minY, at.y);
  }
  placed.set(hub.id, placed.get(hub.id) ?? { x: 0, y: -hub.height / 2 });
  for (const [id, at] of placed) positions[id] = { x: at.x - minX, y: at.y - minY };

  for (const edge of edges) {
    const from = byId.get(edge.source) as HubNode | undefined;
    const to = byId.get(edge.target) as HubNode | undefined;
    const a = positions[edge.source];
    const b = positions[edge.target];
    if (from === undefined || to === undefined || a === undefined || b === undefined) continue;
    if (edge.source === edge.target) continue;
    const points = curveBetween(anchorOf(from, a), anchorOf(to, b));
    const text = edge.label;
    const route: Route = { points, style: 'bezier' };
    if (text !== undefined && text !== '') {
      const box = labelOf(text);
      const m = cubicAt(points, 0.5);
      route.label = { x: m.x - box.width / 2, y: m.y - box.height / 2, ...box };
    }
    routes[edge.id] = route;
  }
  return { positions, routes };
}
