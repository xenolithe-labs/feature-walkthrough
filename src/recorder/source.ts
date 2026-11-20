/**
 * Helpers for keeping the source a reader sees equal to the code that ran.
 */

/**
 * Removes the recorder's own statements from instrumented source: every statement that starts a
 * line with `<hook>.` (default `rec.`), however many lines it spans. What is left is the
 * algorithm as a reader should see it.
 */
export function stripHooks(source: string, hooks: readonly string[] = ['rec']): string {
  const lines = source.split('\n');
  const starts = hooks.map((hook) => `${hook}.`);
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trimStart();
    if (!starts.some((start) => trimmed.startsWith(start))) {
      kept.push(lines[index]!);
      continue;
    }
    index = statementEnd(lines, index);
  }
  return kept.join('\n');
}

/** The last line of the statement that starts on line `start`: brackets balanced, strings closed. */
function statementEnd(lines: string[], start: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]!;
    for (let at = 0; at < line.length; at += 1) {
      const char = line[at]!;
      if (quote !== undefined) {
        if (char === '\\') at += 1;
        else if (char === quote) quote = undefined;
      } else if (char === '"' || char === "'" || char === '`') {
        quote = char;
      } else if (char === '(' || char === '[' || char === '{') {
        depth += 1;
      } else if (char === ')' || char === ']' || char === '}') {
        depth -= 1;
      }
    }
    // A string cannot run past its line unless it is a template literal.
    if (quote !== undefined && quote !== '`') quote = undefined;
    if (depth <= 0 && quote === undefined) return index;
  }
  throw new Error(`the statement that starts on line ${start + 1} never ends`);
}

/** A line number or an inclusive range of them, counting from 1. */
export type Lines = number | readonly [number, number];

/**
 * Checks that the named lines really contain `snippet` and says what is there if not. This is
 * what makes a wrong line number fail instead of misleading a reader.
 */
export function checkLines(source: string, lines: Lines, snippet: string): [number, number] {
  const rows = source.split('\n');
  const [first, last] = typeof lines === 'number' ? [lines, lines] : lines;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first) {
    throw new RangeError(
      `lines ${JSON.stringify(lines)}: expected a line number, or [first, last]`,
    );
  }
  if (snippet === '') throw new RangeError('the snippet that proves a line number cannot be empty');
  if (last > rows.length) {
    throw new RangeError(
      `line ${last} is past the end of the source, which has ${rows.length} lines`,
    );
  }
  const text = rows.slice(first - 1, last).join('\n');
  if (!text.includes(snippet)) {
    const elsewhere = rows
      .map((row, index) => (row.includes(snippet) ? index + 1 : 0))
      .filter((line) => line > 0);
    const hint =
      elsewhere.length === 0
        ? 'it is not anywhere in the source'
        : `it is on line ${elsewhere.join(', ')}`;
    const where = first === last ? `line ${first}` : `lines ${first} to ${last}`;
    throw new Error(
      `${where} is ${JSON.stringify(text.trim())}, which does not contain ${JSON.stringify(snippet)}; ${hint}`,
    );
  }
  return [first, last];
}
