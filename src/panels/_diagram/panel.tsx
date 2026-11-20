/**
 * Builds a node-and-edge panel type. `graph` and `flow` are the same panel
 * with different defaults: a graph grows as calls add to it, a flow chart is
 * there from the start and calls walk through it.
 */
import { useMemo } from 'react';
import { z } from 'zod';
import {
  IdSchema,
  initElements,
  reduceElements,
  touched,
  type ElementsState,
  type PanelContext,
  type PanelType,
  type Problem,
  own,
} from '../../core';
import { fieldProblems } from '../_shared/fields';
import { TONES, changesSection, text, toneOf } from '../_shared/changes';
import { Diagram, type DiagramEdge, type DiagramNode } from './Diagram';
import { resolveIcon } from './icons';
import { edgeIdOf, isDisc, layoutNodesOf, layoutOptionsOf, sizesOf } from './input';
import type { Direction } from './layout';
import {
  DiagramEffect,
  allowedFields,
  crossingSection,
  crossingsAt,
  edgeFields,
  groupProblems,
  hintProblems,
  iconsField,
  judgeField,
  layoutHintFields,
  nodeFields,
  placeFields,
  placesNow,
  weightOf,
} from './model';
import {
  RECORD_EDGE_TYPES,
  RECORD_NODE_TYPES,
  edgeEnd,
  recordEdge,
  recordLint,
  recordNode,
  recordNodeFields,
  slotEntities,
  withOwners,
} from './records';
import { judgeSlotField, splitEnd } from './slots';

const NodeSchema = z.strictObject({
  id: IdSchema,
  label: z.string().min(1),
  /** A second, smaller line. */
  sub: z.string().optional(),
  /** The shape: a plain step, a decision, or a start/end. */
  kind: z.enum(['step', 'decision', 'terminal']).optional(),
  tone: z.enum(TONES).optional(),
  /** Pin the position. When every node is pinned, no layout runs. */
  x: z.number().optional(),
  y: z.number().optional(),
  ...recordNodeFields,
  /** Present before the first call. Defaults to the pane's `initial`. */
  initial: z.boolean().optional(),
  ...nodeFields,
  ...placeFields,
});

const EdgeSchema = z.strictObject({
  /** Defaults to "<from>.<to>". */
  id: IdSchema.optional(),
  /** A node id, or `<node>.<slot>` to start (or end) at one of the node's slots. */
  from: edgeEnd,
  to: edgeEnd,
  label: z.string().optional(),
  /** `false`: a reference, not a parent-child link. The tree layout ignores it; it is still drawn. */
  tree: z.boolean().optional(),
  initial: z.boolean().optional(),
  ...edgeFields,
});

function contentSchema(defaults: { initial: boolean; direction: Direction }) {
  return z.strictObject({
    nodes: z.array(NodeSchema).min(1),
    edges: z.array(EdgeSchema).default([]),
    direction: z.enum(['RIGHT', 'DOWN']).default(defaults.direction),
    /**
     * `tree` places nodes as a tree: children in the order of the slots they hang from. `hub` puts one
     * node in the middle with trees fanning out to its left and right.
     */
    layout: z.enum(['layered', 'tree', 'hub']).default('layered'),
    ...layoutHintFields,
    /** Whether elements are present before the first call unless they say otherwise. */
    initial: z.boolean().default(defaults.initial),
    /** Icons of this pane's own: name to path data (see the skill), usable as a node's `icon`. */
    icons: iconsField,
  });
}
type DiagramContent = z.infer<ReturnType<typeof contentSchema>>;

const edgeId = edgeIdOf;

function entitiesOf(content: DiagramContent) {
  return [
    ...content.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      initial: node.initial ?? content.initial,
    })),
    ...slotEntities(content.nodes),
    ...content.edges.map((edge) => ({
      id: edgeId(edge),
      label: edge.label ?? `${edge.from} → ${edge.to}`,
      initial: edge.initial ?? content.initial,
    })),
  ];
}

const badgeOf = (patched: unknown, declared: string | number | undefined) =>
  typeof patched === 'string' || typeof patched === 'number' ? patched : declared;

function DiagramPanelView({
  state,
  content,
  ctx,
}: {
  state: ElementsState;
  content: DiagramContent;
  ctx: PanelContext;
}) {
  // Sizes come from the declared text, so positions do not depend on the cursor.
  const sized = useMemo(
    () => sizesOf(ctx.pane.id, content, ctx.walkthrough.source),
    [content, ctx.pane.id, ctx.walkthrough.source],
  );
  const sizes = useMemo(() => new Map([...sized].map(([id, entry]) => [id, entry.size])), [sized]);
  const bases = useMemo(
    () => new Map(layoutNodesOf(content, sizes).map((node) => [node.id, node])),
    [content, sizes],
  );
  const options = useMemo(() => layoutOptionsOf(content), [content]);
  const records = useMemo(
    () =>
      new Map(
        content.nodes.map((node) => [node.id, { node, geometry: sized.get(node.id)?.geometry }]),
      ),
    [content, sized],
  );
  const crossings = useMemo(() => crossingsAt(content, state, edgeId), [content, state]);
  const places = useMemo(() => placesNow(content, state), [content, state]);
  const edges = useMemo<DiagramEdge[]>(
    () =>
      content.edges.map((edge) => ({
        id: edgeId(edge),
        source: edge.from,
        target: edge.to,
        label: edge.label,
        weight: weightOf(edge.weight, own(state.patches, edgeId(edge))?.weight),
        crosses: crossings.get(edgeId(edge)),
        tree: edge.tree,
        routing: edge.routing,
        fromSide: edge.fromSide,
        toSide: edge.toSide,
        ...(edge.from.includes('.') || edge.to.includes('.')
          ? recordEdge(edge, records, new Set(state.present))
          : {}),
      })),
    [content, state.patches, crossings, records, state.present],
  );
  const effects = ctx.current;
  const current = useMemo(() => touched(effects), [effects]);
  const framed = useMemo(() => withOwners(current, content.nodes), [current, content.nodes]);
  const selectedId = ctx.selection.id;
  const select = ctx.selection.select;
  const nodes = useMemo<DiagramNode[]>(
    () =>
      content.nodes.map((node) => {
        const patch = own(state.patches, node.id);
        const geometry = sized.get(node.id)?.geometry;
        return {
          ...(geometry === undefined
            ? {}
            : recordNode(node, geometry, {
                paneId: ctx.pane.id,
                nodes: content.nodes,
                edges: content.edges,
                walkthrough: ctx.walkthrough.source,
                state,
                current,
                selected: selectedId,
                select: (id) => select(selectedId === id ? undefined : id),
              })),
          ...bases.get(node.id)!,
          at: places.get(node.id),
          boundary: node.boundary,
          icon: resolveIcon(node.icon, content.icons),
          shape: isDisc(node) ? 'circle' : node.shape,
          badge: patch?.badge === undefined ? node.badge : badgeOf(patch.badge, node.badge),
          accent: node.accent,
          more: node.more,
          label: text(patch?.label) ?? node.label,
          sub: text(patch?.sub) ?? node.sub,
          tone: toneOf(patch?.tone, node.tone),
          kind: node.kind,
        };
      }),
    [
      content,
      bases,
      sized,
      state,
      current,
      selectedId,
      select,
      ctx.pane.id,
      ctx.walkthrough.source,
      places,
    ],
  );
  const present = useMemo(() => new Set(state.present), [state.present]);
  const reversed = useMemo(
    () =>
      new Set(effects.flatMap((effect) => (effect.reverse === true ? [effect.read ?? ''] : []))),
    [effects],
  );

  return (
    <Diagram
      nodes={nodes}
      edges={edges}
      present={present}
      current={framed}
      selection={ctx.selection}
      theme={ctx.theme}
      direction={content.direction}
      layout={content.layout}
      options={options}
      accents={content.accents as Record<string, string> | undefined}
      label={ctx.pane.title}
      call={ctx.call.id}
      reversed={reversed}
      nodeTypes={RECORD_NODE_TYPES}
      edgeTypes={RECORD_EDGE_TYPES}
    />
  );
}

export function createDiagramPanel(options: {
  id: string;
  initial: boolean;
  direction: Direction;
}): PanelType<DiagramContent, ElementsState> {
  return {
    id: options.id,
    schema: { content: contentSchema(options), effect: DiagramEffect },
    entities: entitiesOf,
    init: (content) => initElements(entitiesOf(content)),
    reduce: (state, effect) => reduceElements(state, effect),
    Component: DiagramPanelView,
    cardSections: ({ state, content, current, pane }) => [
      ...changesSection(
        pane.title,
        new Map(entitiesOf(content).map((entity) => [entity.id, entity.label])),
        current,
      ),
      ...crossingSection(content, state, current, edgeId),
    ],
    lint: (pane, walkthrough) => {
      const content = pane.content as DiagramContent;
      const nodes = new Set(content.nodes.map((node) => node.id));
      const index = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
      const problems: Problem[] = [];
      content.edges.forEach((edge, position) => {
        for (const end of ['from', 'to'] as const) {
          if (!nodes.has(splitEnd(edge[end]).node)) {
            problems.push({
              severity: 'error',
              rule: `${options.id}/unknown-node`,
              path: ['layout', 'panes', index, 'content', 'edges', position, end],
              message: `edge "${edgeId(edge)}" names node "${edge[end]}", which is not in this pane`,
            });
          }
        }
      });
      const edgeIds = new Set(content.edges.map(edgeId));
      const slots = new Set(slotEntities(content.nodes).map((entity) => entity.id));
      const allowed = allowedFields(content, edgeIds);
      problems.push(
        ...fieldProblems(
          pane,
          walkthrough,
          (id) => (slots.has(id) ? ['value', 'tone'] : allowed(id)),
          (id, field, value) =>
            slots.has(id) ? judgeSlotField(field, value) : judgeField(id, field, value),
        ),
        ...groupProblems(options.id, pane, walkthrough, content, edgeId),
        ...hintProblems(options.id, pane, walkthrough, content, edgeId),
        ...recordLint(
          pane,
          walkthrough,
          index,
          content.nodes,
          content.edges,
          (node) => node.initial ?? content.initial,
        ),
      );
      return problems;
    },
  };
}
