/**
 * graph: nodes and the relationships between them.
 *
 * `content` lists every node and edge the pane can ever show. Effects add,
 * read, update and remove them by id. An edge is drawn only while both of
 * its ends are present, so removing a node needs no extra edge effects.
 */
import { useMemo } from 'react';
import { z } from 'zod';
import {
  IdSchema,
  effectTarget,
  initElements,
  reduceElements,
  touched,
  type CardSection,
  type ElementsState,
  type PanelContext,
  type PanelType,
  type Problem,
} from '../../core';
import { Diagram, type DiagramEdge, type DiagramNode } from '../_diagram/Diagram';
import { estimateSize } from '../_diagram/layout';

const GraphNode = z.strictObject({
  id: IdSchema,
  label: z.string().min(1),
  /** A second, smaller line. */
  sub: z.string().optional(),
  /** "muted" draws the node as spent. */
  tone: z.enum(['muted']).optional(),
  /** Pin the position. When every node is pinned, no layout runs. */
  x: z.number().optional(),
  y: z.number().optional(),
  initial: z.boolean().optional(),
});

const GraphEdge = z.strictObject({
  id: IdSchema,
  from: IdSchema,
  to: IdSchema,
  label: z.string().optional(),
  initial: z.boolean().optional(),
});

const GraphContent = z.strictObject({
  nodes: z.array(GraphNode).min(1),
  edges: z.array(GraphEdge).default([]),
  direction: z.enum(['RIGHT', 'DOWN']).default('RIGHT'),
});
type GraphContent = z.infer<typeof GraphContent>;

function entitiesOf(content: GraphContent) {
  return [
    ...content.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      ...(node.initial ? { initial: true } : {}),
    })),
    ...content.edges.map((edge) => ({
      id: edge.id,
      label: edge.label ?? `${edge.from} → ${edge.to}`,
      ...(edge.initial ? { initial: true } : {}),
    })),
  ];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function GraphView({
  state,
  content,
  ctx,
}: {
  state: ElementsState;
  content: GraphContent;
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
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label,
      })),
    [content],
  );
  const nodes = useMemo<DiagramNode[]>(
    () =>
      content.nodes.map((node) => {
        const patch = state.patches[node.id];
        return {
          id: node.id,
          ...sizes.get(node.id)!,
          x: node.x,
          y: node.y,
          label: text(patch?.label) ?? node.label,
          sub: text(patch?.sub) ?? node.sub,
          tone: text(patch?.tone) ?? node.tone,
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

const VERB_MARK = { add: 'added', update: 'updated', read: 'read', remove: 'removed' } as const;

export const graphPanel: PanelType<GraphContent, ElementsState> = {
  id: 'graph',
  schema: { content: GraphContent },
  entities: entitiesOf,
  init: (content) => initElements(entitiesOf(content)),
  reduce: (state, effect) => reduceElements(state, effect),
  Component: GraphView,
  cardSections: ({ content, current, pane }) => {
    const labels = new Map(entitiesOf(content).map((entity) => [entity.id, entity.label]));
    const items: Extract<CardSection, { kind: 'list' }>['items'] = [];
    for (const effect of current) {
      const { verb, id } = effectTarget(effect);
      if (id === undefined || verb === 'focus' || verb === 'set') continue;
      items.push({ label: labels.get(id) ?? id, entity: id, mark: VERB_MARK[verb] });
    }
    return items.length === 0 ? [] : [{ id: 'changes', title: pane.title, kind: 'list', items }];
  },
  lint: (pane, walkthrough) => {
    const content = pane.content as GraphContent;
    const nodes = new Set(content.nodes.map((node) => node.id));
    const index = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
    const problems: Problem[] = [];
    content.edges.forEach((edge, position) => {
      for (const end of ['from', 'to'] as const) {
        if (!nodes.has(edge[end])) {
          problems.push({
            severity: 'error',
            rule: 'graph/unknown-node',
            path: ['layout', 'panes', index, 'content', 'edges', position, end],
            message: `edge "${edge.id}" names node "${edge[end]}", which is not in this pane`,
          });
        }
      }
    });
    return problems;
  },
};
