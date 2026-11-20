import { Recorder } from '../../recorder';
import { editDistance, setRecorder } from './edit-distance.algo';

/**
 * The text the reader sees. `tests/unit/algorithms.test.ts` checks that it is the algorithm in
 * `edit-distance.algo.ts` with the recorder's calls taken out, and runs it on its own.
 */
export const SOURCE = `function editDistance(a, b, dp) {
  // dp[i][j]: the fewest edits that turn the first i letters of a into the first j letters of b
  for (let i = 0; i <= a.length; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1];
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (same ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}`;

export const WORDS: [string, string] = ['flaw', 'lawn'];

/** A table of nulls with a row per letter of a and a column per letter of b, plus the empty prefix. */
export function emptyTable(a: string, b: string): (number | null)[][] {
  return Array.from({ length: a.length + 1 }, () =>
    new Array<number | null>(b.length + 1).fill(null),
  );
}

export function recordEditDistance() {
  const [a, b] = WORDS;
  const rec = new Recorder({
    id: 'edit-distance',
    title: 'Edit distance: filling in a table',
    lead: 'How many single-letter edits turn "flaw" into "lawn"? Each cell of the table answers the question for a pair of prefixes, using three neighbours that were answered before.',
    tags: ['algorithm', 'dynamic programming'],
    source: { title: 'editDistance.js', lang: 'js', text: SOURCE },
  });
  rec.array('a', [...a], {
    pane: 'words',
    title: 'The two words',
    pointers: [{ id: 'ai', label: 'a[i-1]' }],
  });
  rec.array('b', [...b], { pane: 'words', pointers: [{ id: 'bj', label: 'b[j-1]' }] });
  const dp = rec.grid(
    'dp',
    {
      // Column headers are drawn in capitals, so they carry only the index j; the letters are in
      // the first cell of each row and in the words above.
      rows: ['0  (empty)', ...[...a].map((letter, index) => `${index + 1}  ${letter}`)],
      columns: ['0', ...[...b].map((_, index) => String(index + 1))],
      corner: 'i, letter of a  /  j',
      data: emptyTable(a, b),
    },
    { title: 'dp: edits needed for each pair of prefixes' },
  );
  setRecorder(rec);
  const run = editDistance as unknown as (a: string, b: string, dp: (number | null)[][]) => number;
  const result = run(a, b, dp);
  return { config: rec.finish(), result, table: dp };
}

export const editDistanceRun = recordEditDistance();
export const editDistanceDemo = editDistanceRun.config;
