/**
 * Positions and routes for a diagram, computed once from the complete set of elements so that
 * nothing moves when a later call adds one.
 *
 * Which layout runs, in order: every node pinned (positions as given); the hub layout; any node
 * placed on the grid (cells and relative places); the tree layout; the fast layering for a dense
 * graph; and otherwise ELK, with some nodes pinned on top of its answer if only some say `x` and `y`.
 * ELK is only loaded when it is needed.
 *
 * Routes (the points of each edge, and where its label goes) come from ELK for ELK layouts, from
 * the hub layout's own curves, and from the right-angle router (ortho.ts) for pinned and grid
 * layouts. The tree layout, the fast layering for a dense graph, and slot arrows have none: the diagram
 * draws a straight line there (slot arrows have their own router, slot-route.ts).
 */
import { layoutElk } from './elk';
import {
  ancestorsOf,
  containerIds,
  hasGroups,
  layeredGroups,
  parentMap,
  pinnedGroups,
} from './groups';
import { hubLayout } from './hub-layout';
import { MAX_ROUTED_BOXES, MAX_ROUTED_EDGES, routeOrthogonal, type Side } from './ortho';
import { gridLayout, isPlaced } from './place';
import { labelSize, pointAlong, type Rect, type Route } from './route';
import { treeLayout } from './tree-layout';

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  x?: number | undefined;
  y?: number | undefined;
  /** The group the node starts in. Pinned `x` and `y` are then relative to it. */
  parent?: string | undefined;
  /** Every group the node may ever sit in; a position is reserved in each. */
  parents?: readonly string[] | undefined;
  /** The ids of the node's slots, in order (record nodes); the tree layout uses them. */
  slots?: readonly string[] | undefined;
  /** `first` or `last` layer of a layered layout. */
  rank?: 'first' | 'last' | undefined;
  /** A cell of the grid: column and row, whole numbers that only order. */
  cell?: readonly [number, number] | undefined;
  /** Cells covered: columns and rows. */
  span?: readonly [number, number] | undefined;
  rightOf?: string | undefined;
  below?: string | undefined;
  alignWith?: string | undefined;
  /** The side of the hub this child of the hub goes to (hub layout). */
  side?: 'left' | 'right' | undefined;
  /** The diameter of the disc a circle node is drawn as; the box holds the label beneath it too. */
  disc?: number | undefined;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  /** The slot of `source` the edge leaves from, if it leaves from one. */
  slot?: string | undefined;
  /** False for an edge the tree layout must not treat as a parent-child link. */
  tree?: boolean | undefined;
  /** The text of the label, whose room the layout keeps. */
  label?: string | undefined;
  fromSide?: Side | undefined;
  toSide?: Side | undefined;
}

export type Direction = 'RIGHT' | 'DOWN';
/** Groups also have a `width` and `height`; a key `<id>:<parent>` is a reserved position (see groups.ts). */
export type Positions = Record<
  string,
  { x: number; y: number; width?: number | undefined; height?: number | undefined }
>;
export type LayoutMode = 'layered' | 'tree' | 'hub';
export type Routing = 'straight' | 'orthogonal' | 'curved';
export type Spacing = 'compact' | 'normal' | 'roomy';

export interface LayoutOptions {
  /** How lines are drawn: straight, with right angles (default), or as smooth curves. */
  routing?: Routing | undefined;
  spacing?: Spacing | undefined;
  /** `declared`: nodes stay in the order they were declared within a layer. */
  order?: 'declared' | 'auto' | undefined;
}

export type LayoutKind = 'elk' | 'grid' | 'pinned' | 'pins' | 'tree' | 'hub' | 'fast';

/** Something the layout could not do as asked. Lint turns these into warnings. */
export interface LayoutNote {
  rule: 'pin-ignored' | 'not-routed';
  node?: string;
  message: string;
}

export interface Layout {
  positions: Positions;
  /** By edge id. An edge with no route is drawn straight. */
  routes: Record<string, Route>;
  kind: LayoutKind;
  notes: LayoutNote[];
}

const cache = new Map<string, Promise<Layout>>();

/** Whether a node is pinned on both axes. */
const fullyPinned = (node: LayoutNode) => node.x !== undefined && node.y !== undefined;

export function pinned(nodes: readonly LayoutNode[]): Positions | undefined {
  if (hasGroups(nodes)) return pinnedGroups(nodes);
  const positions: Positions = {};
  for (const node of nodes) {
    if (node.x === undefined || node.y === undefined) return undefined;
    positions[node.id] = { x: node.x, y: node.y };
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

/** The grid in a container that has a placed node, the fast layering in one that has not. */
const flatOrGrid = (
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
): Positions =>
  nodes.some(isPlaced)
    ? gridLayout(nodes, edges, direction).positions
    : layered(nodes, edges, direction);

/** Absolute boxes of every node from positions that are relative to the parent. */
export function absoluteBoxes(
  nodes: readonly LayoutNode[],
  positions: Positions,
): Map<string, Rect> {
  const parent = parentMap(nodes);
  const boxes = new Map<string, Rect>();
  for (const node of nodes) {
    const own = positions[node.id];
    if (own === undefined) continue;
    let x = own.x;
    let y = own.y;
    for (const up of ancestorsOf(node.id, parent)) {
      x += positions[up]?.x ?? 0;
      y += positions[up]?.y ?? 0;
    }
    boxes.set(node.id, { x, y, width: own.width ?? node.width, height: own.height ?? node.height });
  }
  return boxes;
}

/** Right-angle routes round the nodes, for layouts ELK did not make. Empty past what the router can search. */
function routeAround(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  positions: Positions,
  options: LayoutOptions,
  notes: LayoutNote[],
): Record<string, Route> {
  const routes: Record<string, Route> = {};
  if (options.routing === 'straight') return routes;
  const boxes = absoluteBoxes(nodes, positions);
  if (boxes.size > MAX_ROUTED_BOXES || edges.length > MAX_ROUTED_EDGES) {
    notes.push({
      rule: 'not-routed',
      message: `${boxes.size} nodes and ${edges.length} edges are too many to route round: edges are drawn straight`,
    });
    return routes;
  }
  const parent = parentMap(nodes);
  const holders = containerIds(nodes);
  const requests = edges
    .filter(
      (edge) =>
        boxes.has(edge.source) &&
        boxes.has(edge.target) &&
        edge.source !== edge.target &&
        !ancestorsOf(edge.source, parent).includes(edge.target) &&
        !ancestorsOf(edge.target, parent).includes(edge.source),
    )
    .map((edge) => ({
      id: edge.id,
      from: edge.source,
      to: edge.target,
      fromSide: edge.fromSide,
      toSide: edge.toSide,
    }));
  const found = routeOrthogonal(
    boxes,
    nodes.filter((node) => !holders.has(node.id)).map((node) => node.id),
    requests,
  );
  const label = new Map(edges.map((edge) => [edge.id, edge.label]));
  for (const [id, points] of found) {
    const text = label.get(id);
    const route: Route = { points, style: options.routing === 'curved' ? 'curved' : 'orthogonal' };
    if (text !== undefined && text !== '') {
      const size = labelSize(text);
      const m = pointAlong(points, 0.5);
      route.label = { x: m.x - size.width / 2, y: m.y - size.height / 2, ...size };
    }
    routes[id] = route;
  }
  return routes;
}

/** Pins on top of a layout: a node that names `x` or `y` goes there, and the rest give way. */
function applyPins(
  nodes: readonly LayoutNode[],
  positions: Positions,
  direction: Direction,
): Positions {
  const out: Positions = {};
  for (const [id, at] of Object.entries(positions)) out[id] = { ...at };
  const free = new Set<string>();
  for (const node of nodes) {
    const at = out[node.id];
    if (at === undefined) continue;
    if (node.x !== undefined) at.x = node.x;
    if (node.y !== undefined) at.y = node.y;
    if (!fullyPinned(node)) free.add(node.id);
  }
  const rect = (node: LayoutNode) => ({
    x: out[node.id]!.x,
    y: out[node.id]!.y,
    width: node.width,
    height: node.height,
  });
  const settled: LayoutNode[] = nodes.filter((node) => !free.has(node.id));
  const gap = 14;
  for (const node of nodes.filter((n) => free.has(n.id))) {
    // Move along the axis that is not pinned: the cross axis of the layout if neither is.
    const alongY =
      node.x !== undefined ? true : node.y !== undefined ? false : direction === 'RIGHT';
    for (let tries = 0; tries < 200; tries += 1) {
      const mine = rect(node);
      const hit = settled.find((other) => {
        const r = rect(other);
        return (
          mine.x < r.x + r.width + gap &&
          r.x < mine.x + mine.width + gap &&
          mine.y < r.y + r.height + gap &&
          r.y < mine.y + mine.height + gap
        );
      });
      if (hit === undefined) break;
      const r = rect(hit);
      if (alongY) out[node.id]!.y = r.y + r.height + gap;
      else out[node.id]!.x = r.x + r.width + gap;
    }
    settled.push(node);
  }
  return out;
}

/**
 * A disc node's box holds the label beneath the disc, so a line that ends at the box would end
 * beside the label. Lines end on the disc instead: the end point moves to where the line from the
 * disc's centre towards the next point meets the disc's rim.
 */
function clipToDiscs(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  positions: Positions,
  routes: Record<string, Route>,
): Record<string, Route> {
  const discs = nodes.filter((node) => node.disc !== undefined);
  if (discs.length === 0) return routes;
  const boxes = absoluteBoxes(discs, positions);
  const byId = new Map(discs.map((node) => [node.id, node]));
  const out: Record<string, Route> = {};
  for (const edge of edges) {
    const route = routes[edge.id];
    if (route === undefined) continue;
    const points = route.points.map((point) => ({ ...point }));
    const clip = (id: string, end: number, next: number) => {
      const node = byId.get(id);
      const box = boxes.get(id);
      if (node?.disc === undefined || box === undefined || points.length < 2) return;
      const radius = node.disc / 2;
      const centre = { x: box.x + box.width / 2, y: box.y + radius };
      const toward = points[next]!;
      const length = Math.hypot(toward.x - centre.x, toward.y - centre.y);
      if (length <= radius) return;
      points[end] = {
        x: centre.x + ((toward.x - centre.x) / length) * radius,
        y: centre.y + ((toward.y - centre.y) / length) * radius,
      };
    };
    clip(edge.source, 0, 1);
    clip(edge.target, points.length - 1, points.length - 2);
    out[edge.id] = { ...route, points };
  }
  return { ...routes, ...out };
}

async function compute(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
  mode: LayoutMode,
  options: LayoutOptions,
): Promise<Layout> {
  const result = await place(nodes, edges, direction, mode, options);
  if (result.kind === 'hub') return result;
  return { ...result, routes: clipToDiscs(nodes, edges, result.positions, result.routes) };
}

async function place(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
  mode: LayoutMode,
  options: LayoutOptions,
): Promise<Layout> {
  const notes: LayoutNote[] = [];
  const fixed = pinned(nodes);
  if (fixed !== undefined) {
    const routes = routeAround(nodes, edges, fixed, options, notes);
    return { positions: fixed, routes, kind: 'pinned', notes };
  }
  const someX = nodes.filter((node) => node.x !== undefined || node.y !== undefined);

  if (mode === 'hub') {
    const hub = hubLayout(nodes, edges, labelSize);
    const routes = options.routing === 'straight' ? {} : hub.routes;
    return { positions: hub.positions, routes, kind: 'hub', notes };
  }

  if (nodes.some(isPlaced)) {
    for (const node of someX) {
      notes.push({
        rule: 'pin-ignored',
        node: node.id,
        message: `"${node.id}" is pinned with x and y in a diagram that places nodes on a grid: the pin is not used`,
      });
    }
    const positions = hasGroups(nodes)
      ? layeredGroups(nodes, edges, direction, flatOrGrid)
      : flatOrGrid(nodes, edges, direction);
    const routes = routeAround(nodes, edges, positions, options, notes);
    return { positions, routes, kind: 'grid', notes };
  }

  if (mode === 'tree') {
    return { positions: treeLayout(nodes, edges, direction), routes: {}, kind: 'tree', notes };
  }

  const fast = (): Layout => ({
    positions: hasGroups(nodes)
      ? layeredGroups(nodes, edges, direction, layered)
      : layered(nodes, edges, direction),
    routes: {},
    kind: 'fast',
    notes,
  });
  if (isDense(nodes.length, edges.length)) return fast();

  let elk: Layout;
  try {
    elk = await layoutElk(nodes, edges, direction, options);
  } catch {
    return fast();
  }
  if (someX.length === 0) return elk;
  if (hasGroups(nodes)) {
    for (const node of someX) {
      notes.push({
        rule: 'pin-ignored',
        node: node.id,
        message: `"${node.id}" is pinned in a diagram with groups: a pin is used only when every node is pinned`,
      });
    }
    return { ...elk, notes };
  }
  const positions = applyPins(nodes, elk.positions, direction);
  const routes = routeAround(nodes, edges, positions, options, notes);
  return { positions, routes, kind: 'pins', notes };
}

/** Resolves to the positions, routes and notes of a diagram. The same input gives the same promise. */
export function layoutFull(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
  mode: LayoutMode = 'layered',
  options: LayoutOptions = {},
): Promise<Layout> {
  const key = JSON.stringify([direction, mode, options, nodes, edges]);
  let result = cache.get(key);
  if (result === undefined) {
    result = compute(nodes, edges, direction, mode, options);
    cache.set(key, result);
  }
  return result;
}

/** Resolves to a position for every node. The same input gives the same promise. */
export function layout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: Direction,
  mode: LayoutMode = 'layered',
  options: LayoutOptions = {},
): Promise<Positions> {
  return layoutFull(nodes, edges, direction, mode, options).then((result) => result.positions);
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
