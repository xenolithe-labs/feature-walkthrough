/**
 * Positions for a diagram, computed once from the complete set of elements so
 * that nothing moves when a later call adds one. Positions pinned in the
 * config win; ELK is only loaded when something is not pinned.
 */
export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  x?: number | undefined;
  y?: number | undefined;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export type Direction = 'RIGHT' | 'DOWN';
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

/** Resolves to a position for every node. The same input gives the same promise. */
export function layout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
): Promise<Positions> {
  const fixed = pinned(nodes);
  if (fixed !== undefined) return Promise.resolve(fixed);
  const key = JSON.stringify([direction, nodes, edges]);
  let result = cache.get(key);
  if (result === undefined) {
    result = withElk(nodes, edges, direction);
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
