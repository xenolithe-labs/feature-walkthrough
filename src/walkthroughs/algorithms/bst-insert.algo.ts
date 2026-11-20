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
function insert(root, key) {
  rec.step(`Insert ${key}`);
  rec.at(2, 'const node = { key, left: null, right: null }', {
    label: `Make a node for ${key}`,
    text: 'The new node starts as a leaf: it has a key and both children are empty. Nothing points at it yet.',
  });
  const node = { key, left: null, right: null };
  rec.node(node, { id: `n${key}` });
  rec.ref('node', key);
  rec.ref('curr', null);
  rec.ref('side', '');
  rec.at(3, 'if (root === null) return node', {
    text: 'An empty tree would just become this node. This tree has a root, so go on.',
  });
  if (root === null) return node;
  rec.at(4, 'let curr = root', {
    text: 'curr is where the search is. It starts at the root.',
  });
  let curr = root;
  rec.ref('curr', curr);
  while (true) {
    rec.at(6, 'key < curr.key', {
      expr: true,
      label: 'Smaller or not?',
      text: () =>
        `Compare ${key} with the key here, ${curr.key}. Smaller keys go left, the rest go right.`,
    });
    const side = key < curr.key ? 'left' : 'right';
    rec.ref('side', side);
    rec.at(7, 'curr[side] === null', {
      expr: true,
      label: 'Is that side free?',
      text: () =>
        curr[side] === null
          ? `Nothing is on the ${side} of ${curr.key}: this is where the new node belongs.`
          : `There is already a node on the ${side}, so the search has to go on down.`,
    });
    if (curr[side] === null) {
      rec.at(8, 'curr[side] = node', {
        changes: true,
        label: 'Hang the node here',
        text: 'One pointer changes and the tree has a new leaf. No other node moves.',
      });
      curr[side] = node;
      rec.at(9, 'return root', {
        label: 'Done',
        text: 'The root is the same node as before, so it is what the caller gets back.',
      });
      return root;
    }
    rec.at(11, 'curr = curr[side]', {
      label: 'Step down',
      text: 'Follow the pointer to the child and look again.',
    });
    curr = curr[side];
    rec.ref('curr', curr);
  }
}
//#endregion

export { insert };
