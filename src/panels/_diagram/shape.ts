/**
 * Node shapes beyond the labelled box: a disc (circle) with an icon in it and its label underneath,
 * and a pill. Sizes come from the text alone, so layout needs no browser.
 */

export type Shape = 'box' | 'circle' | 'pill';

/** The diameter of a disc. */
export const DISC = 56;
/** Characters of a disc's label that fit on a line beneath it. */
const LABEL_CHARS = 16;
/** Most lines of label beneath a disc. */
export const DISC_LABEL_LINES = 2;

/** A label broken into at most two short lines beneath a disc; the rest is cut. */
export function discLines(text: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= LABEL_CHARS) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines.slice(0, DISC_LABEL_LINES);
}

/** The box of a disc node: the disc, and its label (and a small second line) beneath it. */
export function circleSize(label: string, sub?: string): { width: number; height: number } {
  const lines = discLines(label);
  const widest = Math.max(
    ...lines.map((line) => line.length),
    sub === undefined ? 0 : Math.min(sub.length, LABEL_CHARS + 4),
  );
  return {
    width: Math.round(Math.min(Math.max(DISC + 24, widest * 6.9 + 12), 140)),
    height: DISC + 8 + lines.length * 15 + (sub === undefined ? 0 : 14),
  };
}
