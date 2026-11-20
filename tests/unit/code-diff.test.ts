import { describe, expect, it } from 'vitest';
import { createFolder, loadConfig } from '../../src/core';
import { diffLines, type DiffRow } from '../../src/panels/code/diff';
import { promptOf, revealed, rowsOf } from '../../src/panels/code/index';
import { createRegistry } from '../../src/registry';
import { renderPane } from '../stress/render';

const kinds = (rows: DiffRow[]) =>
  rows.map((row) => `${{ same: ' ', add: '+', del: '-' }[row.kind]}${row.text}`);

/** The invariants of any diff: it rebuilds both texts, and numbers their lines in order. */
function check(before: string[], after: string[], rows: DiffRow[]) {
  expect(rows.filter((row) => row.kind !== 'add').map((row) => row.text)).toEqual(before);
  expect(rows.filter((row) => row.kind !== 'del').map((row) => row.text)).toEqual(after);
  expect(rows.filter((row) => row.oldNo !== undefined).map((row) => row.oldNo)).toEqual(
    before.map((_, index) => index + 1),
  );
  expect(rows.filter((row) => row.newNo !== undefined).map((row) => row.newNo)).toEqual(
    after.map((_, index) => index + 1),
  );
  for (const row of rows) {
    expect(row.oldNo === undefined).toBe(row.kind === 'add');
    expect(row.newNo === undefined).toBe(row.kind === 'del');
  }
}

/** Length of the longest common subsequence, worked out the slow way. */
function lcs(a: string[], b: string[]): number {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      table[i]![j] =
        a[i - 1] === b[j - 1]
          ? table[i - 1]![j - 1]! + 1
          : Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
    }
  }
  return table[a.length]![b.length]!;
}

describe('diffLines', () => {
  it('shows no change for equal texts, and everything for a text against nothing', () => {
    expect(kinds(diffLines(['a', 'b'], ['a', 'b']))).toEqual([' a', ' b']);
    expect(kinds(diffLines([], ['a']))).toEqual(['+a']);
    expect(kinds(diffLines(['a'], []))).toEqual(['-a']);
  });

  it('numbers lines of both texts: a change is a removal then an addition', () => {
    const rows = diffLines(['a', 'b', 'c'], ['a', 'B', 'c']);
    expect(kinds(rows)).toEqual([' a', '-b', '+B', ' c']);
    expect(rows[1]).toEqual({ kind: 'del', text: 'b', oldNo: 2 });
    expect(rows[2]).toEqual({ kind: 'add', text: 'B', newNo: 2 });
    expect(rows[3]).toEqual({ kind: 'same', text: 'c', oldNo: 3, newNo: 3 });
  });

  it('shows a moved line as a removal and an addition', () => {
    const rows = diffLines(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a']);
    expect(kinds(rows)).toEqual(['-a', ' b', ' c', ' d', '+a']);
    check(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a'], rows);
  });

  it('shows a moved block as the shorter side moving', () => {
    const before = ['one', 'two', 'x', 'y', 'z'];
    const after = ['x', 'y', 'z', 'one', 'two'];
    const rows = diffLines(before, after);
    check(before, after, rows);
    expect(rows.filter((row) => row.kind === 'same')).toHaveLength(3);
  });

  it('keeps repeated lines in a fixed place', () => {
    // Which "}" is new is a choice; the choice is the same every time, and the diff is minimal.
    const before = ['if (a) {', '  x();', '}'];
    const after = ['if (a) {', '  if (b) {', '    x();', '  }', '}'];
    const rows = diffLines(before, after);
    check(before, after, rows);
    expect(rows.filter((row) => row.kind !== 'same')).toHaveLength(
      before.length + after.length - 2 * lcs(before, after),
    );
    expect(diffLines(before, after)).toEqual(rows);
    expect(kinds(diffLines(['}', '}'], ['}', '}', '}']))).toEqual([' }', ' }', '+}']);
    expect(kinds(diffLines(['', 'a', ''], ['', ''])).join('|')).toBe(' |-a| ');
  });

  it('slides an added block down, so a new block shows from its own first line', () => {
    const before = ['a {', '  x', '}', '', 'out'];
    const after = ['a {', '  x', '}', '', 'b {', '  y', '}', '', 'out'];
    const rows = diffLines(before, after);
    check(before, after, rows);
    expect(kinds(rows)).toEqual([' a {', '   x', ' }', ' ', '+b {', '+  y', '+}', '+', ' out']);
    // The same for a removed block.
    expect(kinds(diffLines(after, before))).toEqual([
      ' a {',
      '   x',
      ' }',
      ' ',
      '-b {',
      '-  y',
      '-}',
      '-',
      ' out',
    ]);
  });

  it('puts removals before additions in a changed region', () => {
    expect(kinds(diffLines(['a', 'x', 'y', 'b'], ['a', 'p', 'q', 'b']))).toEqual([
      ' a',
      '-x',
      '-y',
      '+p',
      '+q',
      ' b',
    ]);
  });

  it('is minimal and consistent on many small random texts', () => {
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 300; round += 1) {
      const make = () => Array.from({ length: next(9) }, () => 'abc'[next(3)]!);
      const before = make();
      const after = make();
      const rows = diffLines(before, after);
      check(before, after, rows);
      expect(rows.filter((row) => row.kind === 'same')).toHaveLength(lcs(before, after));
      expect(diffLines(before, after)).toEqual(rows);
    }
  });

  it('still gives a correct, if coarse, answer for texts too large to compare in full', () => {
    const before = Array.from({ length: 3000 }, (_, index) => `old ${index}`);
    const after = Array.from({ length: 3000 }, (_, index) => `new ${index}`);
    const rows = diffLines(['top', ...before, 'end'], ['top', ...after, 'end']);
    check(['top', ...before, 'end'], ['top', ...after, 'end'], rows);
    expect(rows[0]!.kind).toBe('same');
    expect(rows.at(-1)!.kind).toBe('same');
  });
});

describe('rows, prompt and reveal', () => {
  it('rowsOf numbers a plain text, and diffs against a base', () => {
    expect(rowsOf(['a', 'b'], undefined)).toEqual([
      { kind: 'same', text: 'a', newNo: 1 },
      { kind: 'same', text: 'b', newNo: 2 },
    ]);
    expect(kinds(rowsOf(['a', 'c'], ['a', 'b']))).toEqual([' a', '-b', '+c']);
  });

  it('promptOf: true means "$ "', () => {
    expect(promptOf({})).toBeUndefined();
    expect(promptOf({ transcript: true })).toBe('$ ');
    expect(promptOf({ transcript: { prompt: '> ' } })).toBe('> ');
  });

  it('revealed keeps the count between none and all', () => {
    expect(revealed(undefined, 5)).toBe(0);
    expect(revealed(3, 5)).toBe(3);
    expect(revealed(9, 5)).toBe(5);
    expect(revealed(-2, 5)).toBe(0);
    expect(revealed('3', 5)).toBe(0);
  });
});

function walkthrough(sources: unknown[], calls: Record<string, unknown>[][]) {
  return {
    id: 'w',
    title: 'W',
    layout: { panes: [{ id: 'c', panel: 'code', content: { sources } }] },
    steps: [
      {
        id: 's',
        title: 'S',
        calls: calls.map((effects, index) => ({
          id: `c${index}`,
          label: `C${index}`,
          effects: { c: effects },
        })),
      },
    ],
  };
}
const load = (value: unknown) => loadConfig(value, createRegistry());
const rules = (value: unknown) => load(value).problems.map((item) => item.rule);

const DIFF = { id: 'd', title: 'd.txt', text: 'a\nB\nc\nnew', base: 'a\nb\nc' };
const LOG = { id: 't', title: 'log', text: '$ run\nok\nmore\ndone', transcript: true as const };

function html(source: unknown, effects: Record<string, unknown>[][], at = 0) {
  const loaded = load(walkthrough([source], effects));
  expect(loaded.problems).toEqual([]);
  const w = loaded.walkthroughs[0]!;
  return renderPane(w, w.panes[0]!, 0, at);
}

describe('code: diff view', () => {
  it('shows removed and added lines with a sign and both line numbers', () => {
    const out = html(DIFF, [[{ read: 'd', lines: [2], old: [2] }]]);
    expect(out).toContain('data-kind="del"');
    expect(out).toContain('data-kind="add"');
    expect(out).toContain('−');
    expect(out).toContain('>+<');
    // Not by colour alone: text for a screen reader says what a line is.
    expect(out).toContain('removed: ');
    expect(out).toContain('added: ');
    expect(out).toContain('aria-pressed="true">Changes<');
    expect(out).toContain('>Result<');
  });

  it('marks a removed line through "old", and a new line through "lines"', () => {
    const out = html(DIFF, [[{ read: 'd', old: [2] }]]);
    const marked = [...out.matchAll(/data-kind="(\w+)"[^>]*data-mark="read"/g)].map((m) => m[1]);
    expect(marked).toEqual(['del']);
    const out2 = html(DIFF, [[{ read: 'd', lines: [2] }]]);
    expect([...out2.matchAll(/data-kind="(\w+)"[^>]*data-mark="read"/g)].map((m) => m[1])).toEqual([
      'add',
    ]);
  });

  it('marks a context line from either number', () => {
    const out = html(DIFF, [[{ read: 'd', lines: [3], old: [1] }]]);
    expect([...out.matchAll(/data-kind="same"[^>]*data-mark="read"/g)]).toHaveLength(2);
  });

  it('marks an expression on a removed line', () => {
    const out = html(DIFF, [[{ read: 'd', old: [2], expr: 'b' }]]);
    expect(out).toContain('fw-code-expr is-read');
  });

  it('keeps the rows in the same place whatever a call marks', () => {
    const rowsOfHtml = (out: string) => [...out.matchAll(/data-row="(\d+)"/g)].map((m) => m[1]);
    const none = html(DIFF, [[{ read: 'd' }]]);
    const some = html(DIFF, [[{ read: 'd', lines: [4] }]]);
    expect(rowsOfHtml(some)).toEqual(rowsOfHtml(none));
  });

  it('has no switch for a source without a base', () => {
    expect(html({ id: 'p', title: 'p', text: 'x' }, [[{ read: 'p' }]])).not.toContain('>Result<');
  });
});

describe('code: transcript', () => {
  const rowsHidden = (out: string) =>
    [...out.matchAll(/class="fw-code-line( [^"]*)?"/g)].map((m) =>
      (m[1] ?? '').includes('is-hidden'),
    );

  it('shows nothing until revealed, then up to a line; later lines keep their place', () => {
    const effects = [
      [{ update: 't', fields: { upto: 1 } }],
      [{ update: 't', fields: { upto: 3 } }],
    ];
    expect(rowsHidden(html(LOG, effects, 0))).toEqual([false, true, true, true]);
    expect(rowsHidden(html(LOG, effects, 1))).toEqual([false, false, false, true]);
    // Hidden lines are still in the page (so nothing moves) but not offered to a screen reader.
    expect(html(LOG, effects, 0).match(/aria-hidden="true"/g)).toHaveLength(3);
  });

  it('shows no lines before the first reveal', () => {
    expect(rowsHidden(html(LOG, [[{ read: 't' }]]))).toEqual([true, true, true, true]);
  });

  it('tells commands from output by the prompt, and shows the prompt', () => {
    const out = html(LOG, [[{ update: 't', fields: { upto: 4 } }]]);
    expect(out.match(/is-command/g)).toHaveLength(1);
    expect(out).toContain('$ run');
    const custom = html({ ...LOG, text: '> go\nout', transcript: { prompt: '> ' } }, [
      [{ update: 't', fields: { upto: 2 } }],
    ]);
    expect(custom.match(/is-command/g)).toHaveLength(1);
  });

  it('goes back when the reader steps back', () => {
    const loaded = load(
      walkthrough(
        [LOG],
        [[{ update: 't', fields: { upto: 1 } }], [{ update: 't', fields: { upto: 4 } }]],
      ),
    );
    const w = loaded.walkthroughs[0]!;
    const folder = createFolder(w);
    const hidden = (c: number) => rowsHidden(renderPane(w, w.panes[0]!, 0, c, folder));
    expect(hidden(1)).toEqual([false, false, false, false]);
    expect(hidden(0)).toEqual([false, true, true, true]);
  });

  it('marks only lines that are revealed', () => {
    const out = html(LOG, [[{ update: 't', fields: { upto: 2 }, lines: [2] }]]);
    expect(out.match(/data-mark="updated"/g)).toHaveLength(1);
  });
});

describe('code lint: diff and transcript', () => {
  const one = (source: unknown, effects: Record<string, unknown>[][]) =>
    rules(walkthrough([source], effects));

  it('code/line-out-of-range: a line past the text, or past the base', () => {
    expect(one(DIFF, [[{ read: 'd', lines: [5] }]])).toEqual(['code/line-out-of-range']);
    expect(one(DIFF, [[{ read: 'd', old: [4] }]])).toEqual(['code/line-out-of-range']);
    expect(one(DIFF, [[{ read: 'd', lines: [4], old: [3] }]])).toEqual([]);
  });

  it('code/line-out-of-range follows the text a call replaced', () => {
    expect(
      one(DIFF, [[{ update: 'd', fields: { text: 'a\nb' } }], [{ read: 'd', lines: [3] }]]),
    ).toEqual(['code/line-out-of-range']);
  });

  it('code/reversed-range: in lines and in old', () => {
    expect(one(DIFF, [[{ read: 'd', lines: [[3, 2]] }]])).toEqual(['code/reversed-range']);
    expect(one(DIFF, [[{ read: 'd', old: [[3, 2]] }]])).toEqual(['code/reversed-range']);
  });

  it('code/old-without-base: "old" needs a base', () => {
    expect(one({ id: 'p', title: 'p', text: 'x' }, [[{ read: 'p', old: [1] }]])).toEqual([
      'code/old-without-base',
    ]);
  });

  it('code/expr-not-on-lines: looks on the new and the old lines named', () => {
    expect(one(DIFF, [[{ read: 'd', old: [2], expr: 'b' }]])).toEqual([]);
    expect(one(DIFF, [[{ read: 'd', old: [2], expr: 'zzz' }]])).toEqual(['code/expr-not-on-lines']);
  });

  it('code/diff-transcript: a source is one or the other', () => {
    expect(one({ ...DIFF, transcript: true }, [[{ read: 'd' }]])).toEqual(['code/diff-transcript']);
  });

  it('code/no-changes: a base equal to the text is a warning', () => {
    const problems = load(walkthrough([{ ...DIFF, base: DIFF.text }], [[{ read: 'd' }]])).problems;
    expect(problems.map((p) => [p.rule, p.severity])).toEqual([['code/no-changes', 'warning']]);
  });

  it('code/tokens-mismatch: colours of a base must spell out the base', () => {
    const stale = { palette: [['#000000', '#ffffff']], lines: [[['other', 0]]] };
    expect(one({ ...DIFF, baseTokens: stale }, [[{ read: 'd' }]])).toEqual([
      'code/tokens-mismatch',
    ]);
    const right = {
      palette: [['#000000', '#ffffff']],
      lines: [[['a', 0]], [['b', 0]], [['c', 0]]],
    };
    expect(one({ ...DIFF, baseTokens: right }, [[{ read: 'd' }]])).toEqual([]);
    expect(one({ id: 'p', title: 'p', text: 'x', baseTokens: right }, [[{ read: 'p' }]])).toEqual([
      'code/tokens-mismatch',
    ]);
  });

  it('code/upto-backwards: a transcript only grows', () => {
    expect(
      one(LOG, [[{ update: 't', fields: { upto: 3 } }], [{ update: 't', fields: { upto: 2 } }]]),
    ).toEqual(['code/upto-backwards']);
    expect(
      one(LOG, [[{ update: 't', fields: { upto: 3 } }], [{ update: 't', fields: { upto: 3 } }]]),
    ).toEqual([]);
  });

  it('code/upto-out-of-range: past the end, or not a count', () => {
    expect(one(LOG, [[{ update: 't', fields: { upto: 5 } }]])).toEqual(['code/upto-out-of-range']);
    expect(one(LOG, [[{ update: 't', fields: { upto: -1 } }]])).toEqual(['code/upto-out-of-range']);
    expect(one(LOG, [[{ update: 't', fields: { upto: 1.5 } }]])).toEqual([
      'code/upto-out-of-range',
    ]);
    expect(one(LOG, [[{ update: 't', fields: { upto: 'all' } }]])).toEqual([
      'code/upto-out-of-range',
    ]);
    expect(one(LOG, [[{ update: 't', fields: { upto: 4 } }]])).toEqual([]);
  });

  it('code/upto-out-of-range counts the lines of replaced text', () => {
    expect(one(LOG, [[{ update: 't', fields: { text: 'a\nb\nc\nd\ne\nf', upto: 6 } }]])).toEqual(
      [],
    );
  });

  it('code/upto-not-transcript: "upto" on an ordinary source', () => {
    expect(one(DIFF, [[{ update: 'd', fields: { upto: 1 } }]])).toEqual([
      'code/upto-not-transcript',
    ]);
  });

  it('code/line-not-revealed: marking a line that is still hidden', () => {
    expect(one(LOG, [[{ update: 't', fields: { upto: 2 }, lines: [3] }]])).toEqual([
      'code/line-not-revealed',
    ]);
    expect(one(LOG, [[{ update: 't', fields: { upto: 3 }, lines: [[2, 3]] }]])).toEqual([]);
  });
});
