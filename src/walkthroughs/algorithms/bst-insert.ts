import { Recorder, type Records } from '../../recorder';
import { insert, setRecorder } from './bst-insert.algo';

/**
 * The text the reader sees. `tests/unit/structures.test.ts` checks that it is the algorithm in
 * `bst-insert.algo.ts` with the recorder's calls taken out, and runs it on its own.
 */
export const SOURCE = `function insert(root, key) {
  const node = { key, left: null, right: null };
  if (root === null) return node;
  let curr = root;
  while (true) {
    const side = key < curr.key ? 'left' : 'right';
    if (curr[side] === null) {
      curr[side] = node;
      return root;
    }
    curr = curr[side];
  }
}`;

export interface TreeNode {
  key: number;
  left: TreeNode | null;
  right: TreeNode | null;
}

/** The tree before anything is inserted: 8 at the root, with 3 and 10 below it. */
export const START: Shape = [8, [3, [1], [6]], [10, null, [14]]];
/** What is inserted, in order. 5 ends up under 6 on the left; 12 ends up under 14 on the left. */
export const KEYS = [5, 12];

export type Shape = [number, (Shape | null)?, (Shape | null)?];

/** A plain tree of a shape, for running the shown code without a recorder. */
export function plainTree(shape: Shape | null | undefined): TreeNode | null {
  if (shape === null || shape === undefined) return null;
  return { key: shape[0], left: plainTree(shape[1]), right: plainTree(shape[2]) };
}

/** The keys of a plain tree in order, and as a nested shape, for comparing results. */
export function shapeOf(tree: TreeNode | null): Shape | null {
  if (tree === null) return null;
  return [tree.key, shapeOf(tree.left), shapeOf(tree.right)];
}

/** Builds the starting tree as tracked nodes, children first. Setup: it is there from the start. */
function build(heap: Records, shape: Shape | null | undefined): TreeNode | null {
  if (shape === null || shape === undefined) return null;
  const left = build(heap, shape[1]);
  const right = build(heap, shape[2]);
  return heap.node({ key: shape[0], left, right }, { id: `n${shape[0]}` });
}

export function recordBstInsert() {
  const rec = new Recorder({
    id: 'bst-insert',
    title: 'Inserting into a binary search tree',
    lead: 'Smaller keys hang on the left, the rest on the right. An insert walks down from the root, and ends by changing one empty pointer: nothing else in the tree moves.',
    tags: ['algorithm', 'data structure', 'tree'],
    source: { title: 'insert.js', lang: 'js', text: SOURCE },
  });
  const heap = rec.records('tree', {
    title: 'Binary search tree',
    direction: 'DOWN',
    layout: 'tree',
    empty: '∅',
    head: false,
    names: false,
  });
  // `root` hangs the tree under the variables, which puts them above it.
  heap.vars(
    'vars',
    { root: null, node: '', curr: null, side: '' },
    { names: true, links: ['root'] },
  );
  let root = build(heap, START);
  rec.ref('root', root);
  setRecorder(rec);
  for (const key of KEYS) root = insert(root, key);
  return { config: rec.finish(), result: root };
}

export const bstRun = recordBstInsert();
export const bstInsertDemo = bstRun.config;
