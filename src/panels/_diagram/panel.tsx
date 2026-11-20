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
import { estimateSize, type Direction } from './layout';

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
  /** Present before the first call. Defaults to the pane's `initial`. */
  initial: z.boolean().optional(),
});

const EdgeSchema = z.strictObject({
  /** Defaults to "<from>.<to>". */
  id: IdSchema.optional(),
  from: IdSchema,
  to: IdSchema,
  label: z.string().optional(),
  initial: z.boolean().optional(),
});

function contentSchema(defaults: { initial: boolean; direction: Direction }) {
  return z.strictObject({
    nodes: z.array(NodeSchema).min(1),
    edges: z.array(EdgeSchema).default([]),
    direction: z.enum(['RIGHT', 'DOWN']).default(defaults.direction),
    /** Whether elements are present before the first call unless they say otherwise. */
    initial: z.boolean().default(defaults.initial),
  });
}
type DiagramContent = z.infer<ReturnType<typeof contentSchema>>;

const edgeId = (edge: { id?: string | undefined; from: string; to: string }) =>
  edge.id ?? `${edge.from}.${edge.to}`;

function entitiesOf(content: DiagramContent) {
  return [
    ...content.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      initial: node.initial ?? content.initial,
    })),
    ...content.edges.map((edge) => ({
      id: edgeId(edge),
      label: edge.label ?? `${edge.from} → ${edge.to}`,
      initial: edge.initial ?? content.initial,
    })),
  ];
}

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
  const sizes = useMemo(
    () =>
      new Map(content.nodes.map((node) => [node.id, estimateSize(node.label, node.sub ?? ' ')])),
    [content],
  );
  const edges = useMemo<DiagramEdge[]>(
    () =>
      content.edges.map((edge) => ({
        id: edgeId(edge),
        source: edge.from,
        target: edge.to,
        label: edge.label,
      })),
    [content],
  );
  const nodes = useMemo<DiagramNode[]>(
    () =>
      content.nodes.map((node) => {
        const patch = own(state.patches, node.id);
        return {
          id: node.id,
          ...sizes.get(node.id)!,
          x: node.x,
          y: node.y,
          label: text(patch?.label) ?? node.label,
          sub: text(patch?.sub) ?? node.sub,
          tone: toneOf(patch?.tone, node.tone),
          kind: node.kind,
        };
      }),
    [content, sizes, state.patches],
  );
  const present = useMemo(() => new Set(state.present), [state.present]);
  const effects = ctx.current;
  const current = useMemo(() => touched(effects), [effects]);

  return (
    <Diagram
      nodes={nodes}
      edges={edges}
      present={present}
      current={current}
      selection={ctx.selection}
      theme={ctx.theme}
      direction={content.direction}
      label={ctx.pane.title}
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
    schema: { content: contentSchema(options) },
    entities: entitiesOf,
    init: (content) => initElements(entitiesOf(content)),
    reduce: (state, effect) => reduceElements(state, effect),
    Component: DiagramPanelView,
    cardSections: ({ content, current, pane }) =>
      changesSection(
        pane.title,
        new Map(entitiesOf(content).map((entity) => [entity.id, entity.label])),
        current,
      ),
    lint: (pane, walkthrough) => {
      const content = pane.content as DiagramContent;
      const nodes = new Set(content.nodes.map((node) => node.id));
      const index = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
      const problems: Problem[] = [];
      content.edges.forEach((edge, position) => {
        for (const end of ['from', 'to'] as const) {
          if (!nodes.has(edge[end])) {
            problems.push({
              severity: 'error',
              rule: `${options.id}/unknown-node`,
              path: ['layout', 'panes', index, 'content', 'edges', position, end],
              message: `edge "${edgeId(edge)}" names node "${edge[end]}", which is not in this pane`,
            });
          }
        }
      });
      problems.push(
        ...fieldProblems(pane, walkthrough, (id) =>
          nodes.has(id) ? ['label', 'sub', 'tone'] : [],
        ),
      );
      return problems;
    },
  };
}
