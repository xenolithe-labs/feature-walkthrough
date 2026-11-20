/**
 * Placement on a grid, for an author who cannot see the picture and should not do pixel arithmetic.
 *
 * A node may say `cell: [column, row]` (small whole numbers, they only order the cells: an empty
 * column or row takes no room, so `[1, 1]` and `[0, 0]` are the same picture), and `span: [columns,
 * rows]` to cover more than one cell. Or it says where it is relative to another node of the same
 * group: `rightOf`, `below`, `alignWith`. Column widths and row heights come from the nodes in them,
 * so text never overlaps.
 *
 * Mixed use: as soon as any node of a container has a cell or a relative place, the container is
 * placed by this grid and not by ELK. A node with none of these goes into the first free cell, in
 * the column (row, for a downward diagram) one past its furthest placed predecessor.
 *
 * Everything here is pure and deterministic.
 */
import type { Direction } from './layout';

export interface PlaceNode {
  id: string;
  width: number;
  height: number;
  cell?: readonly [number, number] | undefined;
  span?: readonly [number, number] | undefined;
  rightOf?: string | undefined;
  below?: string | undefined;
  alignWith?: string | undefined;
}

export interface Cell {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export interface PlaceProblem {
  rule: 'cell-taken' | 'placement-cycle' | 'unknown-anchor';
  /** The node the problem is about. */
  node: string;
  /** The other node, if there is one. */
  other?: string;
  message: string;
}

export const GRID_GAP = { x: 64, y: 44 } as const;

/** Whether the node asks to be placed by hand, on the grid. */
export const isPlaced = (node: PlaceNode): boolean =>
  node.cell !== undefined ||
  node.rightOf !== undefined ||
  node.below !== undefined ||
  node.alignWith !== undefined;

export const spanOf = (node: PlaceNode): { cols: number; rows: number } => ({
  cols: Math.max(1, node.span?.[0] ?? 1),
  rows: Math.max(1, node.span?.[1] ?? 1),
});

/** The cell of every node of one container, and what was wrong on the way. */
export function resolveCells(
  nodes: readonly PlaceNode[],
  edges: readonly { source: string; target: string }[],
  direction: Direction,
): { cells: Map<string, Cell>; problems: PlaceProblem[] } {
  const problems: PlaceProblem[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const cells = new Map<string, Cell>();
  const partial = new Map<string, { col?: number; row?: number }>();
  const taken = new Map<string, string>();
  const key = (col: number, row: number) => `${col},${row}`;
  const claim = (id: string, cell: Cell) => {
    for (let c = cell.col; c < cell.col + cell.cols; c += 1) {
      for (let r = cell.row; r < cell.row + cell.rows; r += 1) taken.set(key(c, r), id);
    }
  };
  const free = (cell: Cell) => {
    for (let c = cell.col; c < cell.col + cell.cols; c += 1) {
      for (let r = cell.row; r < cell.row + cell.rows; r += 1) {
        if (taken.has(key(c, r))) return false;
      }
    }
    return true;
  };
  const across = direction === 'RIGHT' ? 'row' : 'col';
  // Put a node in a cell, or in the next free one along the cross axis, saying so when it had to move.
  const put = (node: PlaceNode, col: number, row: number) => {
    const { cols, rows } = spanOf(node);
    const cell: Cell = { col, row, cols, rows };
    let moved = false;
    let blocker: string | undefined;
    while (!free(cell)) {
      for (let c = cell.col; c < cell.col + cols; c += 1) {
        for (let r = cell.row; r < cell.row + rows; r += 1) blocker ??= taken.get(key(c, r));
      }
      if (across === 'row') cell.row += 1;
      else cell.col += 1;
      moved = true;
    }
    if (moved) {
      problems.push({
        rule: 'cell-taken',
        node: node.id,
        ...(blocker === undefined ? {} : { other: blocker }),
        message: `"${node.id}" belongs in cell [${col}, ${row}], which "${blocker}" already holds; it was moved to [${cell.col}, ${cell.row}]`,
      });
    }
    cells.set(node.id, cell);
    claim(node.id, cell);
  };

  // A node with a place on one axis only, or none: the first free cell, one column past its
  // furthest placed predecessor.
  const into = direction === 'RIGHT' ? 'col' : 'row';
  const autoPlace = (node: PlaceNode) => {
    const given = partial.get(node.id) ?? {};
    let along = given[into];
    if (along === undefined) {
      along = 0;
      for (const edge of edges) {
        if (edge.target !== node.id) continue;
        const before = cells.get(edge.source);
        if (before === undefined) continue;
        const reach = into === 'col' ? before.col + before.cols : before.row + before.rows;
        along = Math.max(along, reach);
      }
    }
    let slot = given[across] ?? 0;
    const { cols, rows } = spanOf(node);
    const at = (a: number, b: number): Cell =>
      into === 'col' ? { col: a, row: b, cols, rows } : { col: b, row: a, cols, rows };
    while (!free(at(along, slot))) slot += 1;
    const cell = at(along, slot);
    cells.set(node.id, cell);
    claim(node.id, cell);
  };

  // 1. Cells given outright, in declaration order (the first to ask keeps the cell).
  for (const node of nodes) {
    if (node.cell !== undefined) put(node, node.cell[0], node.cell[1]);
  }
  // 2. Relative places, once the node they lean on has a cell (repeat until nothing more resolves).
  const pending = nodes.filter((node) => node.cell === undefined && isPlaced(node));
  for (const node of pending) {
    for (const name of [node.rightOf, node.below, node.alignWith]) {
      if (name !== undefined && !byId.has(name)) {
        problems.push({
          rule: 'unknown-anchor',
          node: node.id,
          other: name,
          message: `"${node.id}" is placed relative to "${name}", which is not in the same group`,
        });
      }
    }
  }
  let todo = pending.filter((node) =>
    [node.rightOf, node.below, node.alignWith].every(
      (name) => name === undefined || byId.has(name),
    ),
  );
  for (;;) {
    const rest: PlaceNode[] = [];
    let progress = false;
    for (const node of todo) {
      const right = node.rightOf === undefined ? undefined : cells.get(node.rightOf);
      const down = node.below === undefined ? undefined : cells.get(node.below);
      const level = node.alignWith === undefined ? undefined : cells.get(node.alignWith);
      const needs = [node.rightOf, node.below, node.alignWith].filter((name) => name !== undefined);
      const have = [right, down, level].filter((cell) => cell !== undefined);
      if (have.length < needs.length) {
        rest.push(node);
        continue;
      }
      // `rightOf` gives the column and, if nothing else says otherwise, the row; `below` the row (and
      // the column); `alignWith` the row, or the column when `below` already gave the row.
      let col: number | undefined = right === undefined ? undefined : right.col + right.cols;
      let row: number | undefined = right?.row;
      if (down !== undefined) {
        row = down.row + down.rows;
        col ??= down.col;
      }
      if (level !== undefined) {
        if (down !== undefined) col = level.col;
        else row = level.row;
      }
      partial.set(node.id, {
        ...(col === undefined ? {} : { col }),
        ...(row === undefined ? {} : { row }),
      });
      if (col !== undefined && row !== undefined) put(node, col, row);
      else autoPlace(node);
      progress = true;
    }
    todo = rest;
    if (!progress || todo.length === 0) break;
  }
  // Nodes that lean on a node that never got a cell lean on each other: a cycle.
  for (const node of todo) {
    const name = [node.rightOf, node.below, node.alignWith].find(
      (anchor) => anchor !== undefined && cells.get(anchor) === undefined,
    );
    problems.push({
      rule: 'placement-cycle',
      node: node.id,
      ...(name === undefined ? {} : { other: name }),
      message: `"${node.id}" is placed relative to "${name}", which in turn waits for "${node.id}" (or for a node with no place at all)`,
    });
  }

  // 3. Everything else goes into free cells, one column past its furthest placed predecessor.
  for (const node of nodes) if (!cells.has(node.id)) autoPlace(node);
  return { cells, problems };
}

/** The grid of one container: positions (top left, relative to the container) and its size. */
export function gridLayout(
  nodes: readonly PlaceNode[],
  edges: readonly { source: string; target: string }[],
  direction: Direction,
): { positions: Record<string, { x: number; y: number }>; width: number; height: number } {
  const { cells } = resolveCells(nodes, edges, direction);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const colIndex = [...new Set([...cells.values()].flatMap((c) => range(c.col, c.cols)))].sort(
    (a, b) => a - b,
  );
  const rowIndex = [...new Set([...cells.values()].flatMap((c) => range(c.row, c.rows)))].sort(
    (a, b) => a - b,
  );
  const widths = new Map<number, number>(colIndex.map((index) => [index, 0]));
  const heights = new Map<number, number>(rowIndex.map((index) => [index, 0]));
  for (const [id, cell] of cells) {
    const node = byId.get(id)!;
    if (cell.cols === 1) widths.set(cell.col, Math.max(widths.get(cell.col)!, node.width));
    if (cell.rows === 1) heights.set(cell.row, Math.max(heights.get(cell.row)!, node.height));
  }
  // A node that spans cells widens the last of them if the others are not enough.
  for (const [id, cell] of cells) {
    const node = byId.get(id)!;
    if (cell.cols > 1) {
      const have = range(cell.col, cell.cols).reduce((sum, c) => sum + widths.get(c)!, 0);
      const last = cell.col + cell.cols - 1;
      const need = node.width - have - GRID_GAP.x * (cell.cols - 1);
      if (need > 0) widths.set(last, widths.get(last)! + need);
    }
    if (cell.rows > 1) {
      const have = range(cell.row, cell.rows).reduce((sum, r) => sum + heights.get(r)!, 0);
      const last = cell.row + cell.rows - 1;
      const need = node.height - have - GRID_GAP.y * (cell.rows - 1);
      if (need > 0) heights.set(last, heights.get(last)! + need);
    }
  }
  const left = new Map<number, number>();
  let x = 0;
  for (const index of colIndex) {
    left.set(index, x);
    x += widths.get(index)! + GRID_GAP.x;
  }
  const top = new Map<number, number>();
  let y = 0;
  for (const index of rowIndex) {
    top.set(index, y);
    y += heights.get(index)! + GRID_GAP.y;
  }
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [id, cell] of cells) {
    const node = byId.get(id)!;
    const x0 = left.get(cell.col)!;
    const y0 = top.get(cell.row)!;
    const wide = range(cell.col, cell.cols).reduce(
      (sum, c, i) => sum + widths.get(c)! + (i > 0 ? GRID_GAP.x : 0),
      0,
    );
    const tall = range(cell.row, cell.rows).reduce(
      (sum, r, i) => sum + heights.get(r)! + (i > 0 ? GRID_GAP.y : 0),
      0,
    );
    positions[id] = { x: x0 + (wide - node.width) / 2, y: y0 + (tall - node.height) / 2 };
  }
  return {
    positions,
    width: Math.max(0, x - GRID_GAP.x),
    height: Math.max(0, y - GRID_GAP.y),
  };
}

function range(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => from + i);
}
