// The algorithm as it runs, with the recorder's calls (the lines that start with `rec.`) in it.
// Take those lines out and what is left is the source the walkthrough shows; a test checks that.
// It is plain JavaScript, so the test can also run the shown text on its own.
//
// Here `rec` is the narrator made in `quicksort.ts`: it turns each hook into one card, with words
// that state the values of this run, and passes the rest to the recorder.
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
let rec;

export function setRecorder(recorder) {
  rec = recorder;
}

//#region algorithm
function quicksort(items, lo, hi) {
  rec.enter(lo, hi);
  if (lo >= hi) {
    rec.returnAtOnce(lo, hi);
    return;
  }
  const p = partition(items, lo, hi);
  rec.recurse('left', lo, hi, p);
  quicksort(items, lo, p - 1);
  rec.recurse('right', lo, hi, p);
  quicksort(items, p + 1, hi);
  rec.returns(lo, hi);
}

function partition(items, lo, hi) {
  rec.pickPivot(lo, hi);
  const pivot = items[hi];
  let i = lo;
  for (let j = lo; j < hi; j++) {
    rec.compare(lo, hi, i, j);
    if (items[j] < pivot) {
      [items[i], items[j]] = [items[j], items[i]];
      i++;
      rec.point('i', i);
    }
  }
  rec.place(lo, hi, i);
  [items[i], items[hi]] = [items[hi], items[i]];
  rec.placed(i);
  return i;
}
//#endregion

export { quicksort };
