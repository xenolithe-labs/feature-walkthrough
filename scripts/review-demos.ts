/**
 * Runs every design rule over the bundled demos and prints how many findings each produces (and
 * how many calls they stand for, since some rules sum up several calls in one finding), with
 * samples. This is how a rule is judged: a rule whose findings are mostly noise is tightened or
 * dropped. Rules with no hit are listed too. Usage:
 *   pnpm exec tsx scripts/review-demos.ts [rule-id | all]
 */
import { register } from 'node:module';

// Panels import their stylesheets. Outside a bundler those are empty modules.
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function load(url, context, next) {
       if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
       return next(url, context);
     }`,
  )}`,
);
const { loadConfig } = await import('../src/core');
const { createRegistry } = await import('../src/registry');
const { analyse } = await import('../src/review/analysis');
const { designFindings, designRules } = await import('../src/review/design');
const { demos } = await import('../src/walkthroughs');

const result = loadConfig(demos, createRegistry());
interface Hit {
  walkthrough: string;
  message: string;
  count: number;
}
const byRule = new Map<string, Hit[]>(designRules.map((rule) => [rule.id, []]));
let total = 0;
for (const walkthrough of result.walkthroughs) {
  for (const finding of designFindings(analyse(walkthrough))) {
    total += 1;
    byRule.get(finding.rule)?.push({
      walkthrough: walkthrough.id,
      message: finding.message,
      count: finding.count ?? 1,
    });
  }
}
const only = process.argv[2];
console.log(`${result.walkthroughs.length} walkthroughs, ${total} findings`);
for (const rule of designRules) {
  const list = byRule.get(rule.id)!;
  const spread = new Set(list.map((item) => item.walkthrough)).size;
  const calls = list.reduce((sum, item) => sum + item.count, 0);
  console.log(
    `${rule.id} (${rule.severity}): ${list.length} findings in ${spread} walkthroughs, standing for ${calls} calls or items`,
  );
  if (only === rule.id || only === 'all') {
    for (const item of list.slice(0, 14)) {
      console.log(`    ${item.walkthrough} | ${item.message.slice(0, 300)}`);
    }
  }
}
