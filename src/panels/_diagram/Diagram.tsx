/**
 * The base for every node-and-edge panel. It owns what they share: stable
 * positions and routes, the added / updated / read / removed / faded / selected classes,
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
import { EdgeExtras } from './EdgeExtras';
import { GroupNode, type GroupData } from './GroupNode';
import { containerIds, litGroups, parentFirst, parentMap, reservedKey } from './groups';
import { IconGlyph } from './IconGlyph';
import type { ResolvedIcon } from './icons';
import {
  chooseFit,
  layoutFull,
  pinned,
  type Direction,
  type Layout,
  type LayoutMode,
  type LayoutNode,
  type LayoutOptions,
  type Routing,
} from './layout';
import type { Side } from './ortho';
import {
  exitPoint as routeExitPoint,
  headPoints,
  labelSize,
  pathOf,
  pointAlong,
  withHead,
  type Point,
  type Route,
  type RouteStyle,
} from './route';
import { DISC, type Shape } from './shape';
import './diagram.css';

export interface DiagramNode extends LayoutNode {
  /** Node component to use. Defaults to the plain labelled box. */
  type?: string;
  label: string;
  sub?: string | undefined;
  tone?: string | undefined;
  kind?: string | undefined;
  /** Where the node sits now, when it has moved from the `parent` it started in. */
  at?: string | undefined;
  /** Drawn as a trust boundary or network zone (only meaningful for a node that holds others). */
  boundary?: boolean | undefined;
  icon?: ResolvedIcon | undefined;
  /** What the node is drawn as: a box (the default), a disc with its label beneath, or a pill. */
  shape?: Shape | undefined;
  /** A small count on the corner of the node. */
  badge?: string | number | undefined;
  /** A named ring colour; the pane's `accents` say what each one means. */
  accent?: string | undefined;
  /** Stands for this many collapsed children. */
  more?: number | undefined;
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
  /** Stroke width in pixels. */
  weight?: number | undefined;
  /** The boundary groups this edge crosses, derived from where its ends sit. */
  crosses?: readonly string[] | undefined;
  /** How this edge is drawn, instead of the pane's way. */
  routing?: Routing | undefined;
  /** The sides of its nodes the edge must leave and arrive by. */
  fromSide?: Side | undefined;
  toSide?: Side | undefined;
  /** Extra data for a custom edge component, merged into the edge's data. */
  data?: Record<string, unknown>;
}

type BoxData = {
  label: string;
  sub?: string | undefined;
  tone?: string | undefined;
  kind?: string | undefined;
  icon?: ResolvedIcon | undefined;
  shape?: Shape | undefined;
  badge?: string | number | undefined;
  accent?: string | undefined;
  more?: number | undefined;
};

/** A labelled box, or a disc with its label beneath it. Its handles are invisible: floating edges do not use them. */
const BoxNode = memo(function BoxNode({ data }: NodeProps<Node<BoxData>>) {
  if (data.shape === 'circle') {
    return (
      <div
        className="fw-node fw-circle"
        data-tone={data.tone}
        data-accent={data.accent}
        data-more={data.more === undefined ? undefined : ''}
      >
        <Handle type="target" position={Position.Top} isConnectable={false} />
        <div className="fw-disc" style={{ width: DISC, height: DISC }}>
          {data.more !== undefined ? (
            <span className="fw-disc-more">+{data.more}</span>
          ) : (
            data.icon !== undefined && <IconGlyph icon={data.icon} />
          )}
          {data.badge !== undefined && <span className="fw-badge">{data.badge}</span>}
        </div>
        <span className="fw-circle-label">{data.label}</span>
        {data.sub !== undefined && <span className="fw-circle-sub">{data.sub}</span>}
        <Handle type="source" position={Position.Bottom} isConnectable={false} />
      </div>
    );
  }
  return (
    <div
      className="fw-node"
      data-tone={data.tone}
      data-kind={data.kind ?? (data.shape === 'pill' ? 'terminal' : undefined)}
      data-accent={data.accent}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      {data.icon !== undefined && <IconGlyph icon={data.icon} />}
      <span className="fw-node-label">{data.label}</span>
      {data.sub !== undefined && <span className="fw-node-sub">{data.sub}</span>}
      {data.badge !== undefined && <span className="fw-badge">{data.badge}</span>}
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
export const exitPoint = routeExitPoint;

function boxOf(node: ReturnType<typeof useInternalNode>): Box | undefined {
  if (node === undefined) return undefined;
  const width = node.measured.width ?? node.width;
  const height = node.measured.height ?? node.height;
  if (width === undefined || height === undefined) return undefined;
  return { ...node.internals.positionAbsolute, width, height };
}

/** A label on an opaque pill, so it never sits on a line. `at` is the centre. */
function LabelPill({ text, at }: { text: string; at: Point }) {
  const size = labelSize(text);
  return (
    <g className="fw-edge-labelbox">
      <rect
        className="fw-edge-pill"
        x={at.x - size.width / 2}
        y={at.y - size.height / 2}
        width={size.width}
        height={size.height}
        rx={size.height / 2}
      />
      <text
        className="fw-edge-label"
        x={at.x}
        y={at.y}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {text}
      </text>
    </g>
  );
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
        <LabelPill
          text={label}
          at={{ x: x + out * 0.75 + 4 + labelSize(label).width / 2, y: (top + bottom) / 2 }}
        />
      )}
    </>
  );
}

/** What a routed edge is drawn from: its points, how they are joined, where its label goes. */
function routedFrom(data: EdgeProps['data']): Route | undefined {
  const route = data?.route as Route | undefined;
  if (route === undefined || route.points.length < 2) return undefined;
  const routing = data?.routing as Routing | undefined;
  if (routing === 'straight') return undefined;
  const style: RouteStyle =
    route.style === 'bezier' || routing === undefined
      ? route.style
      : routing === 'curved'
        ? 'curved'
        : 'orthogonal';
  return { ...route, style };
}

/**
 * An edge between two boxes: along the route the layout found when there is one, else a straight
 * line between the borders of the boxes, wherever they are.
 */
const FloatingEdge = memo(function FloatingEdge({ source, target, label, data }: EdgeProps) {
  const from = boxOf(useInternalNode(source));
  const to = boxOf(useInternalNode(target));
  if (from === undefined || to === undefined) return null;
  // Which of several edges between the same two boxes, in the same direction, this one is.
  const lane = typeof data?.lane === 'number' ? data.lane : 0;
  if (source === target) return <SelfLoop box={from} label={label} lane={lane} />;

  // A wide edge gets a bigger head.
  const weight = typeof data?.weight === 'number' ? data.weight : undefined;
  const grow = Math.max(0, (weight ?? 0) - 3) * 0.6;
  const crosses = Array.isArray(data?.crosses) ? (data.crosses as string[]) : undefined;
  const lineStyle =
    weight === undefined ? undefined : ({ '--fw-w': `${weight}px` } as React.CSSProperties);
  const route = routedFrom(data);
  const text = typeof label === 'string' && label !== '' ? label : undefined;

  if (route !== undefined) {
    const headed = withHead(route.points, 10 + grow * 2);
    if (headed === undefined) return null;
    const style = route.style;
    return (
      <>
        <path className="fw-edge-hit" d={pathOf(route.points, style)} />
        <path
          className="fw-edge-line"
          d={pathOf(headed.line, style)}
          data-weight={weight}
          data-crosses={crosses?.join(' ')}
          data-route={style}
          style={lineStyle}
        />
        <polygon className="fw-edge-head" points={headPoints(headed.head, grow)} />
        {text !== undefined && (
          <LabelPill
            text={text}
            at={
              route.label === undefined
                ? pointAlong(route.points, 0.5)
                : {
                    x: route.label.x + route.label.width / 2,
                    y: route.label.y + route.label.height / 2,
                  }
            }
          />
        )}
        <EdgeExtras
          points={route.points}
          style={style}
          crosses={crosses}
          pulse={typeof data?.pulse === 'string' ? data.pulse : undefined}
          reverse={data?.reverse === true}
        />
      </>
    );
  }

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
  const base = { x: end.x - ux * (10 + grow * 2), y: end.y - uy * (10 + grow * 2) };
  const head = headPoints({ tip: end, ux, uy }, grow);

  return (
    <>
      <line className="fw-edge-hit" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      <line
        className="fw-edge-line"
        x1={start.x}
        y1={start.y}
        x2={base.x}
        y2={base.y}
        data-weight={weight}
        data-crosses={crosses?.join(' ')}
        data-route="straight"
        style={lineStyle}
      />
      <polygon className="fw-edge-head" points={head} />
      {text !== undefined && (
        <LabelPill text={text} at={{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }} />
      )}
      <EdgeExtras
        points={[start, end]}
        style="straight"
        crosses={crosses}
        pulse={typeof data?.pulse === 'string' ? data.pulse : undefined}
        reverse={data?.reverse === true}
      />
    </>
  );
});

const SIDE = 5;

const BASE_NODE_TYPES: NodeTypes = { box: BoxNode, container: GroupNode };
const BASE_EDGE_TYPES: EdgeTypes = { floating: FloatingEdge };

/** What layout reads of a node: nothing a call can change. */
const layoutNode = (node: DiagramNode): LayoutNode => ({
  id: node.id,
  width: node.width,
  height: node.height,
  x: node.x,
  y: node.y,
  parent: node.parent,
  parents: node.parents,
  slots: node.slots,
  rank: node.rank,
  cell: node.cell,
  span: node.span,
  rightOf: node.rightOf,
  below: node.below,
  alignWith: node.alignWith,
  side: node.side,
  disc: node.disc,
});

/**
 * Positions and routes depend only on ids, sizes, hints, pins and edges. What a node says can
 * change from call to call without starting a new layout. The input goes through JSON so that
 * the key and what is laid out cannot differ, whatever fields a hint adds.
 */
function useLayout(
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
  direction: Direction,
  mode: LayoutMode,
  options: LayoutOptions,
): Layout | undefined {
  const key = JSON.stringify({
    direction,
    mode,
    options,
    nodes: nodes.map(layoutNode),
    edges: edges.map(({ id, source, target, slot, tree, label, fromSide, toSide }) => ({
      id,
      source,
      target,
      slot,
      tree,
      label,
      fromSide,
      toSide,
    })),
  });
  const [resolved, setResolved] = useState<{ key: string; layout: Layout } | undefined>();

  useEffect(() => {
    let cancelled = false;
    const input = JSON.parse(key) as {
      direction: Direction;
      mode: LayoutMode;
      options: LayoutOptions;
      nodes: LayoutNode[];
      edges: Parameters<typeof layoutFull>[1][number][];
    };
    void layoutFull(input.nodes, input.edges, input.direction, input.mode, input.options).then(
      (result) => {
        if (!cancelled) setResolved({ key, layout: result });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const fixed = useMemo(() => {
    const positions = pinned(nodes);
    return positions === undefined
      ? undefined
      : ({ positions, routes: {}, kind: 'pinned', notes: [] } satisfies Layout);
    // `nodes` change identity on every call: the pins are what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return resolved?.key === key ? resolved.layout : fixed;
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
    // The fit animates only when motion is on (the page root says so), and never under reduced motion.
    const still =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      frame.current?.closest('.fw')?.getAttribute('data-motion') !== 'on';
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
  /** How nodes are placed: layered (the default), as a tree, or around a hub. */
  layout?: LayoutMode;
  /** How lines are routed and how much room the layout leaves. */
  options?: LayoutOptions;
  /** What each accent colour means, by name: shown beside the diagram, so a colour never stands alone. */
  accents?: Readonly<Record<string, string>> | undefined;
  label: string;
  nodeTypes?: NodeTypes;
  edgeTypes?: EdgeTypes;
  /** The call at the cursor. A read edge shows its traffic once for each call. */
  call?: string;
  /** Read edges whose traffic runs from target to source (a reply). */
  reversed?: ReadonlySet<string>;
}

function classOf(
  id: string,
  shown: boolean,
  current: Touched,
  selected: string | undefined,
  lit = false,
) {
  if (!shown) return 'is-absent';
  const mark = markOf(id, current);
  return `is-${mark === 'faded' && lit ? 'idle' : mark}${selected === id ? ' is-selected' : ''}`;
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
  options,
  accents,
  label,
  nodeTypes,
  edgeTypes,
  call,
  reversed,
}: DiagramProps) {
  const settings = useMemo(() => options ?? {}, [options]);
  const drawn = useLayout(nodes, edges, direction, mode, settings);
  const positions = drawn?.positions;
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

  // Groups: where each node sits now (a node that moved sits in another parent than it started
  // in), which nodes hold others, and which groups the call touches something inside.
  const groups = useMemo(() => {
    const now = new Map(
      nodes.flatMap((node) => (node.at === undefined ? [] : [[node.id, node.at]])),
    );
    const parent = parentMap(nodes, now);
    const containers = containerIds(nodes);
    const marks = [...current.added, ...current.updated, ...current.read, ...current.removed];
    const live = marks.filter((id) => shownIds.has(id));
    const ends = edges.filter((edge) => live.includes(edge.id));
    return {
      parent,
      home: parentMap(nodes),
      containers,
      lit: litGroups(
        containers,
        parent,
        live.filter((id) => nodes.some((node) => node.id === id)),
        ends,
      ),
    };
  }, [nodes, edges, current, shownIds]);

  // Absent elements stay in the flow, invisible, so that positions are stable.
  const flowNodes = useMemo<Node[]>(() => {
    if (positions === undefined) return [];
    const placed = nodes.map((node) => {
      const parentId = groups.parent.get(node.id);
      const moved = parentId !== undefined && parentId !== groups.home.get(node.id);
      const spot = (moved ? positions[reservedKey(node.id, parentId)] : undefined) ??
        positions[node.id] ?? { x: 0, y: 0 };
      const isGroup = groups.containers.has(node.id);
      const own = positions[node.id];
      const size = isGroup
        ? { width: own?.width ?? node.width, height: own?.height ?? node.height }
        : { width: node.width, height: node.height };
      const data: BoxData & GroupData = {
        label: node.label,
        sub: node.sub,
        tone: node.tone,
        kind: node.kind,
        boundary: node.boundary,
        icon: node.icon,
        shape: node.shape,
        badge: node.badge,
        accent: node.accent,
        more: node.more,
        ...node.data,
      };
      return {
        id: node.id,
        type: isGroup ? 'container' : (node.type ?? 'box'),
        position: { x: spot.x, y: spot.y },
        ...(parentId === undefined ? {} : { parentId }),
        ...size,
        data,
        className:
          classOf(node.id, shownIds.has(node.id), current, selection.id, groups.lit.has(node.id)) +
          (node.parents === undefined ? '' : ' is-movable'),
        ariaLabel: isGroup
          ? `${node.label} (group)`
          : node.accent !== undefined && accents?.[node.accent] !== undefined
            ? `${node.label} (${accents[node.accent]})`
            : node.label,
      } satisfies Node;
    });
    // React Flow processes a parent before its children.
    return parentFirst(placed, groups.parent);
  }, [positions, nodes, groups, shownIds, current, selection.id, accents]);

  const flowEdges = useMemo<Edge[]>(() => {
    // Edges that join the same two nodes in the same direction are counted, so each gets
    // its own line instead of being drawn on top of the others.
    const lanes = new Map<string, number>();
    const routes = drawn?.routes ?? {};
    const straight = options?.routing === 'straight';
    return edges.map((edge) => {
      const pair = JSON.stringify([edge.source, edge.target]);
      const lane = lanes.get(pair) ?? 0;
      lanes.set(pair, lane + 1);
      // An edge shows only while both of its ends do.
      const shown = shownIds.has(edge.id) && shownIds.has(edge.source) && shownIds.has(edge.target);
      // A route was found for the places the ends started in: after a move it no longer fits.
      const moved = [edge.source, edge.target].some(
        (id) => groups.parent.get(id) !== groups.home.get(id),
      );
      const wanted = edge.routing ?? (straight ? 'straight' : undefined);
      return {
        data: {
          route: moved || wanted === 'straight' ? undefined : routes[edge.id],
          routing: wanted,
          lane,
          weight: edge.weight,
          crosses: edge.crosses,
          pulse: shown && call !== undefined && current.read.has(edge.id) ? call : undefined,
          reverse: reversed?.has(edge.id) === true,
          ...edge.data,
        },
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type ?? 'floating',
        label: edge.label,
        className: classOf(edge.id, shown, current, selection.id),
      };
    });
  }, [edges, shownIds, current, selection.id, call, reversed, drawn, options, groups]);

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
      {accents !== undefined && Object.keys(accents).length > 0 && (
        <ul className="fw-accent-key" aria-label="Colour key">
          {Object.entries(accents).map(([name, meaning]) => (
            <li key={name} data-accent={name}>
              <span className="fw-accent-dot" aria-hidden="true" />
              {meaning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
