/**
 * Runs every design rule over the bundled demos and prints how many findings each produces,
 * with samples. This is how a rule is judged: a rule whose findings are mostly noise is tightened
 * or dropped. Usage: pnpm exec tsx scripts/review-demos.ts [rule-id | all]
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
const { designFindings } = await import('../src/review/design');
const { demos } = await import('../src/walkthroughs');

const result = loadConfig(demos, createRegistry());
const byRule = new Map<string, { walkthrough: string; message: string }[]>();
let total = 0;
for (const walkthrough of result.walkthroughs) {
  for (const finding of designFindings(analyse(walkthrough))) {
    total += 1;
    byRule.set(finding.rule, [
      ...(byRule.get(finding.rule) ?? []),
      { walkthrough: walkthrough.id, message: finding.message },
    ]);
  }
}
const only = process.argv[2];
console.log(`${result.walkthroughs.length} walkthroughs, ${total} findings`);
for (const [rule, list] of [...byRule].sort()) {
  const spread = new Set(list.map((item) => item.walkthrough)).size;
  console.log(`${rule}: ${list.length} in ${spread} walkthroughs`);
  if (only === rule || only === 'all') {
    for (const item of list.slice(0, 14)) {
      console.log(`    ${item.walkthrough} | ${item.message.slice(0, 300)}`);
    }
  }
}
