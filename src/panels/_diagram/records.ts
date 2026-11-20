/**
 * What `graph` and `flow` need beyond plain nodes to show records: the schema fields, the slot
 * elements, the node and edge data for `RecordNode.tsx`, and lint. `panel.tsx` calls into this
 * so that its own code stays close to what it was.
 */
import { z } from 'zod';
import {
  effectTarget,
  markOf,
  own,
  writtenEffects,
  type ElementsState,
  type Problem,
  type ResolvedPane,
  type Touched,
  type Walkthrough,
} from '../../core';
import { text, toneOf } from '../_shared/changes';
import type { DiagramEdge, DiagramNode } from './Diagram';
import type { RecordData, SlotEdgeData, SlotView } from './RecordNode';
import { RecordNode, SlotEdge } from './RecordNode';
import { type RecordNodeDecl, recordSizes, shapeOf } from './record-sizes';
import {
  EndSchema,
  SlotSchema,
  edgeIdOf,
  openSides,
  recordGeometry,
  slotId,
  slotProblems,
  splitEnd,
  valueText,
  widestValues,
  type EdgeLike,
  type RecordGeometry,
  type RecordShape,
  type SlotDecl,
} from './slots';

/** The fields a node may have to be a record. */
export const recordNodeFields = {
  /** Named places in the node, in order. A slot's element id is `<node>.<slot>`. */
  slots: z.array(SlotSchema).optional(),
  /** Whether the slots run along a row or down a column. */
  arrange: z.enum(['row', 'column']).optional(),
  /** Show the node's label as a caption above its slots (default true). */
  head: z.boolean().optional(),
  /** Show each slot's name next to its value (default true). */
  names: z.boolean().optional(),
};

export const edgeEnd = EndSchema;
export { recordSizes, shapeOf };
export type { RecordNodeDecl };

/** The elements the slots of every node make. */
export function slotEntities(nodes: readonly RecordNodeDecl[]) {
  return nodes.flatMap((node) =>
    // A slot id repeated in one node is reported once, by `duplicate-slot`, not again as a repeated element.
    (node.slots ?? [])
      .filter((slot, index, all) => all.findIndex((other) => other.id === slot.id) === index)
      .map((slot) => ({
        id: slotId(node.id, slot.id),
        label: `${node.label} ${slot.label ?? slot.id}`,
        initial: slot.initial ?? true,
      })),
  );
}

export const RECORD_NODE_TYPES = { record: RecordNode };
export const RECORD_EDGE_TYPES = { slot: SlotEdge };

export interface RecordInputs {
  paneId: string;
  nodes: readonly RecordNodeDecl[];
  edges: readonly (EdgeLike & { label?: string | undefined })[];
  walkthrough: Walkthrough;
  state: ElementsState;
  /** What the call really does, not what the diagram frames. */
  current: Touched;
  selected: string | undefined;
  select(id: string): void;
}

/** The type, slot ids and data a record node needs on top of a plain `DiagramNode`. */
export function recordNode(
  node: RecordNodeDecl,
  geometry: ReturnType<typeof recordGeometry>,
  inputs: RecordInputs,
): Pick<DiagramNode, 'type' | 'slots' | 'data'> {
  const { state, current } = inputs;
  const present = new Set(state.present);
  const pointsTo = new Map<string, string>();
  const labels = new Map(inputs.nodes.map((item) => [item.id, item.label]));
  for (const edge of inputs.edges) {
    const id = edgeIdOf(edge);
    const to = splitEnd(edge.to);
    if (!present.has(id) || !present.has(to.node)) continue;
    pointsTo.set(edge.from, labels.get(to.node) ?? to.node);
  }
  const slotViews: SlotView[] = (node.slots ?? []).map((slot) => {
    const id = slotId(node.id, slot.id);
    const patch = own(state.patches, id);
    const mark = markOf(id, current);
    return {
      id,
      name: slot.label ?? slot.id,
      value: valueText(patch?.value ?? slot.value),
      points: pointsTo.get(id),
      // A slot is shown when it is present and so is its node: an absent node is not in the tab order.
      shown:
        (present.has(id) || current.removed.has(id)) &&
        (present.has(node.id) || current.removed.has(node.id)),
      mark: mark === 'faded' ? 'idle' : mark,
      tone: toneOf(patch?.tone, slot.tone),
    };
  });
  const data: RecordData = {
    label: text(own(state.patches, node.id)?.label) ?? node.label,
    sub: node.sub,
    tone: toneOf(own(state.patches, node.id)?.tone, node.tone),
    shape: shapeOf(node),
    geometry,
    slotViews,
    mark: markOf(node.id, current),
    shown: present.has(node.id) || current.removed.has(node.id),
    selected: inputs.selected,
    select: inputs.select,
  };
  return { type: 'record', slots: (node.slots ?? []).map((slot) => slot.id), data };
}

/** What the diagram marks: the call's marks, and the node of every slot the call touches. */
export function withOwners(current: Touched, nodes: readonly RecordNodeDecl[]): Touched {
  const owners = new Map<string, string>();
  for (const node of nodes)
    for (const slot of node.slots ?? []) owners.set(slotId(node.id, slot.id), node.id);
  const read = new Set(current.read);
  for (const set of [current.added, current.updated, current.read, current.removed]) {
    for (const id of set) {
      const owner = owners.get(id);
      if (owner !== undefined) read.add(owner);
    }
  }
  return read.size === current.read.size ? current : { ...current, read };
}

/** The edge type and the data an arrow needs if either end is a slot. */
export function recordEdge(
  edge: EdgeLike & { tree?: boolean | undefined },
  nodes: ReadonlyMap<
    string,
    { node: RecordNodeDecl; geometry: ReturnType<typeof recordGeometry> | undefined }
  >,
  present: ReadonlySet<string>,
): Pick<DiagramEdge, 'type' | 'source' | 'target' | 'slot' | 'tree' | 'data'> {
  const from = splitEnd(edge.from);
  const to = splitEnd(edge.to);
  const place = (end: { node: string; slot: string | undefined }) => {
    const entry = nodes.get(end.node);
    if (end.slot === undefined || entry?.geometry === undefined) return undefined;
    const rect = entry.geometry.slots[end.slot];
    if (rect === undefined) return undefined;
    return { rect, sides: openSides(shapeOf(entry.node), end.slot) };
  };
  const data: SlotEdgeData = {
    from: place(from),
    to: place(to),
    reference: edge.tree === false,
    avoid: [...nodes.keys()].filter((id) => id !== from.node && id !== to.node && present.has(id)),
    hidden: [edge.from, edge.to].some((end) => end.includes('.') && !present.has(end)),
  };
  return {
    type: 'slot',
    source: from.node,
    target: to.node,
    slot: from.slot,
    tree: edge.tree,
    data,
  };
}

/** Lint for records: slot ids, edge ends, slots of nodes that are not there yet. */
export function recordLint(
  pane: ResolvedPane,
  walkthrough: Walkthrough,
  index: number,
  nodes: readonly RecordNodeDecl[],
  edges: readonly EdgeLike[],
  initial: (node: RecordNodeDecl) => boolean,
): Problem[] {
  const rule = pane.panel.id;
  const problems: Problem[] = slotProblems(nodes, edges, ['layout', 'panes', index, 'content']).map(
    (problem) => ({
      severity: 'error' as const,
      rule: `${rule}/${problem.rule}`,
      path: problem.path,
      message: problem.message,
    }),
  );
  // A slot is there whenever its node is, so a call may not touch a slot of a node that has not
  // been added yet (core only checks the slot's own presence, which starts true).
  const owner = new Map<string, string>();
  for (const node of nodes)
    for (const slot of node.slots ?? []) owner.set(slotId(node.id, slot.id), node.id);
  const here = new Set(nodes.filter(initial).map((node) => node.id));
  walkthrough.steps.forEach((step, s) => {
    step.calls.forEach((call, c) => {
      writtenEffects(call, pane.id).forEach((effect, e) => {
        const { verb, id } = effectTarget(effect);
        const node = owner.get(id);
        if (node !== undefined && verb !== 'add' && !here.has(node)) {
          problems.push({
            severity: 'error',
            rule: `${rule}/slot-of-absent-node`,
            path: ['steps', s, 'calls', c, 'effects', pane.id, e, verb],
            message: `"${id}" is a slot of node "${node}", which is not present at this call`,
          });
        }
        if (verb === 'add' && here.has(id) === false && nodes.some((item) => item.id === id))
          here.add(id);
        if (verb === 'remove') here.delete(id);
      });
    });
  });
  return problems;
}
