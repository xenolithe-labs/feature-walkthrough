/**
 * Counting words and sentences the way the design guidance means them: a backtick span is one
 * word, a decimal, a version or a file name does not end a sentence, a colon or semicolon that
 * joins two statements does, and a prediction question at the end does not count.
 */

export interface TextStats {
  /** Words, not counting a trailing prediction question. */
  words: number;
  /** Sentences, not counting a trailing prediction question. */
  sentences: number;
  /** The text ends with a question that was left out of both counts. */
  question: boolean;
}

const SPAN = /`[^`\n]*`/g;
const ABBREVIATION = /\b(e\.g|i\.e|vs|etc|cf|approx|incl|no|fig)\./gi;

/** The words of a text, each backtick span as one. */
function wordsOf(text: string): string[] {
  return text
    .replace(SPAN, ' X ')
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token));
}

/** Splits at the ends of sentences and at a colon or semicolon that joins two statements. */
export function sentencesOf(text: string): string[] {
  const flat = text
    .replace(SPAN, 'X')
    .replace(ABBREVIATION, (match) => match.replace(/\./g, '\uE000'))
    .trim();
  if (flat === '') return [];
  const parts: string[] = [];
  let start = 0;
  const boundary = /([.!?]+["')\]]*)\s+(?=[\p{Lu}\p{N}"'([])|(;)\s+(?=\S)|(:)\s+(?=\S)/gu;
  for (let match = boundary.exec(flat); match !== null; match = boundary.exec(flat)) {
    const end = match.index + (match[1] ?? match[2] ?? match[3] ?? '').length;
    const before = flat.slice(start, end);
    if (match[3] !== undefined) {
      // A colon joins two statements only when both halves are long enough to be statements.
      const after = flat.slice(match.index + match[0].length);
      const next = after.search(/[.!?;:]\s|$/);
      if (wordsOf(before).length < 4 || wordsOf(after.slice(0, next)).length < 4) continue;
    }
    parts.push(before);
    start = match.index + match[0].length;
  }
  parts.push(flat.slice(start));
  return parts.map((part) => part.replace(/\uE000/g, '.').trim()).filter((part) => part !== '');
}

export function textStats(text: string | undefined): TextStats {
  const sentences = sentencesOf(text ?? '');
  const last = sentences[sentences.length - 1];
  const question = last !== undefined && sentences.length > 1 && /\?["')\]]*$/.test(last);
  const counted = question ? sentences.slice(0, -1) : sentences;
  return {
    words: counted.reduce((sum, sentence) => sum + wordsOf(sentence).length, 0),
    sentences: counted.length,
    question,
  };
}

/** Text with case, spacing and markup quotes flattened, to find the same words written twice. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** What a text puts in backticks. */
export function codeSpans(text: string | undefined): string[] {
  return [...(text ?? '').matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!.trim());
}

/** True when `needle` appears in `text` as a whole token, ignoring case. */
export function mentions(text: string, needle: string): boolean {
  const wanted = needle.trim().toLowerCase();
  if (wanted === '') return false;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'u').test(
    text.toLowerCase(),
  );
}
