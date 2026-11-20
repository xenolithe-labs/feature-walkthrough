/**
 * Syntax colours for a source, worked out ahead of time.
 *
 * The viewer contains no grammars and no highlighter: that would add megabytes to a page that
 * is meant to stay small. Colours are computed where size does not matter (the command line, or
 * a build step) and travel with the config as data. A source without them is shown plain.
 *
 * `palette` lists the colours used, each as [light theme, dark theme]. `lines` gives every line
 * of the text as pieces: [text, palette position]. The pieces of a line, joined, are the line.
 */
import { z } from 'zod';

export const TokensSchema = z.strictObject({
  palette: z.array(z.tuple([z.string(), z.string()])).max(256),
  lines: z.array(z.array(z.tuple([z.string(), z.number().int().min(0)]))),
});
export type Tokens = z.infer<typeof TokensSchema>;

/** Whether the tokens spell out exactly this text, and only use colours the palette has. */
export function tokensMatch(text: string, tokens: Tokens): boolean {
  const lines = text.split('\n');
  if (lines.length !== tokens.lines.length) return false;
  return lines.every((line, index) => {
    const pieces = tokens.lines[index]!;
    return (
      pieces.map(([piece]) => piece).join('') === line &&
      pieces.every(([, colour]) => colour < tokens.palette.length)
    );
  });
}

export interface Piece {
  text: string;
  /** Position in the palette, or undefined for uncoloured text. */
  colour: number | undefined;
  /** The mark of the expression this piece is part of, if any. */
  mark: string | undefined;
}

/**
 * One line cut into pieces that each have one colour and at most one mark. `spans` are the
 * marked expressions as [start, end, mark]; overlapping spans keep the first.
 */
export function pieces(
  line: string,
  coloured: readonly (readonly [string, number])[] | undefined,
  spans: readonly (readonly [number, number, string])[],
): Piece[] {
  const cuts = new Set<number>([0, line.length]);
  const colourAt: [number, number, number][] = [];
  let at = 0;
  for (const [piece, colour] of coloured ?? []) {
    colourAt.push([at, at + piece.length, colour]);
    at += piece.length;
    cuts.add(at);
  }
  const kept: [number, number, string][] = [];
  let free = 0;
  for (const [start, end, mark] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (start < free || end <= start) continue;
    kept.push([start, Math.min(end, line.length), mark]);
    cuts.add(start);
    cuts.add(Math.min(end, line.length));
    free = end;
  }
  const points = [...cuts].filter((cut) => cut >= 0 && cut <= line.length).sort((a, b) => a - b);
  const result: Piece[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const from = points[i]!;
    const to = points[i + 1]!;
    if (to === from) continue;
    const colour = colourAt.find(([start, end]) => from >= start && from < end)?.[2];
    const mark = kept.find(([start, end]) => from >= start && from < end)?.[2];
    const last = result[result.length - 1];
    // Neighbours that look the same are joined, so the page has no more elements than it needs.
    if (last !== undefined && last.colour === colour && last.mark === mark)
      last.text += line.slice(from, to);
    else result.push({ text: line.slice(from, to), colour, mark });
  }
  return result;
}
