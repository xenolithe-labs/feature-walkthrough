import { Recorder } from '../../recorder';
import { quicksort, setRecorder } from './quicksort.algo';

/**
 * The text the reader sees. `tests/unit/algorithms.test.ts` checks that it is the algorithm in
 * `quicksort.algo.ts` with the recorder's calls taken out, and runs it on its own.
 */
export const SOURCE = `function quicksort(items, lo, hi) {
  if (lo >= hi) {
    return;
  }
  const p = partition(items, lo, hi);
  quicksort(items, lo, p - 1);
  quicksort(items, p + 1, hi);
}

function partition(items, lo, hi) {
  const pivot = items[hi];
  let i = lo;
  for (let j = lo; j < hi; j++) {
    if (items[j] < pivot) {
      [items[i], items[j]] = [items[j], items[i]];
      i++;
    }
  }
  [items[i], items[hi]] = [items[hi], items[i]];
  return i;
}`;

/**
 * Five values, the smallest run that has everything the walkthrough is about: a real swap, a value
 * left alone, a part that is out of order (19, 12), a part that is already in order (31, 46), a
 * call on one cell and a call on none. Two digits, so no value reads as an index.
 */
export const INPUT = [31, 19, 46, 12, 23];

type Side = 'left' | 'right';

const cells = (lo: number, hi: number) => (lo === hi ? `cell ${lo}` : `cells ${lo} to ${hi}`);
const call = (lo: number, hi: number) => `quicksort(items, ${lo}, ${hi})`;

/**
 * What the algorithm file calls `rec`: one method per thing that happens, each making one card.
 * The words state this run's values, read from the tracked array without recording a read, so
 * they cannot disagree with the pictures. Steps and wording depend on how deep the recursion is,
 * which a plain `rec.at()` line in the algorithm cannot know.
 */
function narrator(rec: Recorder, items: number[]) {
  const peek = <T>(read: () => T): T => rec.silently(read);
  /** The calls to `quicksort` that have not returned, outermost first. */
  const open: { lo: number; hi: number; side?: Side; pivot?: number }[] = [];
  let pending: Side | undefined;
  const said = new Set<string>();
  /** True the first time it is asked about `what`: a thing is explained once. */
  const first = (what: string) => !said.has(what) && said.add(what) !== undefined;
  let swapped = false;
  /** The brackets now drawn over the cells of calls that wait for a call they made. */
  const waiting: ({ lo: number; hi: number } | undefined)[] = [];

  /** Draws the innermost open call as the range being sorted and each caller as a waiting bracket. */
  const brackets = () => {
    const callers = open.slice(0, -1);
    for (let depth = 0; depth < Math.max(callers.length, waiting.length); depth += 1) {
      const id = `waiting-${depth + 1}`;
      const want = callers[depth];
      const have = waiting[depth];
      if (want === undefined && have !== undefined) rec.remove('items', id);
      if (want !== undefined && have === undefined) rec.add('items', id);
      if (want !== undefined && (have?.lo !== want.lo || have.hi !== want.hi)) {
        rec.update('items', id, { from: want.lo, to: want.hi });
      }
      waiting[depth] = want === undefined ? undefined : { lo: want.lo, hi: want.hi };
    }
    const inner = open.at(-1)!;
    rec.range('active', inner.lo, inner.hi);
  };

  const at = new Map<string, number | null>();
  /** Moves a pointer. Clearing one that is not shown is not a change, so it is not recorded. */
  const point = (name: string, index: number | null) => {
    if (index === null && (at.get(name) ?? null) === null) return;
    at.set(name, index);
    rec.point(name, index);
  };

  return {
    point,

    /** The first card: nobody called this `quicksort`, so no line of the caller opens it. */
    begin(lo: number, hi: number) {
      rec.step(`Start on ${cells(lo, hi)}`, '`quicksort` is asked to sort every cell.');
      rec.at(5, 'partition(items, lo, hi)', {
        label: call(lo, hi),
        text: `\`lo\` = ${lo} and \`hi\` = ${hi} are the first and last cell to sort: more than one, so \`quicksort\` calls \`partition\` to split them around one value.`,
      });
    },

    enter(lo: number, hi: number) {
      open.push({ lo, hi, ...(pending === undefined ? {} : { side: pending }) });
      pending = undefined;
      brackets();
      rec.enter('quicksort', { items: 'items', lo, hi });
    },

    returnAtOnce(lo: number, hi: number) {
      rec.tone('items', [lo, hi], 'good');
      rec.leave();
      open.pop();
    },

    pickPivot(lo: number, hi: number) {
      const pivot = peek(() => items[hi]!);
      open.at(-1)!.pivot = pivot;
      swapped = false;
      rec.at([11, 12], 'const pivot = items[hi]', {
        label: `Pick the pivot: ${pivot}`,
        text: first('pivot')
          ? `\`partition\` takes the last value, ${pivot}, as the pivot: every other value will be compared with it. \`i\` is ${lo}: the next value smaller than ${pivot} will be swapped into that cell.`
          : `The last value of ${cells(lo, hi)} is ${pivot}. \`i\` starts at \`lo\` = ${lo}.`,
      });
      point('pivot', hi);
      point('i', lo);
    },

    compare(lo: number, hi: number, i: number, j: number) {
      const [value, pivot, atI, next] = peek(() => [
        items[j]!,
        items[hi]!,
        items[i]!,
        items[j + 1]!,
      ]);
      const top = open.length === 1;
      if (top && j === lo) {
        rec.step(
          'Move smaller values left',
          `Each value before ${pivot} is compared with it once. A smaller one is swapped into the cell at \`i\`.`,
        );
      }
      if (value >= pivot) {
        rec.at(14, 'items[j] < pivot', {
          expr: true,
          label: `${value} < ${pivot}? No`,
          text:
            (first('no')
              ? `${value} is not smaller than ${pivot}, so it stays in cell ${j}.`
              : `${value} stays in cell ${j}.`) +
            (first('ask-compare') && j + 1 < hi ? ` What will happen to ${next}?` : ''),
        });
      } else if (i === j) {
        rec.at([14, 16], 'items[j] < pivot', {
          changes: true,
          label: `${value} < ${pivot}? Yes: swap it with itself`,
          text: `${value} is already in the cell at \`i\`, so it swaps with itself and nothing moves. \`i\` moves from ${i} to ${i + 1}.`,
        });
      } else {
        swapped = true;
        rec.at([14, 16], 'items[j] < pivot', {
          changes: true,
          label: `${value} < ${pivot}? Yes: swap it into cell ${i}`,
          text:
            (first('yes')
              ? `${value} swaps with ${atI}, the value at \`i\`, and \`i\` moves from ${i} to ${i + 1}.`
              : `${value} swaps with ${atI} at \`i\`, and \`i\` moves from ${i} to ${i + 1}.`) +
            (top && j === hi - 1 ? ` Which cell will ${pivot} end in?` : ''),
        });
      }
      point('j', j);
      point('pivot', hi);
    },

    place(lo: number, hi: number, i: number) {
      const [pivot, atI] = peek(() => [items[hi]!, items[i]!]);
      if (open.length === 1) {
        rec.step('Place the pivot', `Every value before ${pivot} has been compared with it.`);
      }
      const explain = first('final');
      const text =
        i === hi
          ? `\`i\` = ${i} is where ${pivot} already is, so it swaps with itself and is in its final place. \`partition\` returns ${i}.` +
            (swapped
              ? ''
              : ` Cells ${lo} to ${hi} were already in order, yet every step still ran.`)
          : explain
            ? `${pivot} swaps with ${atI} at \`i\` = ${i}, and \`partition\` returns ${i}. Every value left of ${pivot} is smaller and every value right of it is not, so sorting either side cannot move ${pivot}: it is in its final place (green outline).`
            : `${pivot} swaps with ${atI} at \`i\` = ${i} and is in its final place. \`partition\` returns ${i}.`;
      rec.at([19, 20], '[items[i], items[hi]]', {
        changes: true,
        label: `Put ${pivot} in cell ${i}`,
        text,
      });
    },

    placed(i: number) {
      point('pivot', i);
      point('j', null);
      rec.tone('items', i, 'good');
    },

    recurse(side: Side, lo: number, hi: number, p: number) {
      const frame = open.at(-1)!;
      const pivot = frame.pivot!;
      const [from, to] = side === 'left' ? [lo, p - 1] : [p + 1, hi];
      const part = frame.side ?? side;
      const where = `${side} of ${pivot}`;
      if (open.length === 1) {
        rec.step(
          `${side === 'left' ? 'Left' : 'Right'} part: the same again`,
          `The cells ${where} are sorted by ${side === 'left' ? 'a new' : 'another'} call to \`quicksort\`.`,
        );
      } else if (side === 'left') {
        rec.step(
          `${part === 'left' ? 'Left' : 'Right'} part: one cell or none`,
          'A call on one cell or none has nothing to sort.',
        );
      }
      const bound = side === 'left' ? '`p - 1`' : '`p + 1`';
      let text: string;
      if (to > from) {
        text = first('wait')
          ? `\`${call(lo, hi)}\` keeps the ${p} as \`p\`. It waits while the cells ${where}, ${from} to ${bound} = ${to}, are sorted the same way.`
          : `Here \`p\` is still ${p}. The cells ${where}, ${bound} = ${from} to ${to}, are sorted the same way.`;
      } else if (to === from) {
        const value = peek(() => items[from]!);
        text = first('one')
          ? `One cell, holding ${value}. A single value needs no sorting: ${value} is in its final place and the call returns at once.`
          : `One cell, holding ${value}: it is in its final place and the call returns at once.`;
      } else {
        const edge =
          side === 'left'
            ? `Here \`p\` is ${p}, so ${bound} is ${to}, below \`lo\` = ${from}`
            : `Here \`p\` is ${p}, so ${bound} is ${from}, above \`hi\` = ${to}`;
        text = `${edge}: no cells are ${where}, and the call returns at once.`;
      }
      rec.at(
        side === 'left' ? 6 : 7,
        side === 'left' ? 'quicksort(items, lo, p - 1)' : 'quicksort(items, p + 1, hi)',
        {
          label: `${side === 'left' ? 'Left' : 'Right'} of ${pivot}: ${call(from, to)}`,
          text,
        },
      );
      point('i', null);
      point('pivot', null);
      point('j', null);
      pending = side;
    },

    returns(lo: number, hi: number) {
      const parent = open.at(-2);
      let text: string;
      if (parent === undefined) {
        const sorted = peek(() => [...items]).join(', ');
        text = `Sorted: ${sorted}. Each \`partition\` put one pivot in its final place and left fewer cells on each side, down to one or none. Each side was sorted without touching the other.`;
      } else {
        text =
          `Cells ${lo} to ${hi} are sorted.` +
          (first('resume')
            ? ` \`${call(parent.lo, parent.hi)}\`, which was waiting, carries on. Which cells does it sort next?`
            : '');
      }
      rec.at(8, '}', { label: `${call(lo, hi)} returns`, text });
      brackets();
      // The last call to return leaves no bracket: nothing is being sorted any more.
      if (parent === undefined) rec.remove('items', 'active');
      rec.leave();
      open.pop();
    },
  };
}

export function recordQuicksort() {
  const rec = new Recorder({
    id: 'quicksort',
    title: 'Quicksort: partition, then sort each side',
    lead: 'Quicksort picks one value, the pivot, moves every smaller value to its left, then sorts each side the same way. This is Lomuto’s partition on five values, every comparison shown. Omitted: other ways to choose the pivot, Hoare’s partition, equal values, and running time.',
    tags: ['algorithm', 'sorting', 'recursion'],
    source: { title: 'quicksort.js', lang: 'js', text: SOURCE },
  });
  const items = rec.array('items', [...INPUT], {
    title: 'Array, with a bracket per unfinished quicksort call',
    pointers: [{ id: 'pivot', side: 'above' }, 'i', 'j'],
    ranges: [
      { id: 'waiting-1', label: 'waiting' },
      { id: 'waiting-2', label: 'waiting' },
      { id: 'active', label: 'sorting', dim: true },
    ],
  });
  const story = narrator(rec, items);
  setRecorder(story);
  story.begin(0, items.length - 1);
  quicksort(items, 0, items.length - 1);
  return { config: rec.finish(), result: items };
}

export const quicksortRun = recordQuicksort();
export const quicksortDemo = quicksortRun.config;
