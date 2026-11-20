/**
 * ELK, for flat and nested diagrams alike: positions, and the routes and label places ELK found.
 *
 * Nested diagrams go through ELK in one run over every level (`INCLUDE_CHILDREN`), so edges between
 * groups are routed with the whole hierarchy in view. Positions of a node are relative to its parent,
 * as React Flow wants them. The points of an edge are asked for in `ROOT` coordinates
 * (`elk.json.edgeCoords`): ELK would otherwise give them relative to the edge's container, the lowest
 * common ancestor of its ends, which is a different node for every edge that crosses a group border.
 * Edge labels use the same system.
 */
import type { ElkNode, ElkExtendedEdge, ElkPort } from 'elkjs/lib/elk-api';
import { GROUP_PAD, TOP, buildTree, type Item } from './groups';
import type { Direction, LayoutEdge, LayoutNode, LayoutOptions, Layout } from './layout';
import { labelSize, type Point, type Route } from './route';
import type { Side } from './ortho';

const SPACING = {
  compact: { node: 16, layer: 32, edge: 10 },
  normal: { node: 28, layer: 48, edge: 14 },
  roomy: { node: 44, layer: 76, edge: 20 },
} as const;

const SIDE: Record<Side, string> = { top: 'NORTH', right: 'EAST', bottom: 'SOUTH', left: 'WEST' };

/** The id of the port a node gets for an edge that must leave or arrive by a side. `~` cannot occur in an author's id. */
export const portId = (node: string, side: Side) => `${node}~${side}`;

export async function layoutElk(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
  options: LayoutOptions,
): Promise<Layout> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const tree = buildTree(nodes, edges);
  const space = SPACING[options.spacing ?? 'normal'];
  const routing = options.routing ?? 'orthogonal';
  const down = direction === 'DOWN';
  // Self loops are drawn by the diagram: ELK's own are a few pixels across.
  const routed = tree.edges.filter((edge) => edge.source !== edge.target);

  const ports = new Map<string, Set<Side>>();
  const want = (node: string, side: Side | undefined) => {
    if (side === undefined) return;
    const sides = ports.get(node) ?? new Set<Side>();
    sides.add(side);
    ports.set(node, sides);
  };
  for (const edge of routed) {
    want(edge.source, edge.fromSide);
    want(edge.target, edge.toSide);
  }

  const toElk = (item: Item): ElkNode => {
    const held = tree.kids.get(item.id);
    const layoutOptions: Record<string, string> = {};
    if (item.node?.rank !== undefined) {
      layoutOptions['elk.layered.layering.layerConstraint'] =
        item.node.rank === 'first' ? 'FIRST' : 'LAST';
    }
    const sides = ports.get(item.id);
    const elkPorts: ElkPort[] | undefined =
      sides === undefined
        ? undefined
        : [...sides].map((side) => ({
            id: portId(item.id, side),
            width: 0,
            height: 0,
            layoutOptions: { 'elk.port.side': SIDE[side] },
          }));
    if (sides !== undefined) layoutOptions['elk.portConstraints'] = 'FIXED_SIDE';
    if (held === undefined) {
      return {
        id: item.id,
        width: item.width,
        height: item.height,
        ...(Object.keys(layoutOptions).length === 0 ? {} : { layoutOptions }),
        ...(elkPorts === undefined ? {} : { ports: elkPorts }),
      };
    }
    return {
      id: item.id,
      layoutOptions: {
        ...layoutOptions,
        'elk.padding': `[top=${GROUP_PAD.top},left=${GROUP_PAD.side},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.side}]`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        // ELK applies a minimum size to the layout's own axes, so a downward layout takes it turned.
        'elk.nodeSize.minimum': down
          ? `(${item.height},${item.width})`
          : `(${item.width},${item.height})`,
      },
      ...(elkPorts === undefined ? {} : { ports: elkPorts }),
      children: held.map(toElk),
    };
  };

  const graph = await new ELK().layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': routing === 'orthogonal' ? 'ORTHOGONAL' : 'POLYLINE',
      'elk.json.edgeCoords': 'ROOT',
      'elk.spacing.nodeNode': String(space.node),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(space.layer),
      'elk.spacing.edgeNode': String(space.edge),
      'elk.spacing.edgeEdge': String(space.edge * 0.6),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(space.edge),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(space.edge * 0.6),
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      ...(options.order === 'declared'
        ? { 'elk.layered.crossingMinimization.forceNodeModelOrder': 'true' }
        : {}),
    },
    children: (tree.kids.get(TOP) ?? []).map(toElk),
    edges: routed.map((edge): ElkExtendedEdge => {
      const label = routing === 'straight' ? undefined : edge.label;
      return {
        id: edge.id,
        sources: [edge.fromSide === undefined ? edge.source : portId(edge.source, edge.fromSide)],
        targets: [edge.toSide === undefined ? edge.target : portId(edge.target, edge.toSide)],
        ...(label === undefined || label === ''
          ? {}
          : { labels: [{ id: `${edge.id}~label`, text: label, ...labelSize(label) }] }),
      };
    }),
  });

  const positions: Layout['positions'] = {};
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

  const routes: Record<string, Route> = {};
  for (const edge of graph.edges ?? []) {
    const section = edge.sections?.[0];
    if (section === undefined) continue;
    const points: Point[] = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ].map((point) => ({ x: point.x, y: point.y }));
    const label = edge.labels?.[0];
    routes[edge.id] = {
      points,
      style: routing === 'curved' ? 'curved' : 'orthogonal',
      ...(label?.x === undefined || label.y === undefined
        ? {}
        : {
            label: { x: label.x, y: label.y, width: label.width ?? 0, height: label.height ?? 0 },
          }),
    };
  }
  return { positions, routes, kind: 'elk', notes: [] };
}
