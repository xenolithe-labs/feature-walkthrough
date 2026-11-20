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
function reverse(head) {
  rec.step('Start with two pointers');
  rec.at(2, 'let prev = null', {
    text: 'prev will be the head of the reversed part. Nothing has been reversed yet, so it is null.',
  });
  let prev = null;
  rec.ref('prev', prev);
  rec.at(3, 'let curr = head', {
    text: 'curr is the node being turned round. It starts at the head of the list.',
  });
  let curr = head;
  rec.ref('curr', curr);
  while (curr !== null) {
    rec.step('Turn node {n} round');
    rec.at(4, 'curr !== null', { expr: true, text: 'There is still a node to turn.' });
    rec.at(5, 'const next = curr.next', {
      label: 'Remember what comes next',
      text: 'Once curr.next is changed the rest of the list could no longer be reached from curr. So next keeps hold of it first.',
    });
    const next = curr.next;
    rec.ref('next', next);
    rec.at(6, 'curr.next = prev', {
      changes: true,
      label: 'Point the node backwards',
      text: 'The one pointer that matters: curr now points at the part that is already reversed, not at the part still to do.',
    });
    curr.next = prev;
    rec.at(7, 'prev = curr', {
      label: 'Grow the reversed part',
      text: 'curr is now the head of the reversed part, so prev moves onto it.',
    });
    prev = curr;
    rec.ref('prev', prev);
    rec.at(8, 'curr = next', {
      label: 'Step on',
      text: 'curr moves to the node that next remembered.',
    });
    curr = next;
    rec.ref('curr', curr);
  }
  rec.step('Done');
  rec.at(4, 'curr !== null', {
    expr: true,
    label: 'No node is left',
    text: 'curr has run off the end, so every node has been turned round.',
  });
  rec.at(10, 'return prev', {
    label: 'Return the new head',
    text: 'prev is the old last node, which is now the first. Following next from it visits the list backwards.',
  });
  return prev;
}
//#endregion

export { reverse };
