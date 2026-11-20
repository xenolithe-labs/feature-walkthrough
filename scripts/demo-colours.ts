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
        | {
            sources?: {
              id: string;
              lang?: string;
              text: string;
              base?: string;
              transcript?: unknown;
            }[];
          }
        | undefined;
      if (pane.panel !== 'code' || content?.sources === undefined) continue;
      for (const source of content.sources) {
        if (source.lang === undefined || source.transcript !== undefined) continue;
        const tokens = await tokensFor(source.text, source.lang);
        if (tokens !== undefined) result[`${walkthrough.id}/${pane.id}/${source.id}`] = tokens;
        if (source.base === undefined) continue;
        const before = await tokensFor(source.base, source.lang);
        if (before !== undefined) result[`${walkthrough.id}/${pane.id}/${source.id}#base`] = before;
      }
    }
  }
  return result;
}
