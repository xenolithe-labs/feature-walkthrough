import { Recorder } from '../../recorder';
import { quicksort, useRecorder } from './quicksort.algo';

/**
 * The text the reader sees. `tests/unit/algorithms.test.ts` checks that it is the algorithm in
 * `quicksort.algo.ts` with the recorder's calls taken out, and runs it on its own.
 */
export const SOURCE = `function quicksort(items, lo, hi) {
  if (lo >= hi) {
    return;
  }
  const p = partition(items, lo, hi);
  quicksort(items, lo, p - 1);
  quicksort(items, p + 1, hi);
}

function partition(items, lo, hi) {
  const pivot = items[hi];
  let i = lo;
  for (let j = lo; j < hi; j++) {
    if (items[j] < pivot) {
      [items[i], items[j]] = [items[j], items[i]];
      i++;
    }
  }
  [items[i], items[hi]] = [items[hi], items[i]];
  return i;
}`;

/** Seven numbers with a repeated 2, so that the comparison `<` (not `<=`) matters. */
export const INPUT = [5, 2, 8, 2, 9, 1, 6];

export function recordQuicksort() {
  const rec = new Recorder({
    id: 'quicksort',
    title: 'Quicksort: partition, then sort each side',
    lead: 'Pick a pivot, move the smaller cells to its left, and sort each side the same way. The call stack shows the recursion going down and coming back.',
    tags: ['algorithm', 'sorting', 'recursion'],
    source: { title: 'quicksort.js', lang: 'js', text: SOURCE },
  });
  const items = rec.array('items', [...INPUT], {
    title: 'Array',
    pointers: [{ id: 'pivot', side: 'above' }, 'i', 'j'],
    ranges: [{ id: 'active', label: 'sorting this range', dim: true }],
  });
  rec.stack('stack', { title: 'Call stack' });
  useRecorder(rec);
  rec.step('Sort the whole array');
  quicksort(items, 0, items.length - 1);
  return { config: rec.finish(), result: items };
}

export const quicksortRun = recordQuicksort();
export const quicksortDemo = quicksortRun.config;
