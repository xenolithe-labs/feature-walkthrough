/**
 * What a diagram pane hands to the layout: sizes from the declared text, and the layout's view of
 * nodes and edges. One function for the viewer and for layout lint, so the lint judges the picture
 * the viewer draws and never a different one. Pure: no React, no browser.
 */
import type { Walkthrough } from '../../core';
import { containerIds, groupMinSize } from './groups';
import { ICON_BAND, resolveIcon, type CustomIcon } from './icons';
import {
  estimateSize,
  type Direction,
  type LayoutEdge,
  type LayoutMode,
  type LayoutNode,
  type LayoutOptions,
} from './layout';
import type { Side } from './ortho';
import { recordSizes, type RecordNodeDecl } from './records';
import { DISC, circleSize } from './shape';
import { splitEnd } from './slots';

/** The parts of a diagram pane's content that decide where things go. */
export interface InputNode extends RecordNodeDecl {
  parent?: string | undefined;
  parents?: readonly string[] | undefined;
  boundary?: boolean | undefined;
  icon?: string | undefined;
  rank?: 'first' | 'last' | undefined;
  cell?: readonly [number, number] | undefined;
  span?: readonly [number, number] | undefined;
  rightOf?: string | undefined;
  below?: string | undefined;
  alignWith?: string | undefined;
  side?: 'left' | 'right' | undefined;
  shape?: 'box' | 'circle' | 'pill' | undefined;
  more?: number | undefined;
}

export interface InputEdge {
  id?: string | undefined;
  from: string;
  to: string;
  label?: string | undefined;
  tree?: boolean | undefined;
  fromSide?: Side | undefined;
  toSide?: Side | undefined;
  routing?: 'straight' | 'orthogonal' | 'curved' | undefined;
}

export interface InputContent {
  nodes: readonly InputNode[];
  edges: readonly InputEdge[];
  direction: Direction;
  layout: LayoutMode;
  routing?: LayoutOptions['routing'];
  spacing?: LayoutOptions['spacing'];
  order?: LayoutOptions['order'];
  icons?: Readonly<Record<string, CustomIcon>> | undefined;
}

export const edgeIdOf = (edge: { id?: string | undefined; from: string; to: string }) =>
  edge.id ?? `${edge.from}.${edge.to}`;

/** A node that is drawn as a disc with its label beneath. `more` makes one. */
export const isDisc = (node: InputNode): boolean =>
  node.shape === 'circle' || node.more !== undefined;

/** The size of every node, and the geometry of a record node. */
export function sizesOf(paneId: string, content: InputContent, walkthrough: Walkthrough) {
  const holders = containerIds(content.nodes);
  return recordSizes(paneId, content.nodes, walkthrough, (plain) => {
    const node = plain as InputNode;
    const icon = resolveIcon(node.icon, content.icons);
    if (holders.has(node.id)) return groupMinSize(node.label, node.sub, node, icon);
    if (isDisc(node)) return circleSize(node.label, node.sub);
    const size = estimateSize(node.label, node.sub ?? ' ');
    return icon === undefined ? size : { ...size, height: size.height + ICON_BAND };
  });
}

/** The layout's view of every node: its size and every hint, and nothing a call can change. */
export function layoutNodesOf(
  content: InputContent,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
): LayoutNode[] {
  const holders = containerIds(content.nodes);
  return content.nodes.map((node) => ({
    id: node.id,
    ...sizes.get(node.id)!,
    x: node.x,
    y: node.y,
    parent: node.parent,
    parents: node.parents,
    slots: node.slots?.map((slot) => slot.id),
    rank: node.rank,
    cell: node.cell,
    span: node.span,
    rightOf: node.rightOf,
    below: node.below,
    alignWith: node.alignWith,
    side: node.side,
    disc: isDisc(node) && !holders.has(node.id) ? DISC : undefined,
  }));
}

export function layoutEdgesOf(content: InputContent): LayoutEdge[] {
  return content.edges.map((edge) => {
    const from = splitEnd(edge.from);
    return {
      id: edgeIdOf(edge),
      source: from.node,
      target: splitEnd(edge.to).node,
      slot: from.slot,
      tree: edge.tree,
      label: edge.label,
      fromSide: edge.fromSide,
      toSide: edge.toSide,
    };
  });
}

export const layoutOptionsOf = (content: InputContent): LayoutOptions => ({
  routing: content.routing,
  spacing: content.spacing,
  order: content.order,
});
