/**
 * Groups: nodes that name a `parent` are drawn inside it, and a node with children is a container.
 * Everything here is pure: the parent links, the layout of a nested diagram (ELK in one run over
 * every level, or a fast bottom-up layering), pinned positions, and what is derived from the
 * links (which boundaries an edge crosses, which groups stay lit).
 *
 * Positions are relative to the parent, as React Flow wants them. A group's size is worked out
 * from what it holds, and a node that may move between parents (`parents`) keeps a reserved
 * position in every parent it can sit in, so that nothing else shifts when it moves. Those
 * reserved positions are returned under the key `<node id>:<parent id>`; a colon cannot occur in
 * an author's id.
 */
import type { ElkNode } from 'elkjs/lib/elk-api';
import type { Direction, LayoutEdge, LayoutNode, Positions } from './layout';

/** Room inside a group for its label above, and a margin around what it holds. */
export const GROUP_PAD = { top: 38, side: 14, bottom: 14 } as const;

export interface Placed {
  id: string;
  /** The parent the node starts in. */
  parent?: string | undefined;
  /** Every parent the node may ever sit in. */
  parents?: readonly string[] | undefined;
}

/** The parent a node starts in: the one it names, else the first it may sit in. */
export const homeOf = (node: Placed): string | undefined => node.parent ?? node.parents?.[0];

export function hasGroups(nodes: readonly Placed[]): boolean {
  return nodes.some((node) => node.parent !== undefined || node.parents !== undefined);
}

/** The key of the position reserved for a node in one of the parents it may move to. */
export const reservedKey = (id: string, parent: string) => `${id}:${parent}`;

/**
 * The parent of each node that has one, in effect: `at` overrides where a node is now. Names that
 * are not nodes, a node that is its own parent and loops are dropped (lint rejects all three; a
 * page must still draw something).
 */
export function parentMap(
  nodes: readonly Placed[],
  at?: ReadonlyMap<string, string>,
): Map<string, string> {
  const ids = new Set(nodes.map((node) => node.id));
  const links = new Map<string, string>();
  for (const node of nodes) {
    const parent = at?.get(node.id) ?? homeOf(node);
    if (parent !== undefined && parent !== node.id && ids.has(parent)) links.set(node.id, parent);
  }
  for (const id of [...links.keys()]) {
    const seen = new Set([id]);
    for (let next = links.get(id); next !== undefined; next = links.get(next)) {
      if (seen.has(next)) {
        links.delete(id);
        break;
      }
      seen.add(next);
    }
  }
  return links;
}

/** The parents of a node, nearest first. */
export function ancestorsOf(id: string, parent: ReadonlyMap<string, string>): string[] {
  const chain: string[] = [];
  for (let next = parent.get(id); next !== undefined; next = parent.get(next)) chain.push(next);
  return chain;
}

/** Items with every parent before its children, otherwise in their own order. */
export function parentFirst<T extends { id: string }>(
  items: readonly T[],
  parent: ReadonlyMap<string, string>,
): T[] {
  const depth = new Map(items.map((item) => [item.id, ancestorsOf(item.id, parent).length]));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => depth.get(a.item.id)! - depth.get(b.item.id)! || a.index - b.index)
    .map(({ item }) => item);
}

/** The ids drawn as containers: every node that holds a child now, or may hold one after a move. */
export function containerIds(nodes: readonly Placed[]): Set<string> {
  const ids = new Set(nodes.map((node) => node.id));
  const containers = new Set<string>();
  for (const node of nodes) {
    for (const parent of [node.parent, ...(node.parents ?? [])]) {
      if (parent !== undefined && parent !== node.id && ids.has(parent)) containers.add(parent);
    }
  }
  return containers;
}

/**
 * The boundary groups each edge crosses, outermost last on the way out and first on the way in:
 * the boundaries that hold one end and not the other. Derived from where the ends sit now, so a
 * node that moves changes what its edges cross. An edge that ends at a boundary group itself
 * (not at something inside it) does not cross it: it reaches the zone as a whole.
 */
export function crossingsOf(
  boundaries: ReadonlySet<string>,
  edges: readonly { id: string; source: string; target: string }[],
  parent: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (boundaries.size === 0) return result;
  for (const edge of edges) {
    const from = ancestorsOf(edge.source, parent);
    const to = ancestorsOf(edge.target, parent);
    const toSet = new Set(to);
    const fromSet = new Set(from);
    const crossed = [
      ...from.filter((id) => !toSet.has(id)),
      ...to.filter((id) => !fromSet.has(id)).reverse(),
    ].filter((id) => boundaries.has(id));
    if (crossed.length > 0) result.set(edge.id, crossed);
  }
  return result;
}

/**
 * The groups that must not fade because the call touches something in them: a node inside, or an
 * edge with an end inside (or at the group itself).
 */
export function litGroups(
  groups: ReadonlySet<string>,
  parent: ReadonlyMap<string, string>,
  touchedNodes: Iterable<string>,
  touchedEdges: Iterable<{ source: string; target: string }>,
): Set<string> {
  const lit = new Set<string>();
  for (const id of touchedNodes) for (const group of ancestorsOf(id, parent)) lit.add(group);
  for (const edge of touchedEdges) {
    for (const end of [edge.source, edge.target]) {
      if (groups.has(end)) lit.add(end);
      for (const group of ancestorsOf(end, parent)) lit.add(group);
    }
  }
  return lit;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the segment from `a` to `b` meets the border of a rectangle, if it does. */
export function crossingPoint(
  rect: Rect,
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const hits: number[] = [];
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
    if (other >= low && other <= high) hits.push(t);
  }
  if (hits.length === 0) return undefined;
  const t = hits[0]!;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

interface Item {
  id: string;
  width: number;
  height: number;
  x?: number | undefined;
  y?: number | undefined;
  /** A reserved position, not a node. */
  reserved: boolean;
}

const TOP = '';

interface Tree {
  kids: Map<string, Item[]>;
  parent: Map<string, string>;
  /** The edges that can be laid out: between known nodes, and not between a group and its own contents. */
  edges: LayoutEdge[];
}

function buildTree(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): Tree {
  const parent = parentMap(nodes);
  const ids = new Set(nodes.map((node) => node.id));
  const kids = new Map<string, Item[]>();
  const add = (container: string, item: Item) => {
    const list = kids.get(container);
    if (list === undefined) kids.set(container, [item]);
    else list.push(item);
  };
  for (const node of nodes) {
    add(parent.get(node.id) ?? TOP, {
      id: node.id,
      width: node.width,
      height: node.height,
      x: node.x,
      y: node.y,
      reserved: false,
    });
  }
  for (const node of nodes) {
    const home = parent.get(node.id);
    for (const other of node.parents ?? []) {
      // Only a known node other than the one it starts in can hold a reserved position.
      if (other === home || other === node.id || !ids.has(other)) continue;
      add(other, {
        id: reservedKey(node.id, other),
        width: node.width,
        height: node.height,
        x: node.x,
        y: node.y,
        reserved: true,
      });
    }
  }
  const usable = edges.filter((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return false;
    if (edge.source === edge.target) return true;
    return (
      !ancestorsOf(edge.source, parent).includes(edge.target) &&
      !ancestorsOf(edge.target, parent).includes(edge.source)
    );
  });
  return { kids, parent, edges: usable };
}

/** The size of a group that holds the given placed items, never smaller than `minimum`. */
function around(
  placed: readonly { x: number; y: number; width: number; height: number }[],
  minimum: { width: number; height: number },
): { width: number; height: number } {
  let right = 0;
  let bottom = 0;
  for (const item of placed) {
    right = Math.max(right, item.x + item.width);
    bottom = Math.max(bottom, item.y + item.height);
  }
  return {
    width: Math.max(minimum.width, right + GROUP_PAD.side),
    height: Math.max(minimum.height, bottom + GROUP_PAD.bottom),
  };
}

/**
 * Positions when every node is pinned. A pinned `x` and `y` are relative to the parent. A group's
 * size comes from what it holds. A node with `parents` sits at the same place in each of them.
 * Undefined when anything is not pinned.
 */
export function pinnedGroups(nodes: readonly LayoutNode[]): Positions | undefined {
  const tree = buildTree(nodes, []);
  const positions: Positions = {};
  for (const items of tree.kids.values()) {
    for (const item of items) {
      if (item.x === undefined || item.y === undefined) return undefined;
      positions[item.id] = { x: item.x, y: item.y };
    }
  }
  const size = (group: Item): { width: number; height: number } => {
    const placed = tree.kids.get(group.id)!.map((item) => ({
      x: item.x!,
      y: item.y!,
      ...(tree.kids.has(item.id) ? size(item) : item),
    }));
    const result = around(placed, group);
    positions[group.id] = { ...positions[group.id]!, ...result };
    return result;
  };
  for (const item of tree.kids.get(TOP) ?? []) if (tree.kids.has(item.id)) size(item);
  return positions;
}

export type FlatLayout = (
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
) => Positions;

/**
 * The fast layout for groups: each group's contents are laid out on their own with the flat
 * layering, the group is sized around them, and then the group is placed as one box among its
 * siblings. An edge between two things in different groups joins the siblings that hold them.
 */
export function layeredGroups(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
  flat: FlatLayout,
): Positions {
  const tree = buildTree(nodes, edges);
  const positions: Positions = {};
  const sizes = new Map<string, { width: number; height: number }>();
  const holder = (id: string, container: string): string | undefined => {
    for (let at: string | undefined = id; at !== undefined; at = tree.parent.get(at)) {
      if ((tree.parent.get(at) ?? TOP) === container) return at;
    }
    return undefined;
  };
  const place = (container: string, minimum: { width: number; height: number }) => {
    const items = (tree.kids.get(container) ?? []).map((item) => {
      if (!tree.kids.has(item.id)) return item;
      const inner = place(item.id, item);
      return { ...item, ...inner };
    });
    const links: LayoutEdge[] = [];
    for (const edge of tree.edges) {
      const from = holder(edge.source, container);
      const to = holder(edge.target, container);
      if (from !== undefined && to !== undefined && from !== to) {
        links.push({ id: edge.id, source: from, target: to });
      }
    }
    const at = flat(
      items.map(({ id, width, height }) => ({ id, width, height })),
      links,
      direction,
    );
    const inside = container === TOP ? { x: 0, y: 0 } : { x: GROUP_PAD.side, y: GROUP_PAD.top };
    const placed = items.map((item) => ({
      id: item.id,
      x: at[item.id]!.x + inside.x,
      y: at[item.id]!.y + inside.y,
      width: item.width,
      height: item.height,
    }));
    for (const item of placed) {
      positions[item.id] = { x: item.x, y: item.y, ...sizes.get(item.id) };
    }
    const size = around(placed, minimum);
    sizes.set(container, size);
    return size;
  };
  place(TOP, { width: 0, height: 0 });
  return positions;
}

/**
 * ELK over every level in one run (`INCLUDE_CHILDREN`), so that edges between groups are routed
 * with the whole hierarchy in view.
 */
export async function layoutGroups(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
): Promise<Positions> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const tree = buildTree(nodes, edges);
  const toElk = (item: Item): ElkNode => {
    const held = tree.kids.get(item.id);
    if (held === undefined) return { id: item.id, width: item.width, height: item.height };
    return {
      id: item.id,
      layoutOptions: {
        'elk.padding': `[top=${GROUP_PAD.top},left=${GROUP_PAD.side},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.side}]`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${item.width},${item.height})`,
      },
      children: held.map(toElk),
    };
  };
  const graph = await new ELK().layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '28',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: (tree.kids.get(TOP) ?? []).map(toElk),
    edges: tree.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });
  const positions: Positions = {};
  const walk = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
      if (child.children !== undefined) {
        positions[child.id] = {
          ...positions[child.id]!,
          width: child.width ?? 0,
          height: child.height ?? 0,
        };
        walk(child);
      }
    }
  };
  walk(graph);
  return positions;
}

export interface GroupLayoutOptions {
  /** More edges than ELK handles in time: use the fast layering. */
  dense: boolean;
  flat: FlatLayout;
}

/** A layout for nodes that have parents. Falls back to the fast layering if ELK fails. */
export async function layoutWithGroups(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
  options: GroupLayoutOptions,
): Promise<Positions> {
  if (options.dense) return layeredGroups(nodes, edges, direction, options.flat);
  try {
    return await layoutGroups(nodes, edges, direction);
  } catch {
    return layeredGroups(nodes, edges, direction, options.flat);
  }
}

/**
 * The least size of a group, from its header: an icon, the label, a second line beside it and,
 * for a boundary, its tag. Never narrower than the label needs, never shorter than the label row.
 */
export function groupMinSize(
  label: string,
  sub: string | undefined,
  options: { boundary?: boolean | undefined },
  icon: unknown,
): { width: number; height: number } {
  const text = label.length + (sub === undefined ? 0 : sub.length + 1);
  const width =
    GROUP_PAD.side * 2 + text * 7 + (icon === undefined ? 0 : 24) + (options.boundary ? 76 : 0);
  return { width: Math.round(Math.max(width, 120)), height: GROUP_PAD.top + GROUP_PAD.bottom + 24 };
}
