import { Recorder } from '../../recorder';
import { bfs, useRecorder } from './bfs.algo';

/**
 * The text the reader sees. `tests/unit/algorithms.test.ts` checks that it is the algorithm in
 * `bfs.algo.ts` with the recorder's calls taken out, and runs it on its own.
 */
export const SOURCE = `function bfs(graph, start, queue = []) {
  const visited = new Set([start]);
  queue.push(start);
  let head = 0;
  while (head < queue.length) {
    const node = queue[head];
    head++;
    for (const next of graph[node]) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return queue;
}`;

/**
 * A small directed graph with two ways to reach D (through B and through C) and two to reach F,
 * so that the visited set has something to refuse.
 */
export const EDGES: [string, string][] = [
  ['A', 'B'],
  ['A', 'C'],
  ['B', 'D'],
  ['C', 'D'],
  ['C', 'E'],
  ['D', 'F'],
  ['E', 'F'],
];
export const NODES = ['A', 'B', 'C', 'D', 'E', 'F'];

export function adjacency(): Record<string, string[]> {
  const graph: Record<string, string[]> = Object.fromEntries(NODES.map((node) => [node, []]));
  for (const [from, to] of EDGES) graph[from]!.push(to);
  return graph;
}

export function recordBfs() {
  const rec = new Recorder({
    id: 'bfs',
    title: 'Breadth-first search: nearest first',
    lead: 'A queue makes the search spread out one ring at a time. A visited set stops it from going round in circles.',
    tags: ['algorithm', 'graph'],
    source: { title: 'bfs.js', lang: 'js', text: SOURCE },
  });
  rec.pane(
    'map',
    'graph',
    {
      initial: true,
      direction: 'RIGHT',
      nodes: NODES.map((id) => ({ id, label: id })),
      edges: EDGES.map(([from, to]) => ({ from, to })),
    },
    { title: 'Graph (amber: queued, green: done)' },
  );
  const queue = rec.array('queue', [] as string[], {
    title: 'Queue',
    pointers: ['head'],
  });
  rec.vars('vars', { node: '', next: '', head: '' }, { title: 'Variables' });
  useRecorder(rec);
  const run = bfs as unknown as (
    graph: Record<string, string[]>,
    start: string,
    queue: string[],
  ) => string[];
  const order = run(adjacency(), 'A', queue);
  return { config: rec.finish(), order };
}

export const bfsRun = recordBfs();
export const bfsDemo = bfsRun.config;
