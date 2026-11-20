/**
 * A line diff, written here so the viewer needs no dependency.
 *
 * `diffLines(before, after)` returns every line of both texts in reading order: a line both have
 * (`same`), a line only `before` has (`del`) or a line only `after` has (`add`). Each row carries
 * the 1-based number of the line in the text it comes from.
 *
 * The result is deterministic and comes from a longest common subsequence, so a moved block is a
 * removal and an addition, and repeated lines (a closing brace, a blank line) are matched in a
 * fixed way: common lines at the start and end are matched first, and inside a changed region a
 * tie is settled by showing the removals of that region before its additions. Last, a block that
 * could sit higher or lower (a new function between two that end the same way) is slid down as
 * far as it goes, which is where a reader looks for it.
 */
export interface DiffRow {
  kind: 'same' | 'add' | 'del';
  text: string;
  /** Line number in the old text; absent for an added line. */
  oldNo?: number;
  /** Line number in the new text; absent for a removed line. */
  newNo?: number;
}

/** Above this many table cells the middle is shown as all removed, then all added. */
const MAX_CELLS = 4_000_000;

function script(before: readonly string[], after: readonly string[]): DiffRow[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start])
    start += 1;
  let endA = before.length;
  let endB = after.length;
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i += 1) {
    rows.push({ kind: 'same', text: before[i]!, oldNo: i + 1, newNo: i + 1 });
  }
  const n = endA - start;
  const m = endB - start;
  const a = (k: number) => before[start + k]!;
  const b = (k: number) => after[start + k]!;
  const del = (k: number) => rows.push({ kind: 'del', text: a(k), oldNo: start + k + 1 });
  const add = (k: number) => rows.push({ kind: 'add', text: b(k), newNo: start + k + 1 });
  let i = 0;
  let j = 0;
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    for (; i < n; i += 1) del(i);
    for (; j < m; j += 1) add(j);
  } else {
    // lcs[x * width + y]: length of the longest common subsequence of a[x..] and b[y..].
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let x = n - 1; x >= 0; x -= 1) {
      for (let y = m - 1; y >= 0; y -= 1) {
        lcs[x * width + y] =
          a(x) === b(y)
            ? lcs[(x + 1) * width + y + 1]! + 1
            : Math.max(lcs[(x + 1) * width + y]!, lcs[x * width + y + 1]!);
      }
    }
    while (i < n && j < m) {
      if (a(i) === b(j)) {
        rows.push({ kind: 'same', text: a(i), oldNo: start + i + 1, newNo: start + j + 1 });
        i += 1;
        j += 1;
      } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
        del(i);
        i += 1;
      } else {
        add(j);
        j += 1;
      }
    }
    for (; i < n; i += 1) del(i);
    for (; j < m; j += 1) add(j);
  }
  for (let k = 0; k < before.length - endA; k += 1) {
    rows.push({
      kind: 'same',
      text: before[endA + k]!,
      oldNo: endA + k + 1,
      newNo: endB + k + 1,
    });
  }
  return rows;
}

/**
 * Moves an added (or removed) block down while its first line equals the line after it, so that
 * "}" "" "resource ..." "}" "" is shown as the new resource, not as a stray brace and blank line
 * above it. This is the placement a reader expects, and it is as fixed as the rest.
 */
function slide(rows: DiffRow[]): DiffRow[] {
  const ops = rows.map((row) => ({ kind: row.kind, text: row.text }));
  let start = 0;
  while (start < ops.length) {
    const kind = ops[start]!.kind;
    if (kind === 'same') {
      start += 1;
      continue;
    }
    let end = start;
    while (end < ops.length && ops[end]!.kind === kind) end += 1;
    // Only a block with plain lines on both sides can move without running into another change.
    while (end < ops.length && ops[end]!.kind === 'same' && ops[end]!.text === ops[start]!.text) {
      ops[start] = { kind: 'same', text: ops[start]!.text };
      ops[end] = { kind, text: ops[end]!.text };
      start += 1;
      end += 1;
      while (end < ops.length && ops[end]!.kind === kind) end += 1;
    }
    start = end;
  }
  let oldNo = 0;
  let newNo = 0;
  return ops.map((op) => {
    if (op.kind !== 'add') oldNo += 1;
    if (op.kind !== 'del') newNo += 1;
    return {
      kind: op.kind,
      text: op.text,
      ...(op.kind === 'add' ? {} : { oldNo }),
      ...(op.kind === 'del' ? {} : { newNo }),
    };
  });
}

export function diffLines(before: readonly string[], after: readonly string[]): DiffRow[] {
  return slide(script(before, after));
}
