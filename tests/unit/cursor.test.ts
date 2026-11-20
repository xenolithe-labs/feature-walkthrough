import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  clamp,
  decodeHash,
  encodeHash,
  flatIndex,
  fromFlatIndex,
  isFirst,
  isView,
  isLast,
  nextCall,
  nextStep,
  prevCall,
  prevStep,
  shapeOf,
  totalCalls,
  type Shape,
} from '../../src/core';

const shape: Shape = [2, 3, 1];

describe('cursor moves', () => {
  it('reads the shape from a walkthrough', () => {
    expect(shapeOf({ steps: [{ calls: [1, 2] }, { calls: [1] }] })).toEqual([2, 1]);
  });

  it('moves one call forward, across step ends, and stops at the last call', () => {
    expect(nextCall(shape, 0, 0)).toEqual({ s: 0, c: 1 });
    expect(nextCall(shape, 0, 1)).toEqual({ s: 1, c: 0 });
    expect(nextCall(shape, 2, 0)).toEqual({ s: 2, c: 0 });
  });

  it('moves one call back, across step starts, and stops at the first call', () => {
    expect(prevCall(shape, 1, 1)).toEqual({ s: 1, c: 0 });
    expect(prevCall(shape, 1, 0)).toEqual({ s: 0, c: 1 });
    expect(prevCall(shape, 0, 0)).toEqual({ s: 0, c: 0 });
  });

  it('moves one step and stops at both ends', () => {
    expect(nextStep(shape, 0, 1)).toEqual({ s: 1, c: 0 });
    expect(nextStep(shape, 2, 0)).toEqual({ s: 2, c: 0 });
    expect(prevStep(shape, 2)).toEqual({ s: 1, c: 0 });
    expect(prevStep(shape, 0)).toEqual({ s: 0, c: 0 });
  });

  it('clamps anything out of range', () => {
    expect(clamp(shape, -4, 9)).toEqual({ s: 0, c: 1 });
    expect(clamp(shape, 99, 99)).toEqual({ s: 2, c: 0 });
    expect(clamp(shape, 1, 99)).toEqual({ s: 1, c: 2 });
    expect(clamp(shape, Number.NaN, Number.NaN)).toEqual({ s: 0, c: 0 });
    expect(clamp(shape, 1.9, 1.2)).toEqual({ s: 1, c: 1 });
  });

  it('knows the ends', () => {
    expect(isFirst(0, 0)).toBe(true);
    expect(isLast(shape, 2, 0)).toBe(true);
    expect(isLast(shape, 1, 2)).toBe(false);
  });

  it('converts to and from a flat index', () => {
    expect(totalCalls(shape)).toBe(6);
    expect(flatIndex(shape, 1, 2)).toBe(4);
    expect(fromFlatIndex(shape, 4)).toEqual({ s: 1, c: 2 });
    expect(fromFlatIndex(shape, 99)).toEqual({ s: 2, c: 0 });
    for (let index = 0; index < totalCalls(shape); index += 1) {
      const { s, c } = fromFlatIndex(shape, index);
      expect(flatIndex(shape, s, c)).toBe(index);
    }
  });

  it('walks every call once going forward and once going back', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 6 }),
        (any) => {
          let at = { s: 0, c: 0 };
          let visited = 1;
          while (!isLast(any, at.s, at.c)) {
            at = nextCall(any, at.s, at.c);
            visited += 1;
          }
          expect(visited).toBe(totalCalls(any));
          while (!isFirst(at.s, at.c)) {
            at = prevCall(any, at.s, at.c);
            visited -= 1;
          }
          expect(visited).toBe(1);
        },
      ),
    );
  });
});

describe('hash codec', () => {
  const walkthroughs = [
    { id: 'first', shape },
    { id: 'second', shape: [4] },
  ];

  it('writes step and call counted from one', () => {
    expect(encodeHash({ w: 'first', s: 1, c: 2 })).toBe('#w=first&s=2&c=3');
    expect(encodeHash({ w: 'first', s: 0, c: 0, sel: 'token' })).toBe('#w=first&s=1&c=1&sel=token');
  });

  it('round trips, including selections that need escaping', () => {
    for (const sel of [
      undefined,
      'token',
      'a b',
      'x&y=z',
      'ünï',
      'id:with.dots-and_more',
      '#hash',
    ]) {
      const cursor = { w: 'second', s: 0, c: 3, ...(sel === undefined ? {} : { sel }) };
      expect(decodeHash(encodeHash(cursor), walkthroughs)).toEqual(cursor);
    }
  });

  it('round trips every cursor', () => {
    fc.assert(
      fc.property(
        fc.nat(5),
        fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        (index, sel) => {
          const cursor = {
            w: 'first',
            ...fromFlatIndex(shape, index),
            ...(sel === undefined ? {} : { sel }),
          };
          expect(decodeHash(encodeHash(cursor), walkthroughs)).toEqual(cursor);
        },
      ),
    );
  });

  it('writes the view last, and only when there is one', () => {
    expect(encodeHash({ w: 'first', s: 0, c: 0, view: 'focus' })).toBe('#w=first&s=1&c=1&v=focus');
    expect(encodeHash({ w: 'first', s: 0, c: 1, sel: 'token', view: 'grid' })).toBe(
      '#w=first&s=1&c=2&sel=token&v=grid',
    );
    expect(encodeHash({ w: 'first', s: 0, c: 0 })).not.toContain('v=');
  });

  it('reads the view, and round trips it with everything else', () => {
    expect(decodeHash('#w=first&s=2&c=1&v=focus', walkthroughs)).toEqual({
      w: 'first',
      s: 1,
      c: 0,
      view: 'focus',
    });
    expect(decodeHash('#v=grid', walkthroughs)).toEqual({ w: 'first', s: 0, c: 0, view: 'grid' });
    for (const view of ['grid', 'focus'] as const) {
      const cursor = { w: 'second', s: 0, c: 3, sel: 'a b', view };
      expect(decodeHash(encodeHash(cursor), walkthroughs)).toEqual(cursor);
    }
  });

  it('ignores a view it does not know, and keeps the view of a stale link', () => {
    expect(decodeHash('#w=first&s=1&c=1&v=cards', walkthroughs)).toEqual({
      w: 'first',
      s: 0,
      c: 0,
    });
    expect(decodeHash('#w=first&v=', walkthroughs)).toEqual({ w: 'first', s: 0, c: 0 });
    expect(decodeHash('#w=first&v=FOCUS', walkthroughs)).toEqual({ w: 'first', s: 0, c: 0 });
    expect(decodeHash('#w=nope&s=3&v=focus', walkthroughs)).toEqual({
      w: 'first',
      s: 0,
      c: 0,
      view: 'focus',
    });
    expect(isView('focus') && isView('grid')).toBe(true);
    expect(isView('Focus') || isView(undefined) || isView(3)).toBe(false);
  });

  it('falls back to the nearest valid place', () => {
    expect(decodeHash('', walkthroughs)).toEqual({ w: 'first', s: 0, c: 0 });
    expect(decodeHash('#w=nope&s=3&c=2&sel=q', walkthroughs)).toEqual({ w: 'first', s: 0, c: 0 });
    expect(decodeHash('#w=second&s=9&c=9', walkthroughs)).toEqual({ w: 'second', s: 0, c: 3 });
    expect(decodeHash('#w=first&s=two&c=', walkthroughs)).toEqual({ w: 'first', s: 0, c: 0 });
    expect(decodeHash('w=first&s=2', walkthroughs)).toEqual({ w: 'first', s: 1, c: 0 });
    expect(decodeHash('#w=first', [])).toBeUndefined();
  });

  it('writes motion after the view, and only when the address says something', () => {
    expect(encodeHash({ w: 'first', s: 0, c: 0, motion: true })).toBe('#w=first&s=1&c=1&m=1');
    expect(encodeHash({ w: 'first', s: 0, c: 0, motion: false })).toBe('#w=first&s=1&c=1&m=0');
    expect(encodeHash({ w: 'first', s: 0, c: 1, view: 'focus', motion: true })).toBe(
      '#w=first&s=1&c=2&v=focus&m=1',
    );
    expect(encodeHash({ w: 'first', s: 0, c: 0 })).not.toContain('m=');
  });

  it('reads motion, ignores anything but 0 and 1, and round trips it', () => {
    expect(decodeHash('#w=first&m=1', walkthroughs)).toEqual({
      w: 'first',
      s: 0,
      c: 0,
      motion: true,
    });
    expect(decodeHash('#m=0', walkthroughs)).toEqual({ w: 'first', s: 0, c: 0, motion: false });
    for (const bad of ['', '2', 'true', 'on', ' 1']) {
      expect(decodeHash(`#w=first&m=${bad}`, walkthroughs)).toEqual({ w: 'first', s: 0, c: 0 });
    }
    // Like the view, it does not depend on the walkthrough, so a stale link keeps it.
    expect(decodeHash('#w=nope&s=3&m=1', walkthroughs)).toEqual({
      w: 'first',
      s: 0,
      c: 0,
      motion: true,
    });
    for (const motion of [true, false]) {
      const cursor = { w: 'second', s: 0, c: 3, sel: 'a b', view: 'focus' as const, motion };
      expect(decodeHash(encodeHash(cursor), walkthroughs)).toEqual(cursor);
    }
  });
});
