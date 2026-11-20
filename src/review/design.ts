import type { Analysis } from './analysis';
import { paneRules } from './rules/panes';
import { shapeRules } from './rules/shape';
import { textRules } from './rules/text';
import { valueRules } from './rules/values';
import type { Finding, Rule } from './types';

/** Every design rule, in the order their findings are listed within one severity. */
export const designRules: Rule[] = [...textRules, ...shapeRules, ...paneRules, ...valueRules];

const RANK = { warning: 0, info: 1 } as const;

/**
 * The design findings for one analysed walkthrough: warnings first, then infos, each group in
 * the order of the config. A rule that throws is reported as a finding, not allowed to stop the
 * others: a check must never hide the problems it can still find.
 */
export function designFindings(
  analysis: Analysis,
  rules: readonly Rule[] = designRules,
): Finding[] {
  const found: Finding[] = [];
  for (const rule of rules) {
    try {
      for (const raw of rule.run(analysis)) {
        found.push({
          ...raw,
          severity: rule.severity,
          rule: rule.id,
          group: 'design',
          source: rule.source,
        });
      }
    } catch (error) {
      found.push({
        severity: 'info',
        rule: 'design/rule-failed',
        group: 'design',
        path: analysis.prefix,
        message: `the rule ${rule.id} failed (${error instanceof Error ? error.message : String(error)}); report this as a bug in the checker. The other rules ran`,
        source: 'feature-walkthrough check',
      });
    }
  }
  const index = new Map(analysis.calls.map((item) => [item.key, item.index]));
  const order = (finding: Finding) =>
    finding.call === undefined ? -1 : (index.get(finding.call) ?? -1);
  return found
    .map((finding, position) => ({ finding, position }))
    .sort(
      (a, b) =>
        RANK[a.finding.severity] - RANK[b.finding.severity] ||
        order(a.finding) - order(b.finding) ||
        a.position - b.position,
    )
    .map(({ finding }) => finding);
}
