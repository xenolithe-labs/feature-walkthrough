import type { PathSegment, Problem, ResolvedWalkthrough } from '../core';
import type { Finding } from './types';

/** What a provider returns: a `Problem`, which may also be an `info`. */
export type ProviderProblem = Omit<Problem, 'severity'> & {
  severity: Problem['severity'] | 'info';
};

/**
 * The seam for checks that need more than the config: a provider gets the resolved walkthrough
 * and answers, asynchronously, with problems (for example the layout of a diagram, drawn by the
 * real layout code). `check` runs every provider on every walkthrough that loads, in parallel,
 * and merges what they return into `findings` with group "layout".
 *
 * - Paths are relative to the walkthrough, like the paths a panel's `lint` returns
 *   (["layout", "panes", 0, "content", ...]); `check` adds the prefix of a collection.
 * - A layout problem never makes a config invalid, so severity "error" is reported as a warning.
 *   `check` exits 1 for config errors only.
 * - A provider that throws, or runs past `timeoutMs`, is reported as one finding; the others'
 *   results are kept.
 *
 * `src/review/` imports no panel or diagram code, so a provider is registered by the caller:
 * in the command line, in `cli/providers.ts`; from code, by passing `providers` to `reviewConfig`.
 */
export interface FindingProvider {
  /** Names the provider in the output and in errors, for example "diagram-layout". */
  id: string;
  /** Rule ids look like "layout/edge-through-node"; the provider chooses them. */
  run(walkthrough: ResolvedWalkthrough): Promise<ProviderProblem[]> | ProviderProblem[];
}

export const PROVIDER_TIMEOUT_MS = 30_000;

function failure(id: string, prefix: PathSegment[], reason: string): Finding {
  return {
    severity: 'info',
    rule: 'layout/provider-failed',
    group: 'layout',
    path: prefix,
    message: `the provider "${id}" did not finish (${reason}); its findings are missing from this result. The other checks ran`,
    source: `provider ${id}`,
  };
}

/** Runs the providers on one walkthrough. Never rejects. */
export async function runProviders(
  providers: readonly FindingProvider[],
  walkthrough: ResolvedWalkthrough,
  prefix: PathSegment[],
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<Finding[]> {
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer in ${timeoutMs} ms`)), timeoutMs);
      });
      try {
        return await Promise.race([Promise.resolve(provider.run(walkthrough)), timeout]);
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return settled.flatMap((result, index): Finding[] => {
    const provider = providers[index]!;
    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return [failure(provider.id, prefix, reason)];
    }
    return result.value.map((problem): Finding => ({
      severity: problem.severity === 'info' ? 'info' : 'warning',
      rule: problem.rule,
      group: 'layout',
      path: [...prefix, ...problem.path],
      message: problem.message,
      source: `provider ${provider.id}`,
    }));
  });
}
