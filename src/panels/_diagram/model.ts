/**
 * What the diagram panels add to a node-and-edge pane: the fields groups, boundaries, icons and
 * moves need, what is derived from them at a cursor, and the lint rules that check them.
 * panel.tsx wires these in; everything here is plain data in, plain data out.
 */
import { z } from 'zod';
import {
  EffectSchema,
  IdSchema,
  touched,
  type CardSection,
  effectTarget,
  own,
  writtenEffects,
  type Effect,
  type ElementsState,
  type Problem,
  type ResolvedPane,
  type Walkthrough,
} from '../../core';
import { crossingsOf, containerIds, parentMap } from './groups';
import { CustomIconSchema, resolveIcon, type CustomIcon } from './icons';

/** The widest an edge may be drawn, in pixels. */
export const MAX_WEIGHT = 12;
export const MIN_WEIGHT = 0.5;

/** Fields a node may have beyond a label: where it sits, what it is drawn as. */
export const nodeFields = {
  /** The group this node is drawn inside. */
  parent: IdSchema.optional(),
  /** Every group the node may ever sit in. `update` with `fields.parent` moves it between them. */
  parents: z.array(IdSchema).min(1).optional(),
  /** Draw a node that holds others as a trust boundary or network zone. */
  boundary: z.boolean().optional(),
  /** A built-in icon name, or a key of the pane's `icons`. */
  icon: z.string().min(1).optional(),
};

export const edgeFields = {
  /** Stroke width in pixels (traffic, volume). */
  weight: z.number().min(MIN_WEIGHT).max(MAX_WEIGHT).optional(),
};

export const iconsField = z.record(IdSchema, CustomIconSchema).optional();

/** The shared effect shape, and `reverse` on the `read` of an edge: the dot runs target to source. */
export const DiagramEffect = EffectSchema.and(
  z.looseObject({ reverse: z.boolean().optional() }),
) as unknown as z.ZodType<Effect>;

export interface ModelNode {
  id: string;
  label: string;
  parent?: string | undefined;
  parents?: readonly string[] | undefined;
  boundary?: boolean | undefined;
  icon?: string | undefined;
}
export interface ModelEdge {
  id?: string | undefined;
  from: string;
  to: string;
  label?: string | undefined;
}
export interface ModelContent {
  nodes: readonly ModelNode[];
  edges: readonly ModelEdge[];
  icons?: Readonly<Record<string, CustomIcon>> | undefined;
}

/** Where each node that may move sits at a cursor: the last valid `fields.parent`. */
export function placesNow(content: ModelContent, state: ElementsState): Map<string, string> {
  const at = new Map<string, string>();
  for (const node of content.nodes) {
    const moved = own(state.patches, node.id)?.parent;
    if (typeof moved === 'string' && node.parents?.includes(moved) === true) at.set(node.id, moved);
  }
  return at;
}

/** The boundaries each edge crosses at a cursor, by edge id. Never written, always derived. */
export function crossingsAt(
  content: ModelContent,
  state: ElementsState,
  edgeId: (edge: ModelEdge) => string,
): Map<string, string[]> {
  const boundaries = new Set(content.nodes.filter((node) => node.boundary).map((node) => node.id));
  return crossingsOf(
    boundaries,
    content.edges.map((edge) => ({ id: edgeId(edge), source: edge.from, target: edge.to })),
    parentMap(content.nodes, placesNow(content, state)),
  );
}

/** A card section that names the boundaries the edges this call touches cross. */
export function crossingSection(
  content: ModelContent,
  state: ElementsState,
  current: readonly Effect[],
  edgeId: (edge: ModelEdge) => string,
): CardSection[] {
  const crossings = crossingsAt(content, state, edgeId);
  if (crossings.size === 0) return [];
  const marks = touched([...current]);
  const names = new Map(content.nodes.map((node) => [node.id, node.label]));
  const items = content.edges.flatMap((edge) => {
    const id = edgeId(edge);
    const crossed = crossings.get(id);
    if (crossed === undefined) return [];
    if (!(marks.added.has(id) || marks.read.has(id) || marks.updated.has(id))) return [];
    const zones = crossed.map((group) => names.get(group) ?? group).join(', ');
    return [{ label: `${edge.label ?? `${edge.from} → ${edge.to}`} crosses ${zones}`, entity: id }];
  });
  return items.length === 0
    ? []
    : [{ id: 'crossings', title: 'Crosses a boundary', kind: 'list', items }];
}

/** The width an edge is drawn at: its `weight` now, if it has one. */
export function weightOf(declared: number | undefined, patched: unknown): number | undefined {
  const weight = typeof patched === 'number' ? patched : declared;
  return weight !== undefined && Number.isFinite(weight) ? weight : undefined;
}

/** Fields an element takes in `update`. */
export function allowedFields(content: ModelContent, edgeIds: ReadonlySet<string>) {
  const nodes = new Map(content.nodes.map((node) => [node.id, node]));
  return (id: string): readonly string[] => {
    const node = nodes.get(id);
    if (node !== undefined) {
      return node.parents === undefined
        ? ['label', 'sub', 'tone']
        : ['label', 'sub', 'tone', 'parent'];
    }
    return edgeIds.has(id) ? ['weight'] : [];
  };
}

/** Judges the values of the fields groups and edges add; leaves the others to the default check. */
export function judgeField(id: string, field: string, value: unknown): string | null | undefined {
  // A move is checked by `moveProblems`, which names the parents that are allowed.
  if (field === 'parent') return null;
  if (field === 'weight') {
    return typeof value === 'number' && value >= MIN_WEIGHT && value <= MAX_WEIGHT
      ? null
      : `the weight of "${id}" is a number from ${MIN_WEIGHT} to ${MAX_WEIGHT}`;
  }
  return undefined;
}

type Parents = Map<string, Set<string>>;

/** Every parent a node may ever have, from `parent` and `parents`. */
function possibleParents(content: ModelContent): Parents {
  return new Map(
    content.nodes.map((node) => [
      node.id,
      new Set([...(node.parent === undefined ? [] : [node.parent]), ...(node.parents ?? [])]),
    ]),
  );
}

/** Everything above a node, through any parent it may have. */
function possibleAncestors(id: string, parents: Parents): Set<string> {
  const found = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    for (const next of parents.get(queue.pop()!) ?? []) {
      if (found.has(next)) continue;
      found.add(next);
      queue.push(next);
    }
  }
  return found;
}

/** Problems with groups, icons, moves and traffic in one pane. `rule` names are `<panel>/<rule>`. */
export function groupProblems(
  panel: string,
  pane: ResolvedPane,
  walkthrough: Walkthrough,
  content: ModelContent,
  edgeId: (edge: ModelEdge) => string,
): Problem[] {
  const index = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
  const base = ['layout', 'panes', index, 'content'];
  const problems: Problem[] = [];
  const nodes = new Map(content.nodes.map((node) => [node.id, node]));
  const parents = possibleParents(content);
  const error = (rule: string, path: (string | number)[], message: string): void => {
    problems.push({ severity: 'error', rule: `${panel}/${rule}`, path, message });
  };

  content.nodes.forEach((node, position) => {
    const at = [...base, 'nodes', position];
    if (node.parent !== undefined && !nodes.has(node.parent)) {
      error(
        'unknown-parent',
        [...at, 'parent'],
        `"${node.id}" has parent "${node.parent}", which is not a node in this pane`,
      );
    }
    node.parents?.forEach((parent, slot) => {
      if (!nodes.has(parent)) {
        error(
          'unknown-parent',
          [...at, 'parents', slot],
          `"${node.id}" may sit in "${parent}", which is not a node in this pane`,
        );
      }
    });
    if (
      node.parents !== undefined &&
      node.parent !== undefined &&
      !node.parents.includes(node.parent)
    ) {
      error(
        'parent-not-listed',
        [...at, 'parent'],
        `"${node.id}" starts in "${node.parent}", which is not one of its parents: ${node.parents.join(', ')}`,
      );
    }
    if (possibleAncestors(node.id, parents).has(node.id)) {
      error(
        'parent-cycle',
        [...at, node.parent === undefined ? 'parents' : 'parent'],
        `"${node.id}" is inside itself through its parents`,
      );
    }
    if (node.icon !== undefined && resolveIcon(node.icon, content.icons) === undefined) {
      error(
        'unknown-icon',
        [...at, 'icon'],
        `icon "${node.icon}" is not built in and not in this pane's "icons"`,
      );
    }
  });

  const holders = containerIds(content.nodes);
  content.nodes.forEach((node, position) => {
    if (node.boundary === true && !holders.has(node.id)) {
      problems.push({
        severity: 'warning',
        rule: `${panel}/empty-boundary`,
        path: [...base, 'nodes', position, 'boundary'],
        message: `"${node.id}" is a boundary but no node names it as a parent`,
      });
    }
  });

  content.edges.forEach((edge, position) => {
    const from = possibleAncestors(edge.from, parents);
    const to = possibleAncestors(edge.to, parents);
    if (edge.from !== edge.to && (from.has(edge.to) || to.has(edge.from))) {
      error(
        'edge-inside-group',
        [...base, 'edges', position],
        `edge "${edgeId(edge)}" joins "${edge.from}" and "${edge.to}", one of which holds the other`,
      );
    }
  });

  const edgeIds = new Set(content.edges.map(edgeId));
  walkthrough.steps.forEach((step, s) => {
    step.calls.forEach((call, c) => {
      writtenEffects(call, pane.id).forEach((effect, e) => {
        const path = ['steps', s, 'calls', c, 'effects', pane.id, e];
        const { verb, id } = effectTarget(effect);
        if (effect.reverse !== undefined && !(verb === 'read' && edgeIds.has(id))) {
          error(
            'bad-reverse',
            [...path, 'reverse'],
            '"reverse" belongs to a "read" of an edge: it runs the dot from target to source',
          );
        }
        const moved = effect.fields === undefined ? undefined : own(effect.fields, 'parent');
        const node = nodes.get(id);
        if (moved !== undefined && node?.parents !== undefined) {
          if (typeof moved !== 'string' || !node.parents.includes(moved)) {
            error(
              'move-outside-parents',
              [...path, 'fields', 'parent'],
              `"${id}" may sit in ${node.parents.join(', ')}; ${JSON.stringify(moved)} is not one of them`,
            );
          }
        }
      });
    });
  });
  return problems;
}
