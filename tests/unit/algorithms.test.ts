import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createFolder,
  formatProblem,
  loadConfig,
  shapeOf,
  type ElementsState,
  type ResolvedWalkthrough,
} from '../../src/core';
import { ArrayContent, valuesOf } from '../../src/panels/array/model';
import { stripHooks } from '../../src/recorder';
import { createRegistry } from '../../src/registry';
import { SOURCE as BFS_SOURCE, EDGES, NODES, bfsRun } from '../../src/walkthroughs/algorithms/bfs';
import {
  SOURCE as BINARY_SOURCE,
  ITEMS,
  binarySearchFound,
  binarySearchMissing,
} from '../../src/walkthroughs/algorithms/binary-search';
import {
  SOURCE as EDIT_SOURCE,
  WORDS,
  editDistanceRun,
  emptyTable,
} from '../../src/walkthroughs/algorithms/edit-distance';
import {
  SOURCE as QUICK_SOURCE,
  INPUT,
  quicksortRun,
} from '../../src/walkthroughs/algorithms/quicksort';

/** The instrumented algorithm, with the recorder's calls taken out: what a reader should see. */
function shownFrom(file: string): string {
  const text = readFileSync(`src/walkthroughs/algorithms/${file}`, 'utf8');
  const region = /\/\/#region algorithm\n([\s\S]*?)\n\/\/#endregion/.exec(text);
  if (region === null) throw new Error(`${file} has no algorithm region`);
  return stripHooks(region[1]!);
}

/** Runs the text a reader sees, on its own, and returns the function it defines. */
function runShown<T extends (...args: never[]) => unknown>(source: string, name: string): T {
  return new Function(`${source}\nreturn ${name};`)() as T;
}

function load(config: unknown): ResolvedWalkthrough {
  const result = loadConfig(config, createRegistry());
  expect(result.problems.map(formatProblem)).toEqual([]);
  return result.walkthroughs[0]!;
}

/** The state of every pane after the last call. */
function finalState(walkthrough: ResolvedWalkthrough) {
  const shape = shapeOf(walkthrough);
  const last = shape.length - 1;
  return createFolder(walkthrough).at(last, shape[last]! - 1);
}

function cellsOf(walkthrough: ResolvedWalkthrough, pane: string, array: string) {
  const content = ArrayContent.parse(walkthrough.panes.find((item) => item.id === pane)!.content);
  const state = finalState(walkthrough)[pane]!.state as ElementsState;
  return { content, state, values: valuesOf(content, state, array) };
}

describe('the shown source is the code that ran', () => {
  it.each([
    ['binary-search.algo.ts', BINARY_SOURCE],
    ['quicksort.algo.ts', QUICK_SOURCE],
    ['bfs.algo.ts', BFS_SOURCE],
    ['edit-distance.algo.ts', EDIT_SOURCE],
  ])('%s, without the recorder calls, is the text on the page', (file, source) => {
    expect(shownFrom(file)).toBe(source);
  });

  it('every recorded line number points at the code it names (the recorder checks each one)', () => {
    // Importing the demos ran every algorithm; a wrong line number would have thrown there.
    for (const run of [
      binarySearchFound,
      binarySearchMissing,
      quicksortRun,
      bfsRun,
      editDistanceRun,
    ]) {
      expect(run.config.steps.length).toBeGreaterThan(0);
    }
  });
});

describe('binary search', () => {
  const search = runShown<(items: number[], target: number) => number>(
    BINARY_SOURCE,
    'binarySearch',
  );

  it('the shown text, run on its own, finds the same index as the recording', () => {
    expect(search(ITEMS, 42)).toBe(binarySearchFound.result);
    expect(search(ITEMS, 1)).toBe(binarySearchMissing.result);
    expect(binarySearchFound.result).toBe(ITEMS.indexOf(42));
  });

  it('ends on the answer: the found cell is marked and result says its index', () => {
    const walkthrough = load(binarySearchFound.config);
    const states = finalState(walkthrough);
    const { values, state } = cellsOf(walkthrough, 'items', 'items');
    expect(values).toEqual(ITEMS);
    expect(state.patches['items.6']?.tone).toBe('good');
    expect((states['vars']!.state as ElementsState).patches['result']?.value).toBe('6');
  });

  it('the missing target ends with an empty window and hi one off the left end', () => {
    const walkthrough = load(binarySearchMissing.config);
    const { state } = cellsOf(walkthrough, 'items', 'items');
    expect(state.patches['hi']?.at).toBe(-1);
    expect(state.patches['lo']?.at).toBe(0);
    expect((finalState(walkthrough)['vars']!.state as ElementsState).patches['result']?.value).toBe(
      '-1',
    );
  });
});

describe('quicksort', () => {
  const sort = runShown<(items: number[], lo: number, hi: number) => void>(
    QUICK_SOURCE,
    'quicksort',
  );

  it('the shown text, run on its own, sorts the input', () => {
    const items = [...INPUT];
    sort(items, 0, items.length - 1);
    expect(items).toEqual([...INPUT].sort((a, b) => a - b));
  });

  it('the walkthrough ends on the sorted array, every cell settled, and the stack back at the root', () => {
    const walkthrough = load(quicksortRun.config);
    const { values, state } = cellsOf(walkthrough, 'items', 'items');
    const sorted = [...INPUT].sort((a, b) => a - b);
    expect(quicksortRun.result).toEqual(sorted);
    expect(values).toEqual(sorted);
    for (let index = 0; index < INPUT.length; index += 1) {
      expect(state.patches[`items.${index}`]?.tone).toBe('good');
    }
    const stack = finalState(walkthrough)['stack']!.state as ElementsState;
    expect(stack.present).toEqual(['stack-0']);
  });

  it('shows the recursion as deep as it went', () => {
    const walkthrough = load(quicksortRun.config);
    const stack = walkthrough.panes.find((pane) => pane.id === 'stack')!;
    const depth = (stack.content as { boxes: unknown[] }).boxes.length;
    // quicksort -> quicksort -> quicksort -> partition at the deepest point.
    expect(depth).toBeGreaterThanOrEqual(4);
  });
});

describe('breadth-first search', () => {
  /** Level by level, with no queue: a different way to the same order. */
  function levels(start: string): string[] {
    const seen = [start];
    let ring = [start];
    while (ring.length > 0) {
      const next: string[] = [];
      for (const node of ring) {
        for (const [from, to] of EDGES) {
          if (from === node && !seen.includes(to) && !next.includes(to)) next.push(to);
        }
      }
      seen.push(...next);
      ring = next;
    }
    return seen;
  }

  it('the shown text, run on its own, gives the same order', () => {
    const run = runShown<(graph: Record<string, string[]>, start: string) => string[]>(
      BFS_SOURCE,
      'bfs',
    );
    const graph = Object.fromEntries(NODES.map((node) => [node, [] as string[]]));
    for (const [from, to] of EDGES) graph[from]!.push(to);
    expect(run(graph, 'A')).toEqual(levels('A'));
  });

  it('ends with the queue holding the visit order and every node done', () => {
    const walkthrough = load(bfsRun.config);
    expect(bfsRun.order).toEqual(levels('A'));
    const { values, state } = cellsOf(walkthrough, 'queue', 'queue');
    expect(values).toEqual(levels('A'));
    // head has caught up with the end of the queue.
    expect(state.patches['head']?.at).toBe(NODES.length);
    const map = finalState(walkthrough)['map']!.state as ElementsState;
    for (const node of NODES) expect(map.patches[node]?.tone).toBe('good');
  });
});

describe('edit distance', () => {
  const [a, b] = WORDS;

  /** The same table by recursion with a memo, so it shares no code with the shown loops. */
  function table(): number[][] {
    const memo = new Map<string, number>();
    const cost = (i: number, j: number): number => {
      const key = `${i},${j}`;
      if (memo.has(key)) return memo.get(key)!;
      let value: number;
      if (i === 0) value = j;
      else if (j === 0) value = i;
      else {
        value = Math.min(
          cost(i - 1, j) + 1,
          cost(i, j - 1) + 1,
          cost(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
      memo.set(key, value);
      return value;
    };
    return Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => cost(i, j)),
    );
  }

  it('the shown text, run on its own, fills the same table', () => {
    const run = runShown<(a: string, b: string, dp: (number | null)[][]) => number>(
      EDIT_SOURCE,
      'editDistance',
    );
    const dp = emptyTable(a, b);
    expect(run(a, b, dp)).toBe(2);
    expect(dp).toEqual(table());
  });

  it('ends with every cell of the table filled in, as the real table says', () => {
    const walkthrough = load(editDistanceRun.config);
    expect(editDistanceRun.result).toBe(2);
    const content = walkthrough.panes.find((pane) => pane.id === 'dp')!.content as {
      rows: { id: string; cells: Record<string, string> }[];
    };
    const state = finalState(walkthrough)['dp']!.state as ElementsState;
    const shown = content.rows.map((row) =>
      Array.from({ length: b.length + 1 }, (_, j) => {
        const patched = state.patches[row.id]?.[`c${j}`];
        return Number(typeof patched === 'string' ? patched : row.cells[`c${j}`]);
      }),
    );
    expect(shown).toEqual(table());
  });
});
