import { describe, expect, it } from 'vitest';
import {
  PLAY_CEILING_MS,
  PLAY_FLOOR_MS,
  WalkthroughSchema,
  playDelay,
  resolveMotion,
  wordCount,
} from '../../src/core';
import { demos } from '../../src/walkthroughs';

const T = true;
const F = false;
const U = undefined;

describe('resolveMotion', () => {
  it('is off unless something turns it on', () => {
    expect(resolveMotion(U, U, U, F)).toBe(false);
  });

  it('takes the author default, then the reader, then the address', () => {
    expect(resolveMotion(U, U, T, F)).toBe(true);
    expect(resolveMotion(U, F, T, F)).toBe(false);
    expect(resolveMotion(U, T, F, F)).toBe(true);
    expect(resolveMotion(T, F, F, F)).toBe(true);
    expect(resolveMotion(F, T, T, F)).toBe(false);
  });

  it('lets reduced motion win over every switch', () => {
    for (const a of [T, F, U]) {
      for (const b of [T, F, U]) {
        for (const c of [T, F, U]) expect(resolveMotion(a, b, c, true)).toBe(false);
      }
    }
  });
});

describe('playDelay', () => {
  it('has a floor and a ceiling at normal speed', () => {
    expect(playDelay(0)).toBe(PLAY_FLOOR_MS);
    expect(playDelay(5000)).toBe(PLAY_CEILING_MS);
    expect(playDelay(-3)).toBe(PLAY_FLOOR_MS);
  });

  it('grows with the words and never shrinks as they grow', () => {
    let last = 0;
    for (let words = 0; words < 400; words += 5) {
      const now = playDelay(words);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(playDelay(60)).toBeGreaterThan(playDelay(20));
  });

  it('scales with the speed the reader chose, and never steps faster than a second and a half', () => {
    expect(playDelay(40, 'slower')).toBeGreaterThan(playDelay(40, 'normal'));
    expect(playDelay(40, 'faster')).toBeLessThan(playDelay(40, 'normal'));
    expect(playDelay(0, 'faster')).toBeGreaterThanOrEqual(1500);
  });

  it('counts words', () => {
    expect(wordCount('one two  three', undefined, 'four\nfive')).toBe(5);
    expect(wordCount()).toBe(0);
  });
});

describe('layout.motion', () => {
  it('is an optional boolean on the layout', () => {
    const first = 'walkthroughs' in demos ? demos.walkthroughs[0] : demos;
    const base = JSON.parse(JSON.stringify(first)) as { layout: object };
    const withMotion = (motion: unknown) =>
      WalkthroughSchema.safeParse({ ...base, layout: { ...base.layout, motion } }).success;
    expect(withMotion(true)).toBe(true);
    expect(withMotion(false)).toBe(true);
    expect(withMotion('yes')).toBe(false);
  });
});
