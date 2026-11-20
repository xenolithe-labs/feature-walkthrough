/**
 * What is wrong with a drawn diagram, measured on the geometry a layout returned: lines through
 * unrelated nodes, labels on top of other labels, lines or nodes, lines that cross, nodes that overlap.
 * Pure (boxes and polylines in, findings out), so the same code serves the tests that count
 * crossings for each demo and the lint that tells an author who cannot see the picture.
 */
import {
  polylineCrossings,
  polylineHitsRect,
  rectsOverlap,
  segmentHitsRect,
  type Point,
  type Rect,
} from './route';

export interface AuditNode {
  id: string;
  box: Rect;
  /** Holds other nodes: a line may cross it, and a node inside it is not overlapped by it. */
  group: boolean;
  /** Everything above the node, nearest first. */
  above: readonly string[];
}

export interface AuditEdge {
  id: string;
  source: string;
  target: string;
  /** The line as drawn, from the source's border to the target's (curves sampled). */
  line: readonly Point[];
  /** The label's pill, where it is drawn. */
  label?: Rect | undefined;
}

export interface Through {
  edge: string;
  node: string;
}

/** Edges that pass through the inside of a node that is neither of their ends (or holds one of them). */
export function throughNodes(nodes: readonly AuditNode[], edges: readonly AuditEdge[]): Through[] {
  const found: Through[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const ends = new Set([edge.source, edge.target]);
    for (const end of [edge.source, edge.target]) {
      for (const up of byId.get(end)?.above ?? []) ends.add(up);
    }
    for (const node of nodes) {
      if (node.group || ends.has(node.id)) continue;
      if (polylineHitsRect(edge.line, node.box, 1)) found.push({ edge: edge.id, node: node.id });
    }
  }
  return found;
}

export interface LabelHit {
  edge: string;
  /** What the label sits on: another edge's label, another edge's line, or a node. */
  on: 'label' | 'line' | 'node';
  other: string;
}

/** Labels on top of something they should not cover. A label on its own line is by design and not reported. */
export function labelHits(nodes: readonly AuditNode[], edges: readonly AuditEdge[]): LabelHit[] {
  const found: LabelHit[] = [];
  const labelled = edges.filter((edge) => edge.label !== undefined);
  for (const edge of labelled) {
    const pill = edge.label!;
    for (const other of labelled) {
      if (other.id !== edge.id && edge.id < other.id && rectsOverlap(pill, other.label!, 1)) {
        found.push({ edge: edge.id, on: 'label', other: other.id });
      }
    }
    for (const other of edges) {
      if (other.id === edge.id) continue;
      for (let i = 0; i < other.line.length - 1; i += 1) {
        if (segmentHitsRect(other.line[i]!, other.line[i + 1]!, pill, 1)) {
          found.push({ edge: edge.id, on: 'line', other: other.id });
          break;
        }
      }
    }
    for (const node of nodes) {
      if (node.group) continue;
      if (rectsOverlap(pill, node.box, 1))
        found.push({ edge: edge.id, on: 'node', other: node.id });
    }
  }
  return found;
}

/** Pairs of edges that cross each other (edges that share an end are not counted: they meet there). */
export function crossings(edges: readonly AuditEdge[]): [string, string][] {
  const found: [string, string][] = [];
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const a = edges[i]!;
      const b = edges[j]!;
      if (
        a.source === b.source ||
        a.source === b.target ||
        a.target === b.source ||
        a.target === b.target
      ) {
        continue;
      }
      if (polylineCrossings(a.line, b.line) > 0) found.push([a.id, b.id]);
    }
  }
  return found;
}

/** Pairs of nodes that overlap (a group and what it holds do not count). */
export function overlaps(nodes: readonly AuditNode[]): [string, string][] {
  const found: [string, string][] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (a.above.includes(b.id) || b.above.includes(a.id)) continue;
      if (rectsOverlap(a.box, b.box, 1)) found.push([a.id, b.id]);
    }
  }
  return found;
}

/** How many crossings a diagram of this many edges may have before lint says so. */
export const crossingLimit = (edges: number): number => Math.max(4, Math.round(edges * 0.4));

/** The side of `box` that faces away from `other`, for suggesting where an edge should leave. */
export function sideAwayFrom(box: Rect, other: Rect): 'top' | 'right' | 'bottom' | 'left' {
  const dx = other.x + other.width / 2 - (box.x + box.width / 2);
  const dy = other.y + other.height / 2 - (box.y + box.height / 2);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'left' : 'right') : dy > 0 ? 'top' : 'bottom';
}
