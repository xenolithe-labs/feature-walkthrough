/**
 * The config checker behind `feature-walkthrough check`: design findings, stats and a trace of
 * what a reader sees, for tools that write configs and cannot see the result. Pure TypeScript:
 * no React, no DOM, no panel imports beyond what a registry gives.
 */
export { analyse, type Analysis, type CallFacts, type PaneTouch } from './analysis';
export { describeGeneric, describePane } from './describe';
export { designFindings, designRules } from './design';
export { formatCheckText } from './format';
export { runProviders, type FindingProvider, type ProviderProblem } from './providers';
export {
  GROUPS,
  buildResult,
  reviewConfig,
  unreadable,
  type BuildOptions,
  type Group,
  type ReviewOptions,
} from './review';
export {
  CHECK_SCHEMA_VERSION,
  CheckResultSchema,
  checkResultJsonSchema,
  type CheckResult,
  type FileReview,
  type Stats,
  type TraceCall,
  type WalkthroughReview,
} from './schema';
export { statsOf } from './stats';
export { STAGE_CAPACITY, selectCalls, traceOf } from './trace';
export { codeSpans, mentions, normalise, sentencesOf, textStats, type TextStats } from './text';
export type { Finding, Rule } from './types';
