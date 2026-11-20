/**
 * The base for every node-and-edge panel. It owns what they share: stable
 * positions, the added / updated / read / removed / faded / selected classes,
 * fitting the view, and click-to-select. A panel supplies its nodes, its
 * edges and, when it wants, its own node and edge components.
 */
import {
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useInternalNode,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { markOf, type Selection, type Touched } from '../../core';
import {
  chooseFit,
  layout,
  pinned,
  type Direction,
  type LayoutMode,
  type LayoutNode,
  type Positions,
} from './layout';
import './diagram.css';

export interface DiagramNode extends LayoutNode {
  /** Node component to use. Defaults to the plain labelled box. */
  type?: string;
  label: string;
  sub?: string | undefined;
  tone?: string | undefined;
  kind?: string | undefined;
  /** Extra data for a custom node component, merged into the node's data. */
  data?: Record<string, unknown>;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  /** The slot of `source` the edge leaves from (record nodes); the tree layout reads it. */
  slot?: string | undefined;
  /** False: not a parent-child link, so the tree layout ignores it. */
  tree?: boolean | undefined;
  label?: string | undefined;
  type?: string;
  /** Extra data for a custom edge component, merged into the edge's data. */
  data?: Record<string, unknown>;
}

type BoxData = {
  label: string;
  sub?: string | undefined;
  tone?: string | undefined;
  kind?: string | undefined;
};

/** A labelled box. Its handles are invisible: floating edges do not use them. */
const BoxNode = memo(function BoxNode({ data }: NodeProps<Node<BoxData>>) {
  return (
    <div className="fw-node" data-tone={data.tone} data-kind={data.kind}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="fw-node-label">{data.label}</span>
      {data.sub !== undefined && <span className="fw-node-sub">{data.sub}</span>}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the line from this box's centre towards a point leaves the box. */
export function exitPoint(box: Box, towards: { x: number; y: number }): { x: number; y: number } {
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

function boxOf(node: ReturnType<typeof useInternalNode>): Box | undefined {
  if (node === undefined) return undefined;
  const width = node.measured.width ?? node.width;
  const height = node.measured.height ?? node.height;
  if (width === undefined || height === undefined) return undefined;
  return { ...node.internals.positionAbsolute, width, height };
}

/** A loop from a box back to itself, drawn off its right-hand side. */
function SelfLoop({ box, label, lane }: { box: Box; label: unknown; lane: number }) {
  const x = box.x + box.width;
  const top = box.y + box.height * 0.3;
  const bottom = box.y + box.height * 0.7;
  const out = 26 + lane * 12;
  return (
    <>
      <path
        className="fw-edge-hit"
        d={`M${x},${top} C${x + out},${top - 6} ${x + out},${bottom + 6} ${x + 9},${bottom}`}
      />
      <path
        className="fw-edge-line"
        d={`M${x},${top} C${x + out},${top - 6} ${x + out},${bottom + 6} ${x + 9},${bottom}`}
      />
      <polygon
        className="fw-edge-head"
        points={`${x},${bottom} ${x + 10},${bottom - 4.5} ${x + 10},${bottom + 4.5}`}
      />
      {typeof label === 'string' && label !== '' && (
        <text
          className="fw-edge-label"
          x={x + out * 0.75 + 4}
          y={(top + bottom) / 2}
          textAnchor="start"
          dominantBaseline="central"
        >
          {label}
        </text>
      )}
    </>
  );
}

/** A straight edge between the borders of two boxes, wherever they are. */
const FloatingEdge = memo(function FloatingEdge({ source, target, label, data }: EdgeProps) {
  const from = boxOf(useInternalNode(source));
  const to = boxOf(useInternalNode(target));
  if (from === undefined || to === undefined) return null;
  // Which of several edges between the same two boxes, in the same direction, this one is.
  const lane = typeof data?.lane === 'number' ? data.lane : 0;
  if (source === target) return <SelfLoop box={from} label={label} lane={lane} />;

  const a = exitPoint(from, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
  const b = exitPoint(to, { x: from.x + from.width / 2, y: from.y + from.height / 2 });
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1) return null;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  // Every edge runs a little to one side of the centre line, so that two
  // edges in opposite directions between the same boxes do not overlap.
  // A second edge in the same direction runs further out again.
  const side = SIDE + lane * 11;
  const start = { x: a.x - uy * side, y: a.y + ux * side };
  const end = { x: b.x - uy * side, y: b.y + ux * side };
  const base = { x: end.x - ux * 10, y: end.y - uy * 10 };
  const head = [
    `${end.x},${end.y}`,
    `${base.x - uy * 4.5},${base.y + ux * 4.5}`,
    `${base.x + uy * 4.5},${base.y - ux * 4.5}`,
  ].join(' ');

  return (
    <>
      <line className="fw-edge-hit" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <line className="fw-edge-line" x1={start.x} y1={start.y} x2={base.x} y2={base.y} />
      <polygon className="fw-edge-head" points={head} />
      {typeof label === 'string' && label !== '' && (
        <text
          className="fw-edge-label"
          x={(start.x + end.x) / 2}
          y={(start.y + end.y) / 2}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {label}
        </text>
      )}
    </>
  );
});

const SIDE = 5;

const BASE_NODE_TYPES: NodeTypes = { box: BoxNode };
const BASE_EDGE_TYPES: EdgeTypes = { floating: FloatingEdge };

/**
 * Positions depend only on ids, sizes, pins and edges. What a node says can
 * change from call to call without starting a new layout.
 */
function usePositions(
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
  direction: Direction,
  mode: LayoutMode,
): Positions | undefined {
  const key = JSON.stringify([
    direction,
    nodes.map(({ id, width, height, x, y, slots }) => [
      id,
      width,
      height,
      x ?? null,
      y ?? null,
      slots ?? null,
    ]),
    edges.map(({ id, source, target, slot, tree }) => [
      id,
      source,
      target,
      slot ?? null,
      tree ?? null,
    ]),
    mode,
  ]);
  const [resolved, setResolved] = useState<{ key: string; positions: Positions } | undefined>();

  useEffect(() => {
    let cancelled = false;
    const [, sizes, links] = JSON.parse(key) as [
      Direction,
      [string, number, number, number | null, number | null, string[] | null][],
      [string, string, string, string | null, boolean | null][],
    ];
    void layout(
      sizes.map(([id, width, height, x, y, slots]) => ({
        id,
        width,
        height,
        x: x ?? undefined,
        y: y ?? undefined,
        slots: slots ?? undefined,
      })),
      links.map(([id, source, target, slot, tree]) => ({
        id,
        source,
        target,
        slot: slot ?? undefined,
        tree: tree ?? undefined,
      })),
      direction,
      mode,
    ).then((positions) => {
      if (!cancelled) setResolved({ key, positions });
    });
    return () => {
      cancelled = true;
    };
  }, [key, direction, mode]);

  return resolved?.key === key ? resolved.positions : pinned(nodes);
}

/**
 * Keeps the view on the elements that are shown. Positions never change, so
 * the view only zooms and pans as the diagram grows or shrinks.
 */
function Fit({
  frame,
  shown,
  touched,
}: {
  frame: React.RefObject<HTMLDivElement | null>;
  shown: string;
  /** The shown nodes the current call touches, and the ends of the shown edges it touches. */
  touched: string;
}) {
  const { fitView, getNodes, getNodesBounds } = useReactFlow();
  const ready = useNodesInitialized({ includeHiddenNodes: true });
  const first = useRef(true);
  const [size, setSize] = useState(0);

  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined) setSize(Math.round(box.width) * 10000 + Math.round(box.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame]);

  useEffect(() => {
    if (!ready) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const shownIds = shown === '' ? [] : shown.split('\n');
    const element = frame.current;
    let choice = chooseFit(shownIds, [], { width: 0, height: 0 }, { width: 0, height: 0 });
    if (element !== null && shownIds.length > 0) {
      // A big diagram fitted whole is too small to read: follow the call instead.
      const shownSet = new Set(shownIds);
      const bounds = getNodesBounds(getNodes().filter((node) => shownSet.has(node.id)));
      const focus = touched === '' ? [] : touched.split('\n');
      choice = chooseFit(shownIds, focus, bounds, element.getBoundingClientRect());
    }
    void fitView({
      ...(choice.ids.length > 0 ? { nodes: choice.ids.map((id) => ({ id })) } : {}),
      maxZoom: choice.maxZoom,
      minZoom: choice.minZoom,
      padding: '24px',
      duration: first.current || still ? 0 : 250,
    });
    first.current = false;
  }, [ready, shown, touched, size, fitView, getNodes, getNodesBounds, frame]);

  return null;
}

export interface DiagramProps {
  /** Every node and edge the pane can ever show. */
  nodes: readonly DiagramNode[];
  edges: readonly DiagramEdge[];
  /** The ids present at the cursor. */
  present: ReadonlySet<string>;
  current: Touched;
  selection: Selection;
  theme: 'light' | 'dark';
  direction?: Direction;
  /** How nodes are placed: layered (the default) or as a tree. */
  layout?: LayoutMode;
  label: string;
  nodeTypes?: NodeTypes;
  edgeTypes?: EdgeTypes;
}

function classOf(id: string, shown: boolean, current: Touched, selected: string | undefined) {
  if (!shown) return 'is-absent';
  return `is-${markOf(id, current)}${selected === id ? ' is-selected' : ''}`;
}

export function Diagram({
  nodes,
  edges,
  present,
  current,
  selection,
  theme,
  direction = 'RIGHT',
  layout: mode = 'layered',
  label,
  nodeTypes,
  edgeTypes,
}: DiagramProps) {
  const positions = usePositions(nodes, edges, direction, mode);
  const frame = useRef<HTMLDivElement | null>(null);
  const allNodeTypes = useMemo(() => ({ ...BASE_NODE_TYPES, ...nodeTypes }), [nodeTypes]);
  const allEdgeTypes = useMemo(() => ({ ...BASE_EDGE_TYPES, ...edgeTypes }), [edgeTypes]);

  // An element is shown while it is present, and on the call that removes it.
  const shownIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of [...nodes, ...edges]) {
      if (present.has(item.id) || current.removed.has(item.id)) ids.add(item.id);
    }
    return ids;
  }, [nodes, edges, present, current]);
  const shownNodes = nodes
    .filter((node) => shownIds.has(node.id))
    .map((node) => node.id)
    .join('\n');
  // The nodes the call touches, the ends of the edges it touches, and the shown nodes next to them.
  const touchedNodes = useMemo(() => {
    const ids = new Set<string>();
    const marks = [...current.added, ...current.updated, ...current.read, ...current.removed];
    const nodeIds = new Set(nodes.map((node) => node.id));
    for (const id of marks) {
      if (!shownIds.has(id)) continue;
      if (nodeIds.has(id)) ids.add(id);
    }
    for (const edge of edges) {
      if (marks.includes(edge.id) && shownIds.has(edge.source) && shownIds.has(edge.target)) {
        ids.add(edge.source);
        ids.add(edge.target);
      }
    }
    const around = new Set(ids);
    for (const edge of edges) {
      if (!shownIds.has(edge.source) || !shownIds.has(edge.target)) continue;
      if (ids.has(edge.source)) around.add(edge.target);
      if (ids.has(edge.target)) around.add(edge.source);
    }
    return nodes
      .filter((node) => around.has(node.id))
      .map((node) => node.id)
      .join('\n');
  }, [nodes, edges, current, shownIds]);

  // Absent elements stay in the flow, invisible, so that positions are stable.
  const flowNodes = useMemo<Node[]>(() => {
    if (positions === undefined) return [];
    return nodes.map((node) => ({
      id: node.id,
      type: node.type ?? 'box',
      position: positions[node.id] ?? { x: 0, y: 0 },
      width: node.width,
      height: node.height,
      data: { label: node.label, sub: node.sub, tone: node.tone, kind: node.kind, ...node.data },
      className: classOf(node.id, shownIds.has(node.id), current, selection.id),
      ariaLabel: node.label,
    }));
  }, [positions, nodes, shownIds, current, selection.id]);

  const flowEdges = useMemo<Edge[]>(() => {
    // Edges that join the same two nodes in the same direction are counted, so each gets
    // its own line instead of being drawn on top of the others.
    const lanes = new Map<string, number>();
    return edges.map((edge) => {
      const pair = JSON.stringify([edge.source, edge.target]);
      const lane = lanes.get(pair) ?? 0;
      lanes.set(pair, lane + 1);
      // An edge shows only while both of its ends do.
      const shown = shownIds.has(edge.id) && shownIds.has(edge.source) && shownIds.has(edge.target);
      return {
        data: { lane, ...edge.data },
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type ?? 'floating',
        label: edge.label,
        className: classOf(edge.id, shown, current, selection.id),
      };
    });
  }, [edges, shownIds, current, selection.id]);

  const toggle = (id: string) => selection.select(selection.id === id ? undefined : id);

  return (
    <div className="fw-diagram" ref={frame} role="group" aria-label={label}>
      {positions === undefined ? (
        <p className="fw-diagram-wait">Laying out…</p>
      ) : (
        <ReactFlowProvider>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={allNodeTypes}
            edgeTypes={allEdgeTypes}
            forceColorMode={theme}
            fitView
            fitViewOptions={{ maxZoom: 1.15 }}
            minZoom={0.2}
            maxZoom={2}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            disableKeyboardA11y
            zoomOnScroll={false}
            preventScrolling={false}
            onNodeClick={(_, node) => toggle(node.id)}
            onEdgeClick={(_, edge) => toggle(edge.id)}
          >
            <Controls showInteractive={false} />
            <Fit frame={frame} shown={shownNodes} touched={touchedNodes} />
          </ReactFlow>
        </ReactFlowProvider>
      )}
    </div>
  );
}
