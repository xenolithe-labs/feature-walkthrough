import type { FindingProvider } from '../src/review';

/**
 * Asynchronous finding providers that `feature-walkthrough check` runs on every walkthrough that
 * loads, and merges into its `findings` with group "layout".
 *
 * This is where the layout feedback for diagrams is registered. It lives in `cli/`, not in
 * `src/review/`, because the checker imports no panel or diagram code. To add the layout
 * analysis: export an async function from the diagram code that takes the resolved walkthrough
 * and returns `Problem[]` (paths relative to the walkthrough, rule ids such as
 * "layout/edge-through-node"), import it here, and append
 *
 *     { id: 'diagram-layout', run: analyseDiagramLayout }
 *
 * to the array below. Nothing else needs to change: see `src/review/providers.ts` for what a
 * provider may return and how errors, severities and timeouts are handled.
 */
export const providers: FindingProvider[] = [];
