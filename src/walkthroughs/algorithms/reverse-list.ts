import { Recorder } from '../../recorder';
import { reverse, setRecorder } from './reverse-list.algo';

/**
 * The text the reader sees. `tests/unit/structures.test.ts` checks that it is the algorithm in
 * `reverse-list.algo.ts` with the recorder's calls taken out, and runs it on its own.
 */
export const SOURCE = `function reverse(head) {
  let prev = null;
  let curr = head;
  while (curr !== null) {
    const next = curr.next;
    curr.next = prev;
    prev = curr;
    curr = next;
  }
  return prev;
}`;

export const VALUES = [7, 3, 9, 4];

export interface ListNode {
  val: number;
  next: ListNode | null;
}

/** A plain list of the values, for running the shown code without a recorder. */
export function plainList(values: readonly number[]): ListNode | null {
  let head: ListNode | null = null;
  for (const val of [...values].reverse()) head = { val, next: head };
  return head;
}

export function recordReverse() {
  const rec = new Recorder({
    id: 'reverse-list',
    title: 'Reversing a linked list in place',
    lead: 'Three pointers walk down the list, turning each node round as they go. No node is copied: every next pointer is changed where it stands.',
    tags: ['algorithm', 'data structure', 'linked list'],
    source: { title: 'reverse.js', lang: 'js', text: SOURCE },
  });
  const heap = rec.records('list', {
    title: 'Linked list',
    direction: 'RIGHT',
    layout: 'tree',
  });
  heap.vars('vars', { prev: null, curr: null, next: null }, { head: false });
  // Setup: the list is built before the first call, so it is there from the start.
  let head: ListNode | null = null;
  for (const [index, val] of [...VALUES].reverse().entries()) {
    head = heap.node({ val, next: head }, { id: `n${VALUES.length - index}`, head: false });
  }
  setRecorder(rec);
  const result = reverse(head);
  return { config: rec.finish(), result };
}

export const reverseRun = recordReverse();
export const reverseListDemo = reverseRun.config;
