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
function quicksort(items, lo, hi) {
  rec.enter('quicksort', { lo, hi });
  rec.at(2, 'lo >= hi', {
    expr: true,
    label: 'Anything to sort?',
    text: 'A range of zero or one cells is already sorted. Anything longer needs work.',
  });
  rec.range('active', lo, hi);
  if (lo >= hi) {
    rec.at(3, 'return', { label: 'Nothing to do' });
    rec.tone('items', [lo, hi], 'good');
    rec.leave();
    return;
  }
  rec.step('Partition items[' + lo + '..' + hi + ']');
  rec.at(5, 'partition(items, lo, hi)', {
    expr: true,
    label: 'Partition the range',
    text: 'Partition picks a pivot and rearranges the range so that everything smaller is on its left. It returns where the pivot ended up.',
  });
  const p = partition(items, lo, hi);
  rec.step('Sort the left side of ' + lo + '..' + hi);
  rec.at(6, 'quicksort(items, lo, p - 1)', {
    label: 'Sort what is left of the pivot',
    text: 'The pivot is in its final place. Everything to its left still needs sorting: a smaller version of the same problem.',
  });
  quicksort(items, lo, p - 1);
  rec.range('active', lo, hi);
  rec.step('Sort the right side of ' + lo + '..' + hi);
  rec.at(7, 'quicksort(items, p + 1, hi)', {
    label: 'Sort what is right of the pivot',
    text: 'The same for everything to the right of the pivot.',
  });
  quicksort(items, p + 1, hi);
  rec.range('active', lo, hi);
  rec.at(8, '}', {
    label: 'This range is sorted',
    text: 'Both sides are sorted and the pivot sits between them, so the whole range is sorted.',
  });
  rec.leave();
}

function partition(items, lo, hi) {
  rec.enter('partition', { lo, hi });
  rec.at(11, 'const pivot = items[hi]', {
    label: 'Choose the pivot',
    text: 'The last cell of the range is the pivot. Every other cell will be compared with it.',
  });
  const pivot = items[hi];
  rec.point('pivot', hi);
  rec.at(12, 'let i = lo', {
    text: 'i marks the boundary: cells before i are smaller than the pivot. It starts at the front, where nothing has been sorted yet.',
  });
  let i = lo;
  rec.point('i', i);
  for (let j = lo; j < hi; j++) {
    rec.at(13, 'j < hi', {
      expr: true,
      label: 'Next cell',
      text: 'j walks over the range, one cell at a time, up to the pivot.',
    });
    rec.point('j', j);
    rec.at(14, 'items[j] < pivot', { expr: true, label: 'Smaller than the pivot?' });
    if (items[j] < pivot) {
      rec.at([15, 16], '[items[i], items[j]]', {
        changes: true,
        label: 'Move it before the boundary',
        text: 'Swap the cell at j with the cell at i, then move the boundary one to the right. When i and j are the same cell the swap changes nothing.',
      });
      [items[i], items[j]] = [items[j], items[i]];
      i++;
      rec.point('i', i);
    }
  }
  rec.at(19, '[items[i], items[hi]]', {
    changes: true,
    label: 'Put the pivot on the boundary',
    text: 'Every cell before i is smaller than the pivot, every cell from i on is not. Swapping the pivot into i puts it exactly between them.',
  });
  [items[i], items[hi]] = [items[hi], items[i]];
  rec.point('pivot', i);
  rec.point('j', null);
  rec.tone('items', i, 'good');
  rec.at(20, 'return i', {
    label: 'Return the pivot index',
    text: 'The pivot will never move again. Its index tells the caller where to split.',
  });
  rec.point('i', null);
  rec.point('pivot', null);
  rec.leave(i);
  return i;
}
//#endregion

export { quicksort };
