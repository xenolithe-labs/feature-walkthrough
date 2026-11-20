// The algorithm as it runs, with the recorder's calls (the lines that start with `rec.`) in it.
// Take those lines out and what is left is the source the walkthrough shows; a test checks that.
// It is plain JavaScript, so the test can also run the shown text on its own.
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
let rec;

export function setRecorder(recorder) {
  rec = recorder;
}

//#region algorithm
function binarySearch(items, target) {
  rec.step('Set up the window');
  rec.at(2, 'let lo = 0', {
    text: 'The search window starts as the whole array: from the first index.',
  });
  let lo = 0;
  rec.point('lo', lo);
  rec.at(3, 'let hi = items.length - 1', {
    text: 'And it ends at the last index. Both ends are inclusive.',
  });
  let hi = items.length - 1;
  rec.point('hi', hi);
  while (lo <= hi) {
    rec.step('Round {n}');
    rec.at(4, 'lo <= hi', {
      expr: true,
      text: 'The window still has cells in it, so the target could still be in there.',
    });
    rec.at(5, 'Math.floor((lo + hi) / 2)', {
      expr: true,
      label: 'Probe the middle',
      text: 'Look at the cell in the middle of the window. Halfway is the best place to look: whatever it says, half of the window can be thrown away.',
    });
    const mid = Math.floor((lo + hi) / 2);
    rec.point('mid', mid);
    rec.at(6, 'items[mid] === target', { expr: true, label: 'Is it the target?' });
    if (items[mid] === target) {
      rec.at(7, 'return mid', {
        label: 'Found it',
        text: 'The probe hit the target, so its index is the answer.',
      });
      rec.tone('items', mid, 'good');
      rec.set('result', mid);
      return mid;
    }
    rec.at(9, 'items[mid] < target', { expr: true, label: 'Which side is it on?' });
    if (items[mid] < target) {
      rec.at(10, 'lo = mid + 1', {
        changes: true,
        label: 'Too small: drop the left half',
        text: 'The probe is smaller than the target, and the array is sorted, so the target can only be to the right. Move lo to mid + 1: mid itself has been ruled out too.',
      });
      lo = mid + 1;
      rec.point('lo', lo);
    } else {
      rec.at(12, 'hi = mid - 1', {
        changes: true,
        label: 'Too big: drop the right half',
        text: 'The probe is larger than the target, so the target can only be to the left. Move hi to mid - 1.',
      });
      hi = mid - 1;
      rec.point('hi', hi);
    }
  }
  rec.step('The window is empty');
  rec.at(4, 'lo <= hi', {
    expr: true,
    label: 'The window is empty',
    text: 'lo has gone past hi, so no cell is left to look at. The target is not in the array.',
  });
  rec.at(15, 'return -1', {
    label: 'Not found',
    text: '-1 is the answer for "not there": no index is ever -1.',
  });
  rec.set('result', -1);
  return -1;
}
//#endregion

export { binarySearch };
