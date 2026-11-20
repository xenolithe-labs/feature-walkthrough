import { describe, expect, it } from 'vitest';
import { codeSpans, mentions, normalise, sentencesOf, textStats } from '../../src/review';

describe('counting words and sentences', () => {
  it('counts plain words', () => {
    expect(textStats('The client asks the server.')).toEqual({
      words: 5,
      sentences: 1,
      question: false,
    });
    expect(textStats('')).toEqual({ words: 0, sentences: 0, question: false });
    expect(textStats(undefined).words).toBe(0);
  });

  it('counts a backtick span as one word', () => {
    expect(textStats('Run `git commit -m "fix it"` now.').words).toBe(3);
  });

  it('does not count punctuation alone as a word', () => {
    expect(textStats('One - two — three').words).toBe(3);
  });

  it('does not end a sentence at a decimal, a version, a file name or an abbreviation', () => {
    expect(sentencesOf('It takes 3.5 seconds on v1.2.3 in lint.ts, e.g. at night.')).toHaveLength(
      1,
    );
    expect(sentencesOf('Use i.e. the second one. Then stop.')).toHaveLength(2);
  });

  it('does not end a sentence inside a backtick span', () => {
    expect(sentencesOf('Call `a. B` once. Then stop.')).toHaveLength(2);
  });

  it('ends a sentence at a semicolon, and at a colon that joins two statements', () => {
    expect(sentencesOf('The client sends the code; the server checks the code.')).toHaveLength(2);
    expect(
      sentencesOf('The client sends the code to the server: the server then checks the code.'),
    ).toHaveLength(2);
  });

  it('keeps a short label before a colon with its statement', () => {
    expect(sentencesOf('Result: the old id is gone.')).toHaveLength(1);
    expect(sentencesOf('Note: balance 40 becomes 25.')).toHaveLength(1);
  });

  it('leaves a trailing prediction question out of both counts', () => {
    const stats = textStats('The window is 5 to 9. Which side will the search keep?');
    expect(stats).toEqual({ words: 6, sentences: 1, question: true });
  });

  it('counts a text that is only a question', () => {
    expect(textStats('Which side will it keep?')).toEqual({
      words: 5,
      sentences: 1,
      question: false,
    });
  });

  it('finds code spans and whole-token mentions', () => {
    expect(codeSpans('Use `lo` and `hi`, not lo.')).toEqual(['lo', 'hi']);
    expect(mentions('balance 40 becomes 25', '25')).toBe(true);
    expect(mentions('balance 400', '40')).toBe(false);
    expect(mentions('The ID is s_7f3a.', 's_7f3a')).toBe(true);
    expect(normalise('  A  b\nC ')).toBe('a b c');
  });
});
