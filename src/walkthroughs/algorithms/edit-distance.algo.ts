// The algorithm as it runs, with the recorder's calls (the lines that start with `rec.`) in it.
// Take those lines out and what is left is the source the walkthrough shows; a test checks that.
// It is plain JavaScript, so the test can also run the shown text on its own.
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
let rec;

export function useRecorder(recorder) {
  rec = recorder;
}

//#region algorithm
function editDistance(a, b, dp) {
  // dp[i][j]: the fewest edits that turn the first i letters of a into the first j letters of b
  rec.step('The first row and column');
  rec.at([3, 5], 'dp[i][0] = i', {
    changes: true,
    label: 'Turning a prefix into nothing',
    text: 'Turning the first i letters of a into the empty word takes i deletions. The first column counts them.',
  });
  for (let i = 0; i <= a.length; i++) {
    dp[i][0] = i;
  }
  rec.at([6, 8], 'dp[0][j] = j', {
    changes: true,
    label: 'Turning nothing into a prefix',
    text: 'Turning the empty word into the first j letters of b takes j insertions. The first row counts them.',
  });
  for (let j = 0; j <= b.length; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    rec.step('Row ' + i + ': the letter ' + a[i - 1]);
    for (let j = 1; j <= b.length; j++) {
      rec.at(11, 'a[i - 1] === b[j - 1]', {
        expr: true,
        label: 'Compare ' + a[i - 1] + ' with ' + b[j - 1],
        text: () =>
          a[i - 1] === b[j - 1]
            ? 'The letters are the same, so the last letter costs nothing extra.'
            : 'The letters differ, so the last letter costs one edit.',
      });
      rec.point('ai', i - 1);
      rec.point('bj', j - 1);
      const same = a[i - 1] === b[j - 1];
      rec.at(12, 'Math.min', {
        changes: true,
        label: 'Fill in dp[' + i + '][' + j + ']',
        text: () =>
          'The cheapest of three ways in: delete a letter (' +
          (dp[i - 1][j] + 1) +
          '), insert one (' +
          (dp[i][j - 1] + 1) +
          '), or change or keep the last letter (' +
          (dp[i - 1][j - 1] + (same ? 0 : 1)) +
          ').',
      });
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (same ? 0 : 1));
    }
  }
  rec.step('The answer');
  rec.at(15, 'return dp[a.length][b.length]', {
    label: 'The bottom right cell is the answer',
    text: 'It holds the fewest edits that turn all of a into all of b.',
  });
  rec.point('ai', null);
  rec.point('bj', null);
  return dp[a.length][b.length];
}
//#endregion

export { editDistance };
