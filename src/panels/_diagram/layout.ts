/**
 * Positions for a diagram, computed once from the complete set of elements so
 * that nothing moves when a later call adds one. Positions pinned in the
 * config win; ELK is only loaded when something is not pinned.
 */
import { treeLayout } from './tree-layout';

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  x?: number | undefined;
  y?: number | undefined;
  /** The ids of the node's slots, in order (record nodes); the tree layout uses them. */
  slots?: readonly string[] | undefined;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  /** The slot of `source` the edge leaves from, if it leaves from one. */
  slot?: string | undefined;
  /** False for an edge the tree layout must not treat as a parent-child link. */
  tree?: boolean | undefined;
}

export type Direction = 'RIGHT' | 'DOWN';
export type LayoutMode = 'layered' | 'tree';
export type Positions = Record<string, { x: number; y: number }>;

const cache = new Map<string, Promise<Positions>>();

export function pinned(nodes: readonly LayoutNode[]): Positions | undefined {
  const positions: Positions = {};
  for (const node of nodes) {
    if (node.x === undefined || node.y === undefined) return undefined;
    positions[node.id] = { x: node.x, y: node.y };
  }
  return positions;
}

async function withElk(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
): Promise<Positions> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const ids = new Set(nodes.map((node) => node.id));
  const graph = await new ELK().layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': '28',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: nodes.map((node) => ({ id: node.id, width: node.width, height: node.height })),
    edges: edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  });
  const positions: Positions = {};
  for (const child of graph.children ?? []) {
    positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  }
  return positions;
}

/** More than 200 edges at more than three per node: measured to take ELK several seconds. */
export function isDense(nodes: number, edges: number): boolean {
  return edges > 200 && edges > nodes * 3;
}

/**
 * A simple layout that is always fast: each node goes one layer past the furthest of the nodes
 * that point at it (edges that would close a loop are ignored), and a layer keeps its nodes in
 * the order they were declared.
 */
export function layered(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
): Positions {
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const incoming = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    const from = order.get(edge.source);
    const to = order.get(edge.target);
    // Only edges that run forward in declaration order count, which rules out loops.
    if (from !== undefined && to !== undefined && from < to)
      incoming.get(edge.target)!.push(edge.source);
  }
  const layerOf = new Map<string, number>();
  const layers: LayoutNode[][] = [];
  // Wide layers are split, so that a hub with a hundred neighbours does not make one endless row.
  const widest = Math.max(4, Math.ceil(Math.sqrt(nodes.length) * 1.5));
  for (const node of nodes) {
    let layer = 0;
    for (const source of incoming.get(node.id)!) layer = Math.max(layer, layerOf.get(source)! + 1);
    while ((layers[layer]?.length ?? 0) >= widest) layer += 1;
    layerOf.set(node.id, layer);
    (layers[layer] ??= []).push(node);
  }
  const positions: Positions = {};
  let across = 0;
  for (const layer of layers) {
    if (layer === undefined) continue;
    let along = 0;
    let thickest = 0;
    for (const node of layer) {
      const [length, thickness] =
        direction === 'RIGHT' ? [node.height, node.width] : [node.width, node.height];
      positions[node.id] =
        direction === 'RIGHT' ? { x: across, y: along } : { x: along, y: across };
      along += length + 28;
      thickest = Math.max(thickest, thickness);
    }
    across += thickest + 64;
  }
  return positions;
}

/** Resolves to a position for every node. The same input gives the same promise. */
export function layout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
  mode: LayoutMode = 'layered',
): Promise<Positions> {
  const fixed = pinned(nodes);
  if (fixed !== undefined) return Promise.resolve(fixed);
  if (mode === 'tree') return Promise.resolve(treeLayout(nodes, edges, direction));
  const key = JSON.stringify([direction, nodes, edges]);
  let result = cache.get(key);
  if (result === undefined) {
    // ELK's time grows steeply with the number of edges per node, and it runs on the page's own
    // thread, so a dense graph would freeze the page. Dense graphs get a plain layering instead.
    result = isDense(nodes.length, edges.length)
      ? Promise.resolve(layered(nodes, edges, direction))
      : withElk(nodes, edges, direction);
    cache.set(key, result);
  }
  return result;
}

const CHAR = 7.8;
const MAX_WIDTH = 270;
/** Characters of a label that fit on one line of a node at the widest size. */
const LINE_CHARS = 26;
/** Most lines a label may wrap to; the rest is cut with an ellipsis. */
export const MAX_LABEL_LINES = 3;

/** How many lines a label needs at the widest node, breaking between words where it can. */
export function labelLines(label: string): number {
  let lines = 1;
  let used = 0;
  for (const word of label.split(/\s+/).filter(Boolean)) {
    // A word longer than a line is broken by the browser, taking as many lines as it needs.
    const own = Math.ceil(word.length / LINE_CHARS);
    if (used === 0) {
      lines += own - 1;
      used = word.length % LINE_CHARS || LINE_CHARS;
    } else if (used + 1 + word.length <= LINE_CHARS) {
      used += 1 + word.length;
    } else {
      lines += own;
      used = word.length % LINE_CHARS || LINE_CHARS;
    }
  }
  return Math.min(lines, MAX_LABEL_LINES);
}

/**
 * A size from the text alone, so layout does not have to wait for a render. A label too long
 * for one line at the widest size wraps, so a node says all of its text (up to three lines).
 */
export function estimateSize(label: string, sub?: string): { width: number; height: number } {
  const longest = Math.max(label.length, (sub?.length ?? 0) * 0.86);
  const lines = longest * CHAR + 36 > MAX_WIDTH ? labelLines(label) : 1;
  return {
    width: Math.round(Math.min(Math.max(longest * CHAR + 36, 112), MAX_WIDTH)),
    height: (sub === undefined ? 24 : 38) + 16 * lines,
  };
}

/** The zoom that fits a box of the given size into a view, as `fitView` would choose it. */
export function fitZoom(
  box: { width: number; height: number },
  view: { width: number; height: number },
  padding: number,
  maxZoom: number,
): number {
  if (box.width <= 0 || box.height <= 0) return maxZoom;
  const across = view.width / (box.width + padding * 2);
  const down = view.height / (box.height + padding * 2);
  return Math.min(across, down, maxZoom);
}

/** Below this zoom the text of a node is too small to read. */
export const READABLE_ZOOM = 0.6;

/**
 * What a diagram frames: everything shown, or only what the call touches. A diagram that fits
 * at a readable zoom always shows everything; one that would shrink below it follows the
 * call instead, so the reader sees the elements in question at a size they can read.
 */
export function framing(zoomAll: number, touchedCount: number): 'all' | 'touched' {
  return zoomAll < READABLE_ZOOM && touchedCount > 0 ? 'touched' : 'all';
}

export interface FitChoice {
  /** The nodes to frame; empty means every node. */
  ids: string[];
  minZoom: number;
  maxZoom: number;
}

/**
 * How to frame a diagram: every shown node, or, when that would be below a readable zoom,
 * the nodes the call touches (with their neighbours) at a zoom of at least `READABLE_ZOOM`.
 */
export function chooseFit(
  shown: readonly string[],
  focus: readonly string[],
  box: { width: number; height: number },
  view: { width: number; height: number },
  padding = 24,
): FitChoice {
  const whole: FitChoice = { ids: [...shown], minZoom: 0.2, maxZoom: 1.15 };
  if (shown.length === 0 || focus.length === 0) return whole;
  if (framing(fitZoom(box, view, padding, whole.maxZoom), focus.length) === 'all') return whole;
  return { ids: [...focus], minZoom: READABLE_ZOOM, maxZoom: 1 };
}
