/**
 * The cursor: which walkthrough, which step, which call, and what is selected.
 * Steps and calls are zero-based here and one-based in the URL.
 */
export interface Cursor {
  w: string;
  s: number;
  c: number;
  sel?: string;
}

/** Number of calls in each step. */
export type Shape = readonly number[];

export function shapeOf(walkthrough: { steps: readonly { calls: readonly unknown[] }[] }): Shape {
  return walkthrough.steps.map((step) => step.calls.length);
}

function toInt(value: number): number {
  if (Number.isFinite(value)) return Math.trunc(value);
  // Too large to hold is still "past the end"; anything else that is not a number is the start.
  return value === Infinity ? Number.MAX_SAFE_INTEGER : 0;
}

export function clamp(shape: Shape, s: number, c: number): { s: number; c: number } {
  const step = Math.min(Math.max(toInt(s), 0), shape.length - 1);
  const call = Math.min(Math.max(toInt(c), 0), (shape[step] ?? 1) - 1);
  return { s: step, c: call };
}

export function nextCall(shape: Shape, s: number, c: number): { s: number; c: number } {
  if (c + 1 < (shape[s] ?? 0)) return { s, c: c + 1 };
  if (s + 1 < shape.length) return { s: s + 1, c: 0 };
  return { s, c };
}

export function prevCall(shape: Shape, s: number, c: number): { s: number; c: number } {
  if (c > 0) return { s, c: c - 1 };
  if (s > 0) return { s: s - 1, c: (shape[s - 1] ?? 1) - 1 };
  return { s, c };
}

/** To the first call of the next step. Stays put on the last step. */
export function nextStep(shape: Shape, s: number, c: number): { s: number; c: number } {
  return s + 1 < shape.length ? { s: s + 1, c: 0 } : { s, c };
}

/** To the first call of the previous step, or of the first step. */
export function prevStep(_shape: Shape, s: number): { s: number; c: number } {
  return { s: Math.max(s - 1, 0), c: 0 };
}

export function totalCalls(shape: Shape): number {
  return shape.reduce((sum, count) => sum + count, 0);
}

/** Position of a call counted from the first call of the walkthrough. */
export function flatIndex(shape: Shape, s: number, c: number): number {
  let index = c;
  for (let step = 0; step < s; step += 1) index += shape[step] ?? 0;
  return index;
}

export function fromFlatIndex(shape: Shape, index: number): { s: number; c: number } {
  let rest = Math.max(toInt(index), 0);
  for (let step = 0; step < shape.length; step += 1) {
    const count = shape[step] ?? 0;
    if (rest < count) return { s: step, c: rest };
    rest -= count;
  }
  const last = shape.length - 1;
  return { s: last, c: (shape[last] ?? 1) - 1 };
}

export function isFirst(s: number, c: number): boolean {
  return s === 0 && c === 0;
}

export function isLast(shape: Shape, s: number, c: number): boolean {
  return s === shape.length - 1 && c === (shape[s] ?? 1) - 1;
}

/** `#w=<id>&s=<step>&c=<call>[&sel=<entity>]`, with step and call counted from 1. */
export function encodeHash(cursor: Cursor): string {
  const params = new URLSearchParams();
  params.set('w', cursor.w);
  params.set('s', String(cursor.s + 1));
  params.set('c', String(cursor.c + 1));
  if (cursor.sel !== undefined && cursor.sel !== '') params.set('sel', cursor.sel);
  return `#${params.toString()}`;
}

/**
 * Reads a hash back into a cursor. Anything missing or out of range falls
 * back to the nearest valid place, so a stale link still opens.
 */
export function decodeHash(
  hash: string,
  walkthroughs: readonly { id: string; shape: Shape }[],
): Cursor | undefined {
  const first = walkthroughs[0];
  if (first === undefined) return undefined;
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const target = walkthroughs.find((walkthrough) => walkthrough.id === params.get('w')) ?? first;
  const known = target.id === params.get('w');
  const s = known ? Number(params.get('s') ?? '1') - 1 : 0;
  const c = known ? Number(params.get('c') ?? '1') - 1 : 0;
  const cursor: Cursor = { w: target.id, ...clamp(target.shape, s, c) };
  const sel = params.get('sel');
  if (known && sel !== null && sel !== '') cursor.sel = sel;
  return cursor;
}
