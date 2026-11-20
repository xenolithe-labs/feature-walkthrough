/**
 * The tree's derived values: where each node sits now (a move changes it), which rows are shown,
 * how deep, which connector lines each row draws, and what a collapsed node hides. Pure, so that
 * the view, the lint and the tests share one answer.
 */
import { own } from '../../core';

export interface NodeDecl {
  id: string;
  parent?: string | undefined;
  /** Nodes this one may be moved under. Its declared parent is always allowed too. */
  parents?: string[] | undefined;
  collapsed?: boolean | undefined;
}

type Patches = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** The parent of a node now: a move (an `update` of `parent`) wins over the declared parent. */
export function parentOf(
  node: NodeDecl,
  patches: Patches,
  known: ReadonlySet<string>,
): string | undefined {
  const moved = own(patches, node.id)?.parent;
  const parent = typeof moved === 'string' ? moved : node.parent;
  return parent !== undefined && known.has(parent) ? parent : undefined;
}

/** Children by parent in declaration order, `undefined` holding the top level. */
export function childrenOf<N extends NodeDecl>(
  nodes: readonly N[],
  patches: Patches,
): Map<string | undefined, N[]> {
  const known = new Set(nodes.map((node) => node.id));
  const map = new Map<string | undefined, N[]>();
  for (const node of nodes) {
    const parent = parentOf(node, patches, known);
    const list = map.get(parent) ?? [];
    list.push(node);
    map.set(parent, list);
  }
  return map;
}

/** The ids above a node, nearest first. Stops if the parents loop, which lint rejects. */
export function ancestorsOf(
  id: string,
  parents: ReadonlyMap<string, string | undefined>,
): string[] {
  const up: string[] = [];
  const seen = new Set([id]);
  for (let at = parents.get(id); at !== undefined && !seen.has(at); at = parents.get(at)) {
    up.push(at);
    seen.add(at);
  }
  return up;
}

/** Ids of every node that is the parent of something, ancestors of `ids` included. */
export function openedBy(
  ids: Iterable<string>,
  parents: ReadonlyMap<string, string | undefined>,
): Set<string> {
  const open = new Set<string>();
  for (const id of ids) for (const up of ancestorsOf(id, parents)) open.add(up);
  return open;
}

/** What a row draws in the column of one level, left of its label. */
export type Guide = 'none' | 'pass' | 'tee' | 'elbow';

export interface TreeRow {
  id: string;
  /** 0 for a top-level node. */
  depth: number;
  /** False for a node that is absent: its row is kept, but empty. */
  shown: boolean;
  /** The node has children, shown or not. */
  hasChildren: boolean;
  /** Children are listed below it. */
  open: boolean;
  /** For a collapsed node: how many shown nodes it hides. */
  hidden: number;
  /** Of those, how many the current call touched. */
  hiddenTouched: number;
  /** One entry per level up to and including the row's own: the connector lines. */
  guides: Guide[];
  /** The node was opened for this call because it holds a touched node. */
  openedByCall: boolean;
}

export interface RowsInput<N extends NodeDecl> {
  nodes: readonly N[];
  patches: Patches;
  /** Nodes that are present (or being removed by this call). */
  shown: ReadonlySet<string>;
  /** Nodes the current call touches. */
  touched: ReadonlySet<string>;
  /** The reader's own opening and closing during this call. It beats everything else. */
  overrides?: Readonly<Record<string, boolean>> | undefined;
}

/**
 * Whether a node is open. In order: the reader's own choice for this call; open when the call
 * touches something inside it; else its `collapsed` field, as patched by earlier calls.
 */
export function isOpen(
  node: NodeDecl,
  patches: Patches,
  forced: ReadonlySet<string>,
  overrides: Readonly<Record<string, boolean>> | undefined,
): boolean {
  const chosen = own(overrides, node.id);
  if (chosen !== undefined) return chosen;
  if (forced.has(node.id)) return true;
  const patched = own(patches, node.id)?.collapsed;
  return !(typeof patched === 'boolean' ? patched : (node.collapsed ?? false));
}

/**
 * The rows to draw, top to bottom. A collapsed node's descendants have no row; every other node
 * keeps its row whether it is present or not, so nothing moves when one appears.
 */
export function treeRows<N extends NodeDecl>(input: RowsInput<N>): TreeRow[] {
  const { nodes, patches, shown, touched, overrides } = input;
  const children = childrenOf(nodes, patches);
  const known = new Set(nodes.map((node) => node.id));
  const parents = new Map(nodes.map((node) => [node.id, parentOf(node, patches, known)]));
  const forced = openedBy(touched, parents);

  const below = (id: string): string[] =>
    (children.get(id) ?? []).flatMap((child) => [child.id, ...below(child.id)]);
  const rows: TreeRow[] = [];
  const visited = new Set<string>();

  const walk = (list: readonly N[], depth: number, lines: Guide[]) => {
    list.forEach((node, position) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      const kids = children.get(node.id) ?? [];
      const open = kids.length === 0 || isOpen(node, patches, forced, overrides);
      const isShown = shown.has(node.id);
      const laterShown = list.slice(position + 1).some((sibling) => shown.has(sibling.id));
      const self: Guide = isShown ? (laterShown ? 'tee' : 'elbow') : laterShown ? 'pass' : 'none';
      const hiddenIds = open ? [] : below(node.id).filter((id) => shown.has(id));
      rows.push({
        id: node.id,
        depth,
        shown: isShown,
        hasChildren: kids.length > 0,
        open,
        hidden: hiddenIds.length,
        hiddenTouched: hiddenIds.filter((id) => touched.has(id)).length,
        guides: [...lines, self],
        openedByCall:
          kids.length > 0 &&
          open &&
          forced.has(node.id) &&
          own(overrides, node.id) === undefined &&
          collapsedByState(node, patches),
      });
      if (open) {
        // Below this row, its own level continues as a line while a later sibling is shown.
        walk(kids, depth + 1, [...lines, laterShown ? 'pass' : 'none']);
      }
    });
  };
  walk(children.get(undefined) ?? [], 0, []);
  return rows;
}

function collapsedByState(node: NodeDecl, patches: Patches): boolean {
  const patched = own(patches, node.id)?.collapsed;
  return typeof patched === 'boolean' ? patched : (node.collapsed ?? false);
}

/** The ids a node may be moved under: its declared candidates, and where it was declared. */
export function candidateParents(node: NodeDecl): string[] {
  return [
    ...new Set([...(node.parents ?? []), ...(node.parent === undefined ? [] : [node.parent])]),
  ];
}
