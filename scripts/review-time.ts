/**
 * Times `check` on the largest bundled demo and on the stress configs of tests/stress/gen.ts:
 * the checks and stats alone, and with the trace of every call. Usage:
 * pnpm exec tsx scripts/review-time.ts
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
const { createRegistry } = await import('../src/registry');
const { reviewConfig } = await import('../src/review');
const { plainDemos } = await import('../src/walkthroughs');
const gen = await import('../tests/stress/gen');

const registry = createRegistry();
const biggest = [...plainDemos].sort(
  (a, b) =>
    b.steps.reduce((n, s) => n + s.calls.length, 0) -
    a.steps.reduce((n, s) => n + s.calls.length, 0),
)[0]!;

const cases: [string, unknown][] = [
  [
    `largest demo (${biggest.id}, ${biggest.steps.reduce((n, s) => n + s.calls.length, 0)} calls)`,
    biggest,
  ],
  ['stress: 300 steps x 8 calls', gen.longWalkthrough(300, 8)],
  ['stress: 1,500 calls in one step', gen.longWalkthrough(1, 1500)],
  ['stress: graph 160 nodes', gen.bigGraph(160, 6)],
  ['stress: table 500 x 30', gen.bigTable(500, 30)],
  ['stress: code 5,000 lines', gen.bigCode(5000)],
  ['stress: payload depth 12', gen.deepPayloadWalkthrough(12, 8)],
  ['stress: schema 40/80', gen.bigSchema(40, 80)],
  ['stress: 10 panes', gen.manyPanes(10, 6)],
];

async function time(config: unknown, options: Parameters<typeof reviewConfig>[3]) {
  const started = performance.now();
  const review = await reviewConfig('x', config, registry, options);
  return { ms: performance.now() - started, review };
}

// One warm-up, so that module loading is not counted against the first case.
await time(biggest, {});
for (const [label, config] of cases) {
  const plain = await time(config, {});
  const traced = await time(config, { trace: true });
  const one = plain.review.walkthroughs[0]!;
  console.log(
    `${label}: ${plain.ms.toFixed(0)} ms without the trace, ${traced.ms.toFixed(0)} ms with it (${one.stats?.calls ?? 0} calls, ${one.findings?.length ?? 0} findings, ${one.status})`,
  );
}
