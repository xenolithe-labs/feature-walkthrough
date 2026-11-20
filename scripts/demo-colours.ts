import { tokensFor } from '../cli/highlight';
import type { WalkthroughInput } from '../src/core';
import type { Tokens } from '../src/panels/code/tokens';

/** Syntax colours for every code source of the given walkthroughs, by "walkthrough/pane/source". */
export async function demoColours(
  walkthroughs: WalkthroughInput[],
): Promise<Record<string, Tokens>> {
  const result: Record<string, Tokens> = {};
  for (const walkthrough of walkthroughs) {
    for (const pane of walkthrough.layout.panes) {
      const content = pane.content as
        { sources?: { id: string; lang?: string; text: string }[] } | undefined;
      if (pane.panel !== 'code' || content?.sources === undefined) continue;
      for (const source of content.sources) {
        if (source.lang === undefined) continue;
        const tokens = await tokensFor(source.text, source.lang);
        if (tokens !== undefined) result[`${walkthrough.id}/${pane.id}/${source.id}`] = tokens;
      }
    }
  }
  return result;
}
