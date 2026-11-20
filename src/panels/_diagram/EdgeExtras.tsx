/**
 * What an edge draws beyond its line: a gate where it crosses a boundary, and a dot that travels
 * along it once when a call reads it.
 */
import { useInternalNode } from '@xyflow/react';
import {
  firstBorderCrossing,
  flatten,
  pathOf,
  reversed,
  type Point,
  type RouteStyle,
} from './route';

/** A small diamond on the line where it meets the border of a boundary group. */
function Gate({ group, line }: { group: string; line: readonly Point[] }) {
  const node = useInternalNode(group);
  if (node === undefined) return null;
  const width = node.measured.width ?? node.width;
  const height = node.measured.height ?? node.height;
  if (width === undefined || height === undefined) return null;
  const at = firstBorderCrossing({ ...node.internals.positionAbsolute, width, height }, line);
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

/** A dot that runs along the line once, then fades. Not drawn when still. */
function Dot({ path, token }: { path: string; token: string }) {
  if (stillWanted()) return null;
  return (
    <circle key={token} className="fw-edge-dot" r="4.5" cx="0" cy="0">
      <animateMotion
        dur="0.9s"
        fill="freeze"
        path={path}
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
  points,
  style,
  crosses,
  pulse,
  reverse,
}: {
  /** The route, from where the line starts to the arrowhead tip. */
  points: readonly Point[];
  style: RouteStyle;
  crosses: readonly string[] | undefined;
  /** Set to the call's id while a call reads the edge: the dot plays once for each call. */
  pulse: string | undefined;
  reverse: boolean;
}) {
  const line = flatten(points, style);
  return (
    <>
      {crosses?.map((group) => (
        <Gate key={group} group={group} line={line} />
      ))}
      {pulse !== undefined && (
        <Dot path={pathOf(reverse ? reversed(points) : points, style)} token={pulse} />
      )}
    </>
  );
}
