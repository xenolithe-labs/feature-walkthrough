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
function put(buckets, key, value) {
  rec.step(`Put ${key}`);
  rec.at(2, 'const i = key % buckets.length', {
    label: `Which bucket for ${key}?`,
    text: () =>
      `The key picks its bucket: ${key} % ${buckets.length} is ${key % buckets.length}. Different keys can pick the same one.`,
  });
  const i = key % buckets.length;
  rec.ref('i', i);
  rec.at(3, 'const entry = { key, value, next: null }', {
    label: 'Make the entry',
    text: 'A new entry holds the key, the value, and a pointer to the entry after it in its bucket, which is nothing yet.',
  });
  const entry = { key, value, next: null };
  rec.node(entry, { id: `e${key}` });
  rec.ref('entry', entry);
  rec.at(4, 'buckets[i] === null', {
    expr: true,
    label: 'Is the bucket empty?',
    text: () =>
      buckets[i] === null
        ? `Bucket ${i} holds nothing, so the entry can go straight in.`
        : `Bucket ${i} already holds an entry: a collision. The new entry will join the chain.`,
  });
  if (buckets[i] === null) {
    rec.at(5, 'buckets[i] = entry', {
      changes: true,
      label: 'Put it in the bucket',
      text: 'The bucket now points at the entry.',
    });
    buckets[i] = entry;
    rec.at(6, 'return', { label: 'Done' });
    return;
  }
  rec.at(8, 'let tail = buckets[i]', {
    text: 'Start at the first entry of the chain and walk to its end.',
  });
  let tail = buckets[i];
  rec.ref('tail', tail);
  while (tail.next !== null) {
    rec.at(9, 'tail.next !== null', {
      expr: true,
      label: 'Is this the last entry?',
      text: 'It points at another entry, so it is not the last one.',
    });
    rec.at(10, 'tail = tail.next', { label: 'Step along the chain' });
    tail = tail.next;
    rec.ref('tail', tail);
  }
  rec.at(9, 'tail.next !== null', {
    expr: true,
    label: 'Is this the last entry?',
    text: 'Its next is null: this is the end of the chain.',
  });
  rec.at(12, 'tail.next = entry', {
    changes: true,
    label: 'Chain the entry on',
    text: 'The last entry now points at the new one. Both keys live in the same bucket and are told apart by comparing keys.',
  });
  tail.next = entry;
}
//#endregion

export { put };
