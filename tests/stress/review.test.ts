import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core';
import { createRegistry } from '../../src/registry';
import { CheckResultSchema, buildResult, reviewConfig } from '../../src/review';
import {
  bigGraph,
  bigTable,
  deepPayloadWalkthrough,
  longWalkthrough,
  manyPanes,
  mutate,
  randomWalkthrough,
} from './gen';

const registry = createRegistry();

/** What check must do with any config: answer, in the published shape, without throwing. */
async function checks(config: unknown, label: string) {
  const review = await reviewConfig('x.json', config, registry, { trace: true });
  const result = buildResult([review], { version: 'test' });
  expect(() => CheckResultSchema.parse(JSON.parse(JSON.stringify(result))), label).not.toThrow();
  return review;
}

describe('check on generated configs', () => {
  it('every panel type, every effect verb: the trace describes every pane at every call', async () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const config = randomWalkthrough(seed, { steps: 4, calls: 4, selfLoops: seed % 2 === 0 });
      const review = await checks(config, `seed ${seed}`);
      const one = review.walkthroughs[0]!;
      expect(one.status, `seed ${seed}`).toBe('checked');
      for (const call of one.trace!) {
        for (const pane of call.panes) {
          expect(pane.lines.length, `seed ${seed} ${call.call.key} ${pane.id}`).toBeGreaterThan(0);
          // A describe that threw is replaced by the generic lines plus a note, which is a bug.
          expect(pane.lines.join('\n'), `seed ${seed} ${call.call.key} ${pane.id}`).not.toContain(
            'describe failed',
          );
        }
      }
    }
  });

  it('broken and mutated configs get an answer, never an exception', async () => {
    const base = randomWalkthrough(7, { steps: 3, calls: 3 });
    for (let seed = 1; seed <= 150; seed += 1) {
      await checks(mutate(base, seed), `mutation ${seed}`);
    }
    for (const junk of [
      null,
      undefined,
      0,
      'text',
      [],
      {},
      { walkthroughs: 3 },
      { walkthroughs: [] },
    ]) {
      await checks(junk, `junk ${JSON.stringify(junk)}`);
    }
  });

  it('a collection with one broken walkthrough still checks the others', async () => {
    const good = randomWalkthrough(3, { steps: 2, calls: 2 });
    const bad = mutate(randomWalkthrough(4), 1) as Record<string, unknown>;
    bad.layout = { panes: [{ id: 'x', panel: 'nope' }] };
    const review = await checks({ walkthroughs: [good, bad] }, 'collection');
    expect(review.walkthroughs.map((w) => w.status)).toEqual(['checked', 'not-checked']);
  });
});

describe('check at scale', () => {
  const budget = Number(process.env.STRESS_SLOWDOWN ?? 1);

  it.each([
    ['2,400 calls', () => longWalkthrough(300, 8), 3000],
    ['1,500 calls in one step', () => longWalkthrough(1, 1500), 3000],
    ['graph of 160 nodes', () => bigGraph(160, 6), 3000],
    ['table of 500 x 30', () => bigTable(500, 30), 3000],
    ['payload depth 12', () => deepPayloadWalkthrough(12, 8), 2000],
    ['10 panes', () => manyPanes(10, 6), 2000],
  ] as const)('%s: check with the full trace stays within its budget', async (label, make, ms) => {
    const config = make();
    expect(loadConfig(config, registry).ok).toBe(true);
    const started = performance.now();
    const review = await reviewConfig('x.json', config, registry, { trace: true });
    const took = performance.now() - started;
    console.info(`[stress] check ${label}: ${took.toFixed(0)} ms`);
    expect(review.walkthroughs[0]!.status).toBe('checked');
    expect(took).toBeLessThan(ms * budget);
  });
});
