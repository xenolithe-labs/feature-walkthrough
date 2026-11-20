import type { PathSegment } from '../core';
import type { Analysis } from './analysis';

/**
 * Feedback that is not an error: the config loads and shows, and the guidance says it could be
 * better. `warning` is worth fixing; `info` is a prompt to look, and may be right as it is.
 */
export interface Finding {
  severity: 'warning' | 'info';
  /** "design/<name>", or the rule id a layout provider gives. */
  rule: string;
  /** "design" for the checks in this folder, "layout" for the pictures a provider drew. */
  group: 'design' | 'layout';
  path: PathSegment[];
  /** What is wrong and what to do about it. */
  message: string;
  /** Which part of the design guidance the rule comes from. */
  source: string;
  /** "<step id>.<call id>" when the finding is about one call. */
  call?: string;
}

export type RawFinding = Omit<Finding, 'severity' | 'rule' | 'group' | 'source'>;

/** A design rule: a pure function of the analysis, with the guidance it comes from. */
export interface Rule {
  id: string;
  severity: Finding['severity'];
  /** For example "walkthrough-design section 5, checklist 16". */
  source: string;
  /** A sentence for the documentation: what the rule looks for. */
  summary: string;
  run(analysis: Analysis): RawFinding[];
}

/** The most calls a rule lists by name before it summarises the rest. */
export const LIST_LIMIT = 6;

export function listKeys(keys: readonly string[], limit = LIST_LIMIT): string {
  const shown = keys
    .slice(0, limit)
    .map((key) => `"${key}"`)
    .join(', ');
  return keys.length > limit ? `${shown} and ${keys.length - limit} more` : shown;
}
