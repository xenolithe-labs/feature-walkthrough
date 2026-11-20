/**
 * Motion is opt in. These are the pure rules behind it: which switch wins, and how long Play
 * waits on a call. The shell does the rest.
 */

/**
 * Whether transitions run. The system's reduced-motion setting always wins. After that the
 * address (`m=1` / `m=0`), then the reader's own choice, then the author's default. Off otherwise.
 */
export function resolveMotion(
  fromAddress: boolean | undefined,
  chosen: boolean | undefined,
  authorDefault: boolean | undefined,
  reduced: boolean,
): boolean {
  if (reduced) return false;
  return fromAddress ?? chosen ?? authorDefault ?? false;
}

export const SPEEDS = ['slower', 'normal', 'faster'] as const;
export type Speed = (typeof SPEEDS)[number];

export function isSpeed(value: unknown): value is Speed {
  return typeof value === 'string' && (SPEEDS as readonly string[]).includes(value);
}

const SPEED_FACTOR: Record<Speed, number> = { slower: 1.6, normal: 1, faster: 0.6 };

/** Reading time: a beat to take in the panes, plus about 250 words a minute. */
const BASE_MS = 2500;
const PER_WORD_MS = 240;
export const PLAY_FLOOR_MS = 3000;
export const PLAY_CEILING_MS = 15000;

export function wordCount(...texts: readonly (string | undefined)[]): number {
  let words = 0;
  for (const text of texts)
    if (text !== undefined) words += text.split(/\s+/).filter(Boolean).length;
  return words;
}

/**
 * How long Play stays on a call, in milliseconds: longer for a call with more text, never under
 * the floor or over the ceiling at normal speed. The speed then scales the result.
 */
export function playDelay(words: number, speed: Speed = 'normal'): number {
  const reading = Math.min(
    Math.max(BASE_MS + Math.max(words, 0) * PER_WORD_MS, PLAY_FLOOR_MS),
    PLAY_CEILING_MS,
  );
  return Math.round(reading * SPEED_FACTOR[speed]);
}
