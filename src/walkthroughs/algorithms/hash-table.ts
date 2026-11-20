import { Recorder } from '../../recorder';
import { put, setRecorder } from './hash-table.algo';

/**
 * The text the reader sees. `tests/unit/structures.test.ts` checks that it is the algorithm in
 * `hash-table.algo.ts` with the recorder's calls taken out, and runs it on its own.
 */
export const SOURCE = `function put(buckets, key, value) {
  const i = key % buckets.length;
  const entry = { key, value, next: null };
  if (buckets[i] === null) {
    buckets[i] = entry;
    return;
  }
  let tail = buckets[i];
  while (tail.next !== null) {
    tail = tail.next;
  }
  tail.next = entry;
}`;

export const SIZE = 4;
/** In the table when the walkthrough starts, bucket by bucket: 5 is in bucket 1 and 2 in bucket 2. */
export const START: [number, string][][] = [[], [[5, 'e']], [[2, 'b']], []];
/** Put next: 3 finds an empty bucket; 9 and 13 both land in bucket 1, where 5 already is. */
export const PUTS: [number, string][] = [
  [3, 'c'],
  [9, 'i'],
  [13, 'm'],
];

export interface Entry {
  key: number;
  value: string;
  next: Entry | null;
}

type Put = (buckets: (Entry | null)[], key: number, value: string) => void;

/** The shown code, as a function that runs without any recorder. */
export const plainPut = new Function(`${SOURCE}\nreturn put;`)() as Put;

/** The table as plain data: for each bucket, the chain of [key, value] pairs. */
export function chains(buckets: readonly (Entry | null)[]): [number, string][][] {
  return buckets.map((head) => {
    const chain: [number, string][] = [];
    for (let entry = head; entry !== null; entry = entry.next) chain.push([entry.key, entry.value]);
    return chain;
  });
}

export function recordHashTable() {
  const rec = new Recorder({
    id: 'hash-table',
    title: 'A hash table with chaining: a collision',
    lead: 'Each key picks a bucket. When two keys pick the same one, the second entry is chained on after the first, so nothing is overwritten.',
    tags: ['algorithm', 'data structure', 'hash table'],
    source: { title: 'put.js', lang: 'js', text: SOURCE },
  });
  const heap = rec.records('table', {
    title: 'Buckets and chains',
    direction: 'RIGHT',
    layout: 'tree',
    head: false,
    names: false,
  });
  const buckets = heap.slots<Entry | null>('buckets', Array(SIZE).fill(null), {
    names: true,
    head: false,
  });
  heap.vars('vars', { i: '', entry: null, tail: null }, { names: true });
  // Setup, before the first call: the table starts out holding two entries.
  START.forEach((chain, index) => {
    let head: Entry | null = null;
    for (const [key, value] of [...chain].reverse()) {
      head = heap.node({ key, value, next: head }, { id: `e${key}` });
    }
    buckets[index] = head;
  });
  setRecorder(rec);
  for (const [key, value] of PUTS) put(buckets, key, value);
  return { config: rec.finish(), buckets };
}

export const hashRun = recordHashTable();
export const hashTableDemo = hashRun.config;
