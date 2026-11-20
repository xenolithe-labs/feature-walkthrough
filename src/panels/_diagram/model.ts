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
import { crossingsOf, containerIds, parentMap, homeOf } from './groups';
import { CustomIconSchema, resolveIcon, type CustomIcon } from './icons';
import { isDense } from './layout';
import { isPlaced, resolveCells, type PlaceNode } from './place';

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
  /** How this edge is drawn, instead of the pane's `routing`. */
  routing: z.enum(['straight', 'orthogonal', 'curved']).optional(),
  /** The side of the `from` node the line leaves by. */
  fromSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
  /** The side of the `to` node the line arrives by. */
  toSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
};

/** The names an accent colour may have. Each must be explained in the pane's `accents`. */
export const ACCENTS = ['red', 'amber', 'violet', 'blue', 'teal'] as const;

const cellNumber = z.number().int().min(0).max(99);

/** How a node is placed and drawn, beyond a label. */
export const placeFields = {
  /** `first` or `last` layer of a layered layout. */
  rank: z.enum(['first', 'last']).optional(),
  /** Grid placement: `[column, row]`, whole numbers that only order (empty columns take no room). */
  cell: z.tuple([cellNumber, cellNumber]).optional(),
  /** Cells covered, `[columns, rows]`. */
  span: z.tuple([z.number().int().min(1).max(20), z.number().int().min(1).max(20)]).optional(),
  /** Placed in the cell to the right of this node (same group). */
  rightOf: IdSchema.optional(),
  /** Placed in the cell below this node (same group). */
  below: IdSchema.optional(),
  /** Placed in the same row as this node (same column if `below` also names a node). */
  alignWith: IdSchema.optional(),
  /** Which side of the hub a child of the hub goes to (`layout: "hub"`). */
  side: z.enum(['left', 'right']).optional(),
  /** `box` (default), `circle` (icon in a disc, label beneath) or `pill`. */
  shape: z.enum(['box', 'circle', 'pill']).optional(),
  /** A small count on the node's corner; an `update` may change it. */
  badge: z.union([z.string().max(8), z.number()]).optional(),
  /** A ring colour; the pane's `accents` must say what it means. */
  accent: z.enum(ACCENTS).optional(),
  /** Stands for this many children that are not drawn: a dashed disc reading "+N". */
  more: z.number().int().min(1).max(9999).optional(),
};

/** Pane-level hints. */
export const layoutHintFields = {
  /** How lines are drawn: `orthogonal` (default; right angles round the nodes), `curved` or `straight`. */
  routing: z.enum(['straight', 'orthogonal', 'curved']).optional(),
  /** How much room the layered layout leaves between nodes and layers. */
  spacing: z.enum(['compact', 'normal', 'roomy']).optional(),
  /** `declared`: nodes keep the order they were declared in, within a layer. */
  order: z.enum(['auto', 'declared']).optional(),
  /** What each accent colour means: name to a short phrase, shown as a key beside the diagram. */
  accents: z.partialRecord(z.enum(ACCENTS), z.string().min(1)).optional(),
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
  x?: number | undefined;
  y?: number | undefined;
  rank?: 'first' | 'last' | undefined;
  cell?: readonly [number, number] | undefined;
  span?: readonly [number, number] | undefined;
  rightOf?: string | undefined;
  below?: string | undefined;
  alignWith?: string | undefined;
  side?: 'left' | 'right' | undefined;
  shape?: 'box' | 'circle' | 'pill' | undefined;
  badge?: string | number | undefined;
  accent?: string | undefined;
  more?: number | undefined;
}
export interface ModelEdge {
  id?: string | undefined;
  from: string;
  to: string;
  label?: string | undefined;
  routing?: 'straight' | 'orthogonal' | 'curved' | undefined;
  fromSide?: 'top' | 'right' | 'bottom' | 'left' | undefined;
  toSide?: 'top' | 'right' | 'bottom' | 'left' | undefined;
}
export interface ModelContent {
  nodes: readonly ModelNode[];
  edges: readonly ModelEdge[];
  icons?: Readonly<Record<string, CustomIcon>> | undefined;
  layout?: 'layered' | 'tree' | 'hub' | undefined;
  routing?: 'straight' | 'orthogonal' | 'curved' | undefined;
  spacing?: 'compact' | 'normal' | 'roomy' | undefined;
  order?: 'auto' | 'declared' | undefined;
  accents?: Readonly<Record<string, string | undefined>> | undefined;
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
        ? ['label', 'sub', 'tone', 'badge']
        : ['label', 'sub', 'tone', 'badge', 'parent'];
    }
    return edgeIds.has(id) ? ['weight'] : [];
  };
}

/** Judges the values of the fields groups and edges add; leaves the others to the default check. */
export function judgeField(id: string, field: string, value: unknown): string | null | undefined {
  // A move is checked by `moveProblems`, which names the parents that are allowed.
  if (field === 'parent') return null;
  if (field === 'badge') {
    return typeof value === 'string'
      ? value.length <= 8
        ? null
        : `the badge of "${id}" is at most 8 characters`
      : typeof value === 'number' && Number.isFinite(value)
        ? null
        : `the badge of "${id}" is a short string or a number`;
  }
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

/** Where a node sits for placement: the group it starts in (or the top). */
const holderOf = (node: ModelNode): string => homeOf(node) ?? '';

/**
 * Problems with the hints that steer the layout: placement on the grid, pins, sides, ranks,
 * accents. Pure and synchronous, so `loadConfig` reports them; what the layout then did with the
 * diagram is `layoutProblems` (layout-lint.ts), which needs ELK and is asynchronous.
 */
export function hintProblems(
  panel: string,
  pane: ResolvedPane,
  walkthrough: Walkthrough,
  content: ModelContent,
  edgeId: (edge: ModelEdge) => string,
): Problem[] {
  const index = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
  const base = ['layout', 'panes', index, 'content'];
  const problems: Problem[] = [];
  const add = (
    severity: Problem['severity'],
    rule: string,
    path: (string | number)[],
    message: string,
  ): void => {
    problems.push({ severity, rule: `${panel}/${rule}`, path, message });
  };
  const mode = content.layout ?? 'layered';
  const where = new Map(content.nodes.map((node, position) => [node.id, position]));
  const nodeAt = (id: string) => [...base, 'nodes', where.get(id) ?? 0];

  // Grid placement, group by group: names, cycles, cells held twice.
  const groups = new Map<string, ModelNode[]>();
  for (const node of content.nodes) {
    const list = groups.get(holderOf(node)) ?? [];
    list.push(node);
    groups.set(holderOf(node), list);
  }
  const grid = content.nodes.some((node) => isPlaced(node as PlaceNode & ModelNode));
  const ends = content.edges.map((edge) => ({
    source: edge.from.split('.')[0]!,
    target: edge.to.split('.')[0]!,
  }));
  for (const members of groups.values()) {
    if (!members.some((node) => isPlaced(node as PlaceNode & ModelNode))) continue;
    const found = resolveCells(
      members.map((node) => ({ ...node, width: 100, height: 40 })),
      ends,
      'RIGHT',
    );
    for (const item of found.problems) {
      const field =
        item.rule === 'cell-taken'
          ? 'cell'
          : ((['rightOf', 'below', 'alignWith'] as const).find(
              (name) => members.find((node) => node.id === item.node)?.[name] === item.other,
            ) ?? 'rightOf');
      add('error', item.rule, [...nodeAt(item.node), field], item.message);
    }
  }
  for (const node of content.nodes) {
    for (const name of ['rightOf', 'below', 'alignWith'] as const) {
      if (node[name] === node.id) {
        add(
          'error',
          'unknown-anchor',
          [...nodeAt(node.id), name],
          `"${node.id}" cannot be placed relative to itself`,
        );
      }
    }
    if (node.span !== undefined && !isPlaced(node as PlaceNode & ModelNode)) {
      add(
        'warning',
        'span-without-cell',
        [...nodeAt(node.id), 'span'],
        `"${node.id}" has a span but no cell, rightOf, below or alignWith: the span is not used`,
      );
    }
  }

  // Pins that the layout cannot honour are said so, not dropped silently.
  const pins = content.nodes.filter((node) => node.x !== undefined || node.y !== undefined);
  const allPinned = content.nodes.every((node) => node.x !== undefined && node.y !== undefined);
  if (pins.length > 0 && !allPinned) {
    const grouped = content.nodes.some(
      (node) => node.parent !== undefined || node.parents !== undefined,
    );
    const why = grid
      ? 'the diagram places nodes on a grid'
      : mode !== 'layered'
        ? `the layout is "${mode}"`
        : grouped
          ? 'the diagram has groups'
          : isDense(content.nodes.length, content.edges.length)
            ? 'the diagram is too dense for ELK'
            : undefined;
    if (why !== undefined) {
      for (const node of pins) {
        add(
          'warning',
          'pin-ignored',
          [...nodeAt(node.id), node.x === undefined ? 'y' : 'x'],
          `"${node.id}" is pinned but ${why}: a pin is used only when every node is pinned. Pin every node, or drop the pins`,
        );
      }
    }
  }

  // Hints with nothing to act on.
  const placedAll = grid || pins.length === content.nodes.length;
  const layered = mode === 'layered' && !placedAll;
  const ignore = (path: (string | number)[], what: string, why: string) =>
    add('warning', 'hint-ignored', path, `${what} has no effect: ${why}`);
  const paneWhy = grid
    ? 'this diagram places nodes on a grid'
    : mode === 'layered'
      ? 'every node is pinned'
      : `the layout is "${mode}"`;
  if (!layered) {
    if (content.spacing !== undefined) ignore([...base, 'spacing'], '"spacing"', paneWhy);
    if (content.order !== undefined) ignore([...base, 'order'], '"order"', paneWhy);
    for (const node of content.nodes) {
      if (node.rank !== undefined)
        ignore([...nodeAt(node.id), 'rank'], `"rank" of "${node.id}"`, paneWhy);
    }
  }
  if (mode === 'tree') {
    if (content.routing !== undefined)
      ignore([...base, 'routing'], '"routing"', 'a tree layout draws straight lines');
    content.edges.forEach((edge, position) => {
      for (const field of ['routing', 'fromSide', 'toSide'] as const) {
        if (edge[field] !== undefined)
          ignore(
            [...base, 'edges', position, field],
            `"${field}" of edge "${edgeId(edge)}"`,
            'a tree layout draws straight lines',
          );
      }
    });
  }
  if (mode === 'hub') {
    content.edges.forEach((edge, position) => {
      for (const field of ['fromSide', 'toSide'] as const) {
        if (edge[field] !== undefined)
          ignore(
            [...base, 'edges', position, field],
            `"${field}" of edge "${edgeId(edge)}"`,
            'a hub layout draws its own curves',
          );
      }
    });
  }
  if (mode !== 'hub') {
    for (const node of content.nodes) {
      if (node.side !== undefined)
        ignore(
          [...nodeAt(node.id), 'side'],
          `"side" of "${node.id}"`,
          'it only places children of the hub, and this layout is not "hub"',
        );
    }
  }

  // Colour never carries meaning alone: every accent used is explained.
  const named = content.accents ?? {};
  for (const node of content.nodes) {
    if (node.accent !== undefined && named[node.accent] === undefined) {
      add(
        'error',
        'unknown-accent',
        [...nodeAt(node.id), 'accent'],
        `"${node.id}" has accent "${node.accent}", which the pane's "accents" does not explain: say what each colour means`,
      );
    }
  }
  return problems;
}
