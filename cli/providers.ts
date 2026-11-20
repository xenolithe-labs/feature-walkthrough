import { analyseDiagramLayout } from '../src/panels/_diagram/layout-lint';
import type { FindingProvider } from '../src/review';

/**
 * Asynchronous finding providers that `feature-walkthrough check` runs on every walkthrough that
 * loads, and merges into its `findings` with group "layout".
 *
 * They live in `cli/`, not in `src/review/`, because the checker imports no panel or diagram
 * code. A provider takes the resolved walkthrough and returns `Problem[]` with paths relative to
 * the walkthrough: see `src/review/providers.ts` for how errors, severities and timeouts are
 * handled.
 */
export const providers: FindingProvider[] = [
  // Runs the real layout of every graph and flow pane and reports what the picture would look like.
  { id: 'diagram-layout', run: analyseDiagramLayout },
];
