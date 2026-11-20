import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runCheck, type CheckArgs, type CheckDeps } from '../../cli/check';
import { providers as shippedProviders } from '../../cli/providers';
import { loadConfig } from '../../src/core';
import { createRegistry } from '../../src/registry';
import {
  CheckResultSchema,
  buildResult,
  checkResultJsonSchema,
  reviewConfig,
  unreadable,
  type CheckResult,
  type FindingProvider,
} from '../../src/review';
import { demos } from '../../src/walkthroughs';
import { bent, cleanConfig } from '../helpers/review';

const registry = createRegistry();
const VERSION = 'test';

describe('reviewConfig', () => {
  it('a clean walkthrough: checked, no problems, no findings, stats, no trace', async () => {
    const review = await reviewConfig('clean.json', cleanConfig(), registry);
    expect(review.walkthroughs).toHaveLength(1);
    const [one] = review.walkthroughs;
    expect(one).toMatchObject({
      id: 'clean',
      status: 'checked',
      problems: [],
      findings: [],
      path: [],
    });
    expect(one!.trace).toBeUndefined();
    expect(one!.stats).toMatchObject({
      steps: 3,
      calls: 5,
      panes: 2,
      words: { withoutText: 0, overCeiling: 0 },
      touchedPerCall: { zero: 0 },
    });
    expect(one!.stats!.perPane.map((pane) => pane.pane)).toEqual(['wire', 'data']);
  });

  it('everything lint reports is in problems, with the path as text', async () => {
    const broken = bent((c) => (c.steps[0]!.calls[0]!.effects = { data: [{ read: 'nope' }] }));
    const review = await reviewConfig('broken.json', broken, registry);
    const lint = loadConfig(broken, registry).problems;
    const one = review.walkthroughs[0]!;
    expect(one.status).toBe('not-checked');
    expect(one.findings).toBeUndefined();
    expect(one.stats).toBeUndefined();
    expect(
      one.problems!.map(({ severity, rule, path, message }) => ({ severity, rule, path, message })),
    ).toEqual(lint);
    expect(one.problems![0]!.at).toBe('steps[0].calls[0].effects.data[0].read');
  });

  it('lint warnings are kept next to the design findings', async () => {
    const warned = bent((c) => {
      c.steps[0]!.calls[1]!.effects = { data: [{ add: 'b' }, { add: 'b' }] };
    });
    const review = await reviewConfig('w.json', warned, registry);
    expect(review.walkthroughs[0]!.status).toBe('checked');
    expect(review.walkthroughs[0]!.problems!.map((p) => p.rule)).toEqual(['already-present']);
  });

  it('a collection: each walkthrough on its own, paths with the prefix', async () => {
    const broken = bent((c) => {
      c.id = 'broken';
      c.steps[0]!.calls[0]!.effects = { data: [{ read: 'nope' }] };
    });
    const quiet = bent((c) => {
      c.id = 'quiet';
      c.steps[1]!.calls[0]!.text = '';
    });
    const review = await reviewConfig(
      'many.json',
      { walkthroughs: [cleanConfig(), broken, quiet] },
      registry,
    );
    expect(review.walkthroughs.map((w) => [w.id, w.status])).toEqual([
      ['clean', 'checked'],
      ['broken', 'not-checked'],
      ['quiet', 'checked'],
    ]);
    expect(review.walkthroughs[1]!.path).toEqual(['walkthroughs', 1]);
    expect(review.walkthroughs[1]!.problems![0]!.at).toBe(
      'walkthroughs[1].steps[0].calls[0].effects.data[0].read',
    );
    expect(review.walkthroughs[2]!.findings!.map((f) => f.rule)).toContain('design/text-missing');
    expect(review.problems).toEqual([]);
  });

  it('a collection with a schema error: a sibling with a lint error still lists it', async () => {
    const schemaBroken = { id: 'schema-broken', title: 'No layout', steps: [] };
    const lintBroken = bent((c) => {
      c.id = 'lint-broken';
      c.steps[0]!.calls[0]!.effects = { data: [{ read: 'nope' }] };
    });
    const warned = bent((c) => {
      c.id = 'warned';
      c.steps[0]!.calls[1]!.effects = { data: [{ add: 'b' }, { add: 'b' }] };
    });
    const review = await reviewConfig(
      'mixed.json',
      { walkthroughs: [schemaBroken, lintBroken, cleanConfig(), warned] },
      registry,
    );
    expect(review.walkthroughs.map((w) => [w.id, w.status])).toEqual([
      ['schema-broken', 'not-checked'],
      ['lint-broken', 'not-checked'],
      ['clean', 'checked'],
      ['warned', 'checked'],
    ]);
    expect(review.walkthroughs[0]!.problems!.length).toBeGreaterThan(0);
    expect(review.walkthroughs[1]!.problems!.map((p) => [p.severity, p.rule, p.at])).toEqual([
      ['error', 'unknown-id', 'walkthroughs[1].steps[0].calls[0].effects.data[0].read'],
    ]);
    expect(review.walkthroughs[3]!.problems!.map((p) => [p.rule, p.at])).toEqual([
      ['already-present', 'walkthroughs[3].steps[0].calls[1].effects.data[1].add'],
    ]);
  });

  it('a collection whose shape is wrong: the problem belongs to the file, the rest is still checked', async () => {
    const review = await reviewConfig(
      'odd.json',
      { walkthroughs: [cleanConfig()], extra: true },
      registry,
    );
    expect(review.problems.length).toBeGreaterThan(0);
    expect(review.walkthroughs[0]!.status).toBe('checked');
  });

  it('input that is not a config at all', async () => {
    const review = await reviewConfig('x.json', 42, registry);
    expect(review.walkthroughs[0]).toMatchObject({ id: null, status: 'not-checked' });
    expect(review.walkthroughs[0]!.problems![0]!.severity).toBe('error');
  });

  it('--only picks groups, but config errors are always reported', async () => {
    const only = await reviewConfig('c.json', cleanConfig(), registry, { only: ['stats'] });
    expect(only.walkthroughs[0]).toMatchObject({ status: 'checked' });
    expect(only.walkthroughs[0]!.stats).toBeDefined();
    expect(only.walkthroughs[0]!.findings).toBeUndefined();
    expect(only.walkthroughs[0]!.problems).toBeUndefined();
    const broken = bent((c) => (c.steps[0]!.calls[0]!.effects = { data: [{ read: 'nope' }] }));
    const errors = await reviewConfig('b.json', broken, registry, { only: ['design'] });
    expect(errors.walkthroughs[0]!.problems).toHaveLength(1);
  });
});

describe('the trace', () => {
  it('one call: step, call, text, panes with what the call did, and the stage', async () => {
    const review = await reviewConfig('c.json', cleanConfig(), registry, { call: 'change.set' });
    const trace = review.walkthroughs[0]!.trace!;
    expect(trace).toHaveLength(1);
    expect(trace[0]!).toMatchObject({
      step: { index: 2, id: 'change', title: 'Change it' },
      call: { index: 1, id: 'set', key: 'change.set', words: 9 },
      stage: { capacity: 3 },
      hidden: [],
    });
    const data = trace[0]!.panes.find((pane) => pane.id === 'data')!;
    expect(data.did.updated).toEqual(['a']);
    expect(data.lines).toContain('a (updated): name=alpha val=>15<');
    expect(trace[0]!.stage.panes).toContain('data');
  });

  it('a call by position', async () => {
    const review = await reviewConfig('c.json', cleanConfig(), registry, { call: '2.1' });
    expect(review.walkthroughs[0]!.trace![0]!.call.key).toBe('change.set');
  });

  it('all calls, and a walkthrough without the call gets no trace', async () => {
    const all = await reviewConfig('c.json', cleanConfig(), registry, { trace: true });
    expect(all.walkthroughs[0]!.trace).toHaveLength(5);
    const other = bent((c) => (c.id = 'other'));
    other.steps[0]!.id = 'first';
    const two = await reviewConfig('c.json', { walkthroughs: [cleanConfig(), other] }, registry, {
      call: 'change.set',
    });
    expect(two.walkthroughs[0]!.trace).toHaveLength(1);
    expect(two.walkthroughs[1]!.trace).toHaveLength(1);
    const none = await reviewConfig('c.json', cleanConfig(), registry, { call: 'nope.none' });
    expect(none.walkthroughs[0]!.trace).toBeUndefined();
  });

  it('hidden focus panes are listed, and the focus view follows show', async () => {
    const config = bent((c) => {
      c.layout.panes.push({
        id: 'extra',
        panel: 'flow',
        role: 'focus',
        title: 'Extra',
        content: { nodes: [{ id: 'n1', label: 'One' }], edges: [] },
      });
      c.steps[2]!.calls[0]!.show = 'extra';
      c.steps[2]!.calls[0]!.effects = { data: [{ read: 'a' }], extra: [{ read: 'n1' }] };
    });
    const review = await reviewConfig('c.json', config, registry, { trace: true });
    const trace = review.walkthroughs[0]!.trace!;
    expect(trace[0]!.hidden).toEqual([]);
    expect(trace[0]!.focus).toBe('extra');
    expect(trace[4]!.panes.map((pane) => pane.id)).toEqual(['wire', 'data', 'extra']);
  });
});

describe('providers: the seam for layout findings', () => {
  const asProblem = (message: string, severity: 'error' | 'warning' | 'info' = 'error') => ({
    severity,
    rule: 'layout/edge-through-node',
    path: ['layout', 'panes', 1],
    message,
  });

  it('none are registered yet, and the list is where they go', () => {
    expect(shippedProviders).toEqual([]);
  });

  it('a provider gets the resolved walkthrough; its problems become layout findings', async () => {
    const seen: string[] = [];
    const provider: FindingProvider = {
      id: 'fake-layout',
      run: async (walkthrough) => {
        seen.push(walkthrough.id);
        return [asProblem('an edge crosses a node'), asProblem('labels overlap', 'info')];
      },
    };
    const review = await reviewConfig(
      'many.json',
      { walkthroughs: [cleanConfig(), bent((c) => (c.id = 'second'))] },
      registry,
      { providers: [provider] },
    );
    expect(seen).toEqual(['clean', 'second']);
    const found = review.walkthroughs[1]!.findings!.filter((item) => item.group === 'layout');
    expect(found.map((item) => [item.severity, item.rule])).toEqual([
      ['warning', 'layout/edge-through-node'],
      ['info', 'layout/edge-through-node'],
    ]);
    expect(found[0]!.path).toEqual(['walkthroughs', 1, 'layout', 'panes', 1]);
    expect(found[0]!.source).toBe('provider fake-layout');
  });

  it('a layout error is a warning: it never fails the run', async () => {
    const provider: FindingProvider = { id: 'p', run: () => [asProblem('bad')] };
    const review = await reviewConfig('c.json', cleanConfig(), registry, { providers: [provider] });
    const result = buildResult([review], { version: VERSION });
    expect(result.summary).toMatchObject({ errors: 0, warnings: 1, exitCode: 0 });
  });

  it('a provider that throws, or hangs, costs one finding and nothing else', async () => {
    const good: FindingProvider = { id: 'good', run: () => [asProblem('overlap', 'warning')] };
    const bad: FindingProvider = {
      id: 'bad',
      run: () => {
        throw new Error('elk crashed');
      },
    };
    const hangs: FindingProvider = { id: 'hangs', run: () => new Promise(() => {}) };
    const review = await reviewConfig('c.json', cleanConfig(), registry, {
      providers: [good, bad, hangs],
      providerTimeoutMs: 30,
    });
    const found = review.walkthroughs[0]!.findings!;
    expect(found.map((item) => item.rule)).toEqual([
      'layout/edge-through-node',
      'layout/provider-failed',
      'layout/provider-failed',
    ]);
    expect(found[1]!.message).toContain('elk crashed');
    expect(found[2]!.message).toContain('no answer in 30 ms');
  });

  it('providers are not run for a walkthrough with errors, or when layout is not asked for', async () => {
    let runs = 0;
    const provider: FindingProvider = { id: 'p', run: () => (runs++, []) };
    const broken = bent((c) => (c.steps[0]!.calls[0]!.effects = { data: [{ read: 'nope' }] }));
    await reviewConfig('b.json', broken, registry, { providers: [provider] });
    await reviewConfig('c.json', cleanConfig(), registry, {
      providers: [provider],
      only: ['design'],
    });
    expect(runs).toBe(0);
  });
});

describe('buildResult and the schema', () => {
  it('the result parses against its own schema, on every bundled demo', async () => {
    const review = await reviewConfig('demos', demos, registry, { trace: true });
    const result = buildResult([review], { version: VERSION });
    expect(CheckResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(review.walkthroughs).toHaveLength(23);
    expect(review.walkthroughs.every((w) => w.status === 'checked')).toBe(true);
  });

  it('schema/check-result.schema.json is up to date (run "pnpm schema")', () => {
    const file: unknown = JSON.parse(readFileSync('schema/check-result.schema.json', 'utf8'));
    expect(file).toEqual(JSON.parse(JSON.stringify(checkResultJsonSchema())));
  });

  it('exit codes: errors and unreadable files are 1, warnings only with --max-warnings', async () => {
    const quiet = await reviewConfig('c.json', cleanConfig(), registry);
    expect(buildResult([quiet], { version: VERSION }).summary).toMatchObject({
      exitCode: 0,
      reason: '',
    });

    const warned = await reviewConfig(
      'w.json',
      bent((c) => (c.steps[0]!.calls[0]!.text = '')),
      registry,
    );
    const result = buildResult([warned], { version: VERSION });
    expect(result.summary).toMatchObject({ errors: 0, warnings: 1, exitCode: 0 });
    const strict = buildResult([warned], { version: VERSION, maxWarnings: 0 });
    expect(strict.summary).toMatchObject({ exitCode: 1 });
    expect(strict.summary.reason).toBe('1 warnings, more than --max-warnings 0');
    expect(buildResult([warned], { version: VERSION, maxWarnings: 1 }).summary.exitCode).toBe(0);

    const infos = await reviewConfig(
      'i.json',
      bent((c) => delete c.steps[1]!.text),
      registry,
    );
    expect(buildResult([infos], { version: VERSION, maxWarnings: 0 }).summary).toMatchObject({
      infos: 1,
      exitCode: 0,
    });

    const broken = await reviewConfig('b.json', 7, registry);
    expect(buildResult([broken], { version: VERSION }).summary.exitCode).toBe(1);
    const unread = unreadable('missing.json', 'no such file');
    expect(buildResult([unread], { version: VERSION }).summary).toMatchObject({
      exitCode: 1,
      reason: '1 file could not be read',
    });
  });

  it('the schema says what every field is for', () => {
    const text = JSON.stringify(checkResultJsonSchema());
    expect(text).toContain('warning: worth fixing');
    expect(text).toContain('<step id>.<call id>');
  });
});

describe('the command', () => {
  function run(
    args: Partial<CheckArgs>,
    files: Record<string, unknown> = { 'clean.json': cleanConfig() },
  ) {
    const out: string[] = [];
    const err: string[] = [];
    const deps: CheckDeps = {
      read: async (file) => {
        if (!(file in files)) throw new Error('no such file');
        return files[file];
      },
      registry,
      providers: [],
      version: VERSION,
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    };
    const base: CheckArgs = {
      files: Object.keys(files),
      json: false,
      call: undefined,
      only: undefined,
      maxWarnings: undefined,
      trace: false,
    };
    return runCheck({ ...base, ...args }, deps).then((code) => ({ code, out, err }));
  }

  it('exit 0 for a clean file; text names the file and ends with the summary', async () => {
    const { code, out, err } = await run({});
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out[0]).toContain('clean.json: walkthrough clean "A value changes"');
    expect(out[0]).toMatch(/1 file, 1 walkthrough: 0 errors, 0 warnings, 0 infos$/);
  });

  it('--json prints one document and nothing else', async () => {
    const { code, out, err } = await run({ json: true, call: 'change.set' });
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out).toHaveLength(1);
    const result = CheckResultSchema.parse(JSON.parse(out[0]!)) as CheckResult;
    expect(result.options.call).toBe('change.set');
    expect(result.files[0]!.walkthroughs[0]!.trace).toHaveLength(1);
  });

  it('exit 1 for config errors, with the problem in the text and in the JSON', async () => {
    const broken = bent((c) => (c.steps[0]!.calls[0]!.effects = { data: [{ read: 'nope' }] }));
    const text = await run({}, { 'b.json': broken });
    expect(text.code).toBe(1);
    expect(text.out[0]).toContain('error unknown-id at steps[0].calls[0].effects.data[0].read');
    expect(text.out[0]).toContain('Exit 1: 1 config error');
    const json = await run({ json: true }, { 'b.json': broken });
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out[0]!).summary).toMatchObject({ errors: 1, exitCode: 1 });
  });

  it('an unreadable file is reported and exits 1, and the other files are still checked', async () => {
    const { code, out } = await run({ files: ['missing.json', 'clean.json'] });
    expect(code).toBe(1);
    expect(out[0]).toContain('missing.json: cannot read: no such file');
    expect(out[0]).toContain('clean.json: walkthrough clean');
  });

  it('--max-warnings makes findings fail the run', async () => {
    const warned = { 'w.json': bent((c) => (c.steps[0]!.calls[0]!.text = '')) };
    expect((await run({}, warned)).code).toBe(0);
    expect((await run({ maxWarnings: '0' }, warned)).code).toBe(1);
    expect((await run({ maxWarnings: '1' }, warned)).code).toBe(0);
  });

  it('usage errors are exit 2 and say what to do', async () => {
    for (const args of [
      { files: [] },
      { only: 'design,nonsense' },
      { maxWarnings: '-1' },
      { maxWarnings: 'many' },
      { call: 'nodots' },
      { call: 'a.b.c' },
      { call: 'nope.nothing' },
    ] satisfies Partial<CheckArgs>[]) {
      const { code, out, err } = await run(args);
      expect(code, JSON.stringify(args)).toBe(2);
      expect(out).toEqual([]);
      expect(err[0]).toBeTruthy();
    }
  });

  it('--only restricts the text too', async () => {
    const { out } = await run({ only: 'stats' });
    expect(out[0]).toContain('stats:');
    expect(out[0]).not.toContain('trace');
  });

  it('the trace is readable text', async () => {
    const { out } = await run({ call: 'change.set' });
    expect(out[0]).toContain('step 2 "Change it" · call 1 "Set alpha" [change.set]');
    expect(out[0]).toContain('text (9 words): Alpha changes from 14 to 15 after the update.');
    expect(out[0]).toContain('a (updated): name=alpha val=>15<');
    expect(out[0]).toContain('focus view, stage of 3:');
  });
});
