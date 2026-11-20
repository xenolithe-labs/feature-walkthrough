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

/** A size from the text alone, so layout does not have to wait for a render. */
export function estimateSize(label: string, sub?: string): { width: number; height: number } {
  const longest = Math.max(label.length, (sub?.length ?? 0) * 0.86);
  return {
    width: Math.round(Math.min(Math.max(longest * CHAR + 36, 112), 270)),
    height: sub === undefined ? 40 : 54,
  };
}
