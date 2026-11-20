/**
 * Sizes of the nodes of a diagram, record nodes included, from the declared text alone. Pure: no
 * React, no styles, so the layout and its lint run under Node.
 */
import type { Walkthrough } from '../../core';
import {
  recordGeometry,
  widestValues,
  type RecordGeometry,
  type RecordShape,
  type SlotDecl,
} from './slots';

export interface RecordNodeDecl {
  id: string;
  label: string;
  sub?: string | undefined;
  tone?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  slots?: SlotDecl[] | undefined;
  arrange?: 'row' | 'column' | undefined;
  head?: boolean | undefined;
  names?: boolean | undefined;
  initial?: boolean | undefined;
}

export const shapeOf = (node: RecordNodeDecl): RecordShape => ({
  id: node.id,
  slots: node.slots ?? [],
  direction: node.arrange ?? 'row',
  head: node.head ?? true,
  names: node.names ?? true,
});

/** The sizes of every node. Record nodes are sized from their slots; the rest by `plain`. */
export function recordSizes(
  paneId: string,
  nodes: readonly RecordNodeDecl[],
  walkthrough: Walkthrough,
  plain: (node: RecordNodeDecl) => { width: number; height: number },
): Map<string, { size: { width: number; height: number }; geometry: RecordGeometry | undefined }> {
  const widest = widestValues(paneId, nodes, walkthrough);
  const sized = new Map<
    string,
    { size: { width: number; height: number }; geometry: RecordGeometry | undefined }
  >();
  for (const node of nodes) {
    if (node.slots === undefined) {
      sized.set(node.id, { size: plain(node), geometry: undefined });
    } else {
      const geometry = recordGeometry(shapeOf(node), node.label, widest);
      sized.set(node.id, { size: { width: geometry.width, height: geometry.height }, geometry });
    }
  }
  return sized;
}
