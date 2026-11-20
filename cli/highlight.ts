/**
 * Works out syntax colours for the code sources of a config, ahead of time.
 *
 * This runs under Node, where the size of the highlighter and its grammars does not matter. The
 * result is plain data in the config (see src/panels/code/tokens.ts), so the viewer needs no
 * highlighter of its own.
 */
import type { Tokens } from '../src/panels/code/tokens';

const THEMES = { light: 'github-light', dark: 'github-dark' } as const;

interface Source {
  lang?: unknown;
  text?: unknown;
  tokens?: unknown;
  base?: unknown;
  baseTokens?: unknown;
  transcript?: unknown;
}

/** Every code source in a config, whatever else the config holds. Nothing here is validated. */
function sourcesOf(config: unknown): Source[] {
  const root = config as { walkthroughs?: unknown; layout?: unknown };
  const walkthroughs = Array.isArray(root?.walkthroughs) ? root.walkthroughs : [config];
  const found: Source[] = [];
  for (const walkthrough of walkthroughs) {
    const panes = (walkthrough as { layout?: { panes?: unknown } })?.layout?.panes;
    if (!Array.isArray(panes)) continue;
    for (const pane of panes as { panel?: unknown; content?: { sources?: unknown } }[]) {
      if (pane?.panel !== 'code' || !Array.isArray(pane.content?.sources)) continue;
      for (const source of pane.content.sources as Source[]) {
        if (typeof source === 'object' && source !== null) found.push(source);
      }
    }
  }
  return found;
}

/** The colours of one text, or undefined when the language is not one the highlighter knows. */
export async function tokensFor(text: string, lang: string): Promise<Tokens | undefined> {
  // Loaded only when colours are asked for: checking a config should not pay for a highlighter.
  const { bundledLanguages, bundledLanguagesAlias, codeToTokens } = await import('shiki');
  if (!(lang in bundledLanguages) && !(lang in bundledLanguagesAlias)) return undefined;
  const { tokens } = await codeToTokens(text, { lang: lang as never, themes: THEMES });
  const palette: [string, string][] = [];
  const positions = new Map<string, number>();
  const lines = tokens.map((line) => {
    const pieces: [string, number][] = [];
    for (const token of line) {
      const style = (token.htmlStyle ?? {}) as Record<string, string>;
      const light = style.color ?? token.color ?? '';
      const dark = style['--shiki-dark'] ?? light;
      const key = `${light} ${dark}`;
      let position = positions.get(key);
      if (position === undefined) {
        position = palette.length;
        positions.set(key, position);
        palette.push([light, dark]);
      }
      const last = pieces[pieces.length - 1];
      // Neighbours of one colour are joined: fewer, longer pieces.
      if (last !== undefined && last[1] === position) last[0] += token.content;
      else pieces.push([token.content, position]);
    }
    return pieces;
  });
  return { palette, lines };
}

/**
 * Adds colours to every code source that names a language and has none yet. The config is
 * changed in place. Returns how many sources were coloured and which languages were not known.
 */
export async function addTokens(config: unknown): Promise<{ coloured: number; unknown: string[] }> {
  let coloured = 0;
  const unknown = new Set<string>();
  for (const source of sourcesOf(config)) {
    if (typeof source.lang !== 'string' || typeof source.text !== 'string') continue;
    // A transcript is output, not source text: it is shown plain.
    if (source.transcript !== undefined) continue;
    if (source.tokens === undefined) {
      const tokens = await tokensFor(source.text, source.lang);
      if (tokens === undefined) unknown.add(source.lang);
      else {
        source.tokens = tokens;
        coloured += 1;
      }
    }
    // The removed lines of a diff come from `base`.
    if (typeof source.base === 'string' && source.baseTokens === undefined) {
      const tokens = await tokensFor(source.base, source.lang);
      if (tokens !== undefined) source.baseTokens = tokens;
    }
  }
  return { coloured, unknown: [...unknown] };
}
