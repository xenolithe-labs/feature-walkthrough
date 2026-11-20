import { Recorder } from '../../recorder';
import { binarySearch, setRecorder } from './binary-search.algo';

/**
 * The text the reader sees. `tests/unit/algorithms.test.ts` checks that it is the algorithm in
 * `binary-search.algo.ts` with the recorder's calls taken out, and runs it on its own.
 */
export const SOURCE = `function binarySearch(items, target) {
  let lo = 0;
  let hi = items.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (items[mid] === target) {
      return mid;
    }
    if (items[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return -1;
}`;

export const ITEMS = [3, 8, 12, 17, 23, 31, 42, 56, 64, 77];

/** Runs the real search under a recorder and returns the config and what the search returned. */
export function recordBinarySearch(
  target: number,
  meta: { id: string; title: string; lead: string; tags?: string[] },
) {
  const rec = new Recorder({
    ...meta,
    source: { title: 'binarySearch.js', lang: 'js', text: SOURCE },
  });
  const items = rec.array('items', [...ITEMS], {
    title: 'items (sorted)',
    pointers: ['lo', 'hi', 'mid'],
    ranges: [{ id: 'window', from: 'lo', to: 'hi', label: 'window', dim: true }],
  });
  rec.vars('vars', { target, lo: '', hi: '', mid: '', result: '' }, { title: 'Variables' });
  setRecorder(rec);
  const result = binarySearch(items, target);
  return { config: rec.finish(), result };
}

/** Looking for 42: found on the fourth probe. */
export const binarySearchFound = recordBinarySearch(42, {
  id: 'binary-search',
  title: 'Binary search: finding 42',
  lead: 'Each probe of the middle cell throws away half of what is left. Ten sorted numbers take four probes to find one of them.',
  tags: ['algorithm', 'search'],
});

/** Looking for 1: smaller than everything, so hi walks off the left end of the array. */
export const binarySearchMissing = recordBinarySearch(1, {
  id: 'binary-search-missing',
  title: 'Binary search: when the target is not there',
  lead: 'Looking for a number that is smaller than every cell. The window shrinks until it is empty, and hi ends up at -1, one step off the left end.',
  tags: ['algorithm', 'search'],
});

export const binarySearchDemos = [binarySearchFound.config, binarySearchMissing.config];
