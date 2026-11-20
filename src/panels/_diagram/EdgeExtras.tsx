/**
 * What an edge draws beyond its line: a gate where it crosses a boundary, and a dot that travels
 * along it once when a call reads it.
 */
import { useInternalNode } from '@xyflow/react';
import { crossingPoint } from './groups';

type Point = { x: number; y: number };

/** A small diamond on the line where it meets the border of a boundary group. */
function Gate({ group, from, to }: { group: string; from: Point; to: Point }) {
  const node = useInternalNode(group);
  if (node === undefined) return null;
  const width = node.measured.width ?? node.width;
  const height = node.measured.height ?? node.height;
  if (width === undefined || height === undefined) return null;
  const at = crossingPoint({ ...node.internals.positionAbsolute, width, height }, from, to);
  if (at === undefined) return null;
  return (
    <path
      className="fw-edge-gate"
      data-gate={group}
      d={`M${at.x},${at.y - 6} L${at.x + 6},${at.y} L${at.x},${at.y + 6} L${at.x - 6},${at.y} Z`}
    />
  );
}

/** Whether the reader asked for less motion. Read when drawn, so a change shows on the next call. */
export function stillWanted(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** A dot that runs from one end of the line to the other once, then fades. Not drawn when still. */
function Dot({ from, to, token }: { from: Point; to: Point; token: string }) {
  if (stillWanted()) return null;
  return (
    <circle key={token} className="fw-edge-dot" r="4.5" cx="0" cy="0">
      <animateMotion
        dur="0.9s"
        fill="freeze"
        path={`M${from.x},${from.y} L${to.x},${to.y}`}
        calcMode="spline"
        keyTimes="0;1"
        keySplines="0.4 0 0.2 1"
      />
      <animate
        attributeName="opacity"
        values="1;1;0"
        keyTimes="0;0.85;1"
        dur="0.9s"
        fill="freeze"
      />
    </circle>
  );
}

export function EdgeExtras({
  from,
  to,
  crosses,
  pulse,
  reverse,
}: {
  /** Where the line starts and ends (the arrowhead tip). */
  from: Point;
  to: Point;
  crosses: readonly string[] | undefined;
  /** Set to the call's id while a call reads the edge: the dot plays once for each call. */
  pulse: string | undefined;
  reverse: boolean;
}) {
  return (
    <>
      {crosses?.map((group) => (
        <Gate key={group} group={group} from={from} to={to} />
      ))}
      {pulse !== undefined && (
        <Dot from={reverse ? to : from} to={reverse ? from : to} token={pulse} />
      )}
    </>
  );
}
