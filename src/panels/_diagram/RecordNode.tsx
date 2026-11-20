/**
 * The node component for nodes made of slots, and the edge component for arrows that start at a
 * slot or end at one. Geometry comes from `slots.ts`: the node is laid out by absolute position
 * inside a box of known size, so the edge's anchors are exact and nothing is measured.
 */
import {
  Handle,
  Position,
  useInternalNode,
  useReactFlow,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { memo, type KeyboardEvent } from 'react';
import { slotRoute, type SlotEnd } from './slot-end';
import type { RecordGeometry, RecordShape } from './slots';
import './record.css';

export interface SlotView {
  /** The element id, `node.slot`. */
  id: string;
  name: string;
  value: string;
  /** What the slot's arrow points at, for people who cannot see the arrow. */
  points: string | undefined;
  shown: boolean;
  mark: string;
  tone: string | undefined;
}

export interface RecordData extends Record<string, unknown> {
  label: string;
  sub?: string | undefined;
  tone?: string | undefined;
  shape: RecordShape;
  geometry: RecordGeometry;
  slotViews: SlotView[];
  /** The mark of the node itself (not of its slots). */
  mark: string;
  /** The node is shown: when it is not, nothing in it is in the tab order or read out. */
  shown: boolean;
  selected: string | undefined;
  select(id: string): void;
}

function pressed(action: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      action();
    }
  };
}

export const RecordNode = memo(function RecordNode({ id, data }: NodeProps<Node<RecordData>>) {
  const { geometry, shape, slotViews } = data;
  return (
    <div
      className="fw-record"
      data-tone={data.tone}
      data-mark={data.mark}
      data-direction={shape.direction}
      style={{ width: geometry.width, height: geometry.height }}
    >
      {geometry.head !== undefined && (
        <div
          className="fw-record-head"
          style={{ height: geometry.head.height }}
          role="button"
          tabIndex={data.shown ? 0 : -1}
          aria-hidden={data.shown ? undefined : true}
          aria-pressed={data.selected === id}
          aria-label={`record ${data.label}`}
          onClick={(event) => {
            event.stopPropagation();
            data.select(id);
          }}
          onKeyDown={pressed(() => data.select(id))}
        >
          {data.label}
        </div>
      )}
      {slotViews.map((slot, index) => {
        const rect = geometry.slots[slot.id.slice(id.length + 1)]!;
        const choose = () => data.select(slot.id);
        return (
          <div
            key={slot.id}
            className={`fw-slot is-${slot.mark}${slot.shown ? '' : ' is-absent'}${data.selected === slot.id ? ' is-selected' : ''}`}
            style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            data-entity={slot.id}
            data-mark={slot.shown ? slot.mark : 'absent'}
            data-tone={slot.tone}
            data-first={index === 0 ? '' : undefined}
            role="button"
            tabIndex={slot.shown ? 0 : -1}
            aria-hidden={slot.shown ? undefined : true}
            aria-pressed={data.selected === slot.id}
            aria-label={`${data.label} ${slot.name}: ${slot.points !== undefined ? `points to ${slot.points}` : slot.value === '' ? 'empty' : slot.value}`}
            onClick={(event) => {
              event.stopPropagation();
              choose();
            }}
            onKeyDown={pressed(choose)}
          >
            {shape.names && <span className="fw-slot-name">{slot.name}</span>}
            <span className="fw-slot-value">{slot.value}</span>
          </div>
        );
      })}
      <span className="fw-record-frame" aria-hidden="true" />
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});

export interface SlotEdgeData extends Record<string, unknown> {
  from: SlotEnd | undefined;
  to: SlotEnd | undefined;
  /** An end's slot is not present: nothing is drawn. */
  hidden: boolean;
  /** A reference, not a link of the structure: it arrives from above or below. */
  reference: boolean;
  /** The other nodes that are shown, which the route keeps clear of. */
  avoid: string[];
}

/** An arrow from a slot (or a node) to a slot (or a node), routed by `slot-route.ts`. */
export const SlotEdge = memo(function SlotEdge({ source, target, label, data }: EdgeProps) {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  const { getInternalNode } = useReactFlow();
  const info = data as SlotEdgeData | undefined;
  if (from === undefined || to === undefined || info === undefined || info.hidden) return null;
  const route = slotRoute(
    { box: from, slot: info.from },
    { box: to, slot: info.to },
    source === target,
    info.reference,
    info.avoid.flatMap((id) => getInternalNode(id) ?? []),
  );
  if (route === undefined) return null;
  const { path, head, dot, middle } = route;
  return (
    <g className="fw-slot-edge">
      <path className="fw-edge-hit" d={path} />
      <path className="fw-edge-line" d={path} />
      <polygon className="fw-edge-head" points={head.map((p) => `${p.x},${p.y}`).join(' ')} />
      {dot !== undefined && <circle className="fw-slot-dot" cx={dot.x} cy={dot.y} r={3.5} />}
      {typeof label === 'string' && label !== '' && (
        <text
          className="fw-edge-label"
          x={middle.x}
          y={middle.y}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {label}
        </text>
      )}
    </g>
  );
});
