/**
 * A tidy tree layout for diagrams that say `layout: "tree"`.
 *
 * ELK's tree algorithm (`mrtree`) was tried on the binary search tree demo and set aside. It does
 * keep declaration order (reversing the declared nodes and edges mirrors its output, and its
 * model-order option changed nothing), and it kept 3 left of 10 and 1 left of 6. But it puts a
 * lone child directly under its parent, so a node with only a right child reads as having one
 * child with no side, and it cannot see which slot a child hangs from, so left and right come from the
 * order the pointers were first set, not from the slots. This is a
 * small contour-based pass in the style of Reingold and Tilford: each subtree is laid out on its
 * own, then slid next to its left sibling until their contours just clear, then the parent is
 * centred over its children. A subtree therefore has the same shape wherever it sits, so
 * declaring one more node moves only the subtrees that must make room for it.
 *
 * Which edges are tree edges: the first edge, in declaration order, that points at a node makes
 * its source the parent; an edge that would close a cycle, or that points at a node that already
 * has a parent, is not a tree edge and has no say here (it is still drawn). Children are ordered
 * by the slot of the parent they hang from, then by the order the nodes were declared. A node
 * whose children hang from slots that other nodes also use (`left` and `right`) leaves a gap
 * for each child it lacks, so a lone right child stays on the right.
 */
import type { Direction, LayoutEdge, LayoutNode, Positions } from './layout';

/** Room kept for a child a node could have but does not. */
const PHANTOM = 24;
const SIBLING_GAP = 28;
const LEVEL_GAP = 40;
/** Room between separate trees, so arrows between them have somewhere to run. */
const FOREST_GAP = 100;

interface Item {
  /** Undefined for the gap left for a missing child. */
  id: string | undefined;
  breadth: number;
  thickness: number;
  children: Item[];
}

interface Sub {
  /** Per depth, the least and greatest breadth reached, relative to this subtree's root. */
  left: number[];
  right: number[];
  /** Breadth of each node's centre relative to this subtree's root. */
  at: Map<string, number>;
  /** Per depth, the thickness of the thickest node. */
  thick: number[];
}

/** The tree edges: for each node, its parent and the edge that made it so. */
export function treeParents(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
): Map<string, LayoutEdge> {
  const known = new Set(nodes.map((node) => node.id));
  const parent = new Map<string, LayoutEdge>();
  const ancestor = (of: string, candidate: string): boolean => {
    for (let at: string | undefined = of; at !== undefined; at = parent.get(at)?.source) {
      if (at === candidate) return true;
    }
    return false;
  };
  for (const edge of edges) {
    if (edge.tree === false) continue;
    if (!known.has(edge.source) || !known.has(edge.target) || edge.source === edge.target) continue;
    if (parent.has(edge.target) || ancestor(edge.source, edge.target)) continue;
    parent.set(edge.target, edge);
  }
  return parent;
}

function place(item: Item, gap = SIBLING_GAP, sibling = SIBLING_GAP): Sub {
  const depthOne = item.children.map((child) => place(child, sibling, sibling));
  const own = { left: -item.breadth / 2, right: item.breadth / 2 };
  const thick = [item.thickness];
  const at = new Map<string, number>();
  if (depthOne.length === 0) {
    if (item.id !== undefined) at.set(item.id, 0);
    return { left: [own.left], right: [own.right], at, thick };
  }
  // Slide each child subtree right until it clears everything to its left, at every depth.
  const offsets: number[] = [];
  const rightEdge: number[] = [];
  const leftEdge: number[] = [];
  depthOne.forEach((sub, index) => {
    let shift = 0;
    if (index > 0) {
      shift = -Infinity;
      for (let d = 0; d < Math.min(rightEdge.length, sub.left.length); d += 1) {
        shift = Math.max(shift, rightEdge[d]! + gap - sub.left[d]!);
      }
    }
    offsets.push(shift);
    sub.left.forEach((value, d) => {
      leftEdge[d] = Math.min(leftEdge[d] ?? Infinity, value + shift);
    });
    sub.right.forEach((value, d) => {
      rightEdge[d] = Math.max(rightEdge[d] ?? -Infinity, value + shift);
    });
    sub.thick.forEach((value, d) => {
      thick[d + 1] = Math.max(thick[d + 1] ?? 0, value);
    });
  });
  // The parent sits over the middle of its first and last child.
  const middle = (offsets[0]! + offsets.at(-1)!) / 2;
  depthOne.forEach((sub, index) => {
    for (const [id, x] of sub.at) at.set(id, x + offsets[index]! - middle);
  });
  if (item.id !== undefined) at.set(item.id, 0);
  return {
    left: [own.left, ...leftEdge.map((value) => value - middle)],
    right: [own.right, ...rightEdge.map((value) => value - middle)],
    at,
    thick,
  };
}

export interface TreeGaps {
  /** Room between one level and the next. */
  levelGap?: number;
  /** Room between siblings. */
  siblingGap?: number;
  /** Room between separate trees. */
  forestGap?: number;
}

/** Positions (top left corners) of every node, the same whatever is present at a call. */
export function treeLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
  gaps: TreeGaps = {},
): Positions {
  const levelGap = gaps.levelGap ?? LEVEL_GAP;
  const down = direction === 'DOWN';
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parents = treeParents(nodes, edges);

  // The slot names that tree edges leave from: a node's lanes are the ones of its own slots.
  const lanes = new Set<string>();
  for (const edge of parents.values()) if (edge.slot !== undefined) lanes.add(edge.slot);

  const kids = new Map<string, { node: LayoutNode; lane: number | undefined }[]>();
  for (const node of nodes) {
    const edge = parents.get(node.id);
    if (edge === undefined) continue;
    const own = (byId.get(edge.source)!.slots ?? []).filter((slot) => lanes.has(slot));
    const lane = edge.slot === undefined ? undefined : own.indexOf(edge.slot);
    const list = kids.get(edge.source) ?? [];
    list.push({ node, lane: lane === undefined || lane < 0 ? undefined : lane });
    kids.set(edge.source, list);
  }

  const build = (node: LayoutNode): Item => {
    const children = [...(kids.get(node.id) ?? [])].sort(
      (a, b) => (a.lane ?? -1) - (b.lane ?? -1) || order.get(a.node.id)! - order.get(b.node.id)!,
    );
    const own = (node.slots ?? []).filter((slot) => lanes.has(slot));
    const items: Item[] = [];
    if (
      children.length > 0 &&
      own.length > 1 &&
      children.every((child) => child.lane !== undefined)
    ) {
      // One place per lane, so a missing child leaves a gap where it would have been.
      own.forEach((_, lane) => {
        const child = children.find((item) => item.lane === lane);
        items.push(
          child === undefined
            ? { id: undefined, breadth: PHANTOM, thickness: 0, children: [] }
            : build(child.node),
        );
      });
    } else {
      for (const child of children) items.push(build(child.node));
    }
    return {
      id: node.id,
      breadth: down ? node.width : node.height,
      thickness: down ? node.height : node.width,
      children: items,
    };
  };

  const roots = nodes.filter((node) => !parents.has(node.id)).map(build);
  const forest = place(
    { id: undefined, breadth: 0, thickness: 0, children: roots },
    gaps.forestGap ?? FOREST_GAP,
    gaps.siblingGap ?? SIBLING_GAP,
  );

  // Levels line up across the forest: every node of a depth shares one band. The virtual root
  // above the forest is depth 0, so real depths start at 1.
  const thick = forest.thick;
  const start: number[] = [];
  let along = 0;
  for (let d = 1; d < thick.length; d += 1) {
    start[d] = along;
    along += (thick[d] ?? 0) + levelGap;
  }
  const depthOf = new Map<string, number>();
  const walk = (item: Item, depth: number) => {
    if (item.id !== undefined) depthOf.set(item.id, depth);
    for (const child of item.children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 1);

  const positions: Positions = {};
  let least = Infinity;
  for (const node of nodes) {
    least = Math.min(least, forest.at.get(node.id)! - (down ? node.width : node.height) / 2);
  }
  for (const node of nodes) {
    const centre = forest.at.get(node.id)! - least;
    const band = start[depthOf.get(node.id)!]!;
    const room = thick[depthOf.get(node.id)!]!;
    const breadth = centre - (down ? node.width : node.height) / 2;
    const depth = band + (room - (down ? node.height : node.width)) / 2;
    positions[node.id] = down ? { x: breadth, y: depth } : { x: depth, y: breadth };
  }
  return positions;
}
