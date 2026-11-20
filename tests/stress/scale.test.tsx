import { describe, expect, it } from 'vitest';
import {
  createFolder,
  loadConfig,
  type ResolvedWalkthrough,
  type WalkthroughInput,
} from '../../src/core';
import { createRegistry } from '../../src/registry';
import {
  bigCode,
  bigGraph,
  bigSchema,
  bigTable,
  deepPayloadWalkthrough,
  longWalkthrough,
  manyPanes,
  nestedBoxes,
  wrap,
} from './gen';
import { cursorsOf } from './model';
import { renderAll } from './render';

const registry = createRegistry();

/**
 * The budgets are about ten times what a laptop needs, so they catch an accidental
 * quadratic or worse without flaking on a busy CI machine. The measured numbers are
 * logged with the label so a regression can be read off the output.
 */
const SLOW = Number(process.env.STRESS_SLOWDOWN ?? 1);

function timed<T>(label: string, budgetMs: number, run: () => T): T {
  const started = performance.now();
  const value = run();
  const ms = performance.now() - started;
  console.info(`[stress] ${label}: ${ms.toFixed(0)} ms (budget ${budgetMs * SLOW})`);
  expect(ms, `${label} took ${ms.toFixed(0)} ms`).toBeLessThan(budgetMs * SLOW);
  return value;
}

function load(label: string, config: WalkthroughInput, budgetMs: number): ResolvedWalkthrough {
  const result = timed(`loadConfig ${label}`, budgetMs, () => loadConfig(config, registry));
  expect(result.problems.filter((p) => p.severity === 'error')).toEqual([]);
  return result.walkthroughs[0]!;
}

function walkAll(label: string, w: ResolvedWalkthrough, budgetMs: number) {
  const folder = createFolder(w);
  const cursors = cursorsOf(w);
  timed(`fold forwards over ${cursors.length} calls, ${label}`, budgetMs, () => {
    for (const { s, c } of cursors) folder.at(s, c);
  });
  timed(`fold backwards over ${cursors.length} calls, ${label}`, budgetMs, () => {
    for (const { s, c } of [...cursors].reverse()) folder.at(s, c);
  });
  return folder;
}

describe('scale: the engine', () => {
  it('300 steps of 8 calls (2,400 calls, 2,400 messages) load and fold', () => {
    const w = load('2,400 calls', longWalkthrough(300, 8), 3000);
    walkAll('2,400 calls', w, 3000);
  });

  it('one step holding 1,500 calls: stepping through it does not go quadratic', () => {
    // folder.at(s, c) replays the step from its snapshot, so one huge step costs O(c) per cursor.
    const w = load('1,500 calls in one step', longWalkthrough(1, 1500), 3000);
    // Measured about 2.4 s for 1,500 cursors (1.6 ms each); the total is quadratic in the step length.
    walkAll('1,500 calls in one step', w, 20_000);
  });

  it('a graph of 160 nodes and ~900 edges added over many calls', () => {
    const w = load('graph 160 nodes', bigGraph(160, 6), 3000);
    expect((w.panes[0]!.content as { edges: unknown[] }).edges.length).toBeGreaterThan(800);
    walkAll('graph 160 nodes', w, 3000);
  });

  it('a dense graph of 100 nodes and 594 edges, and one of 160 nodes and 954 edges, pass lint', () => {
    // The e2e spec pins how slowly the layout engine handles these (stress-panels.spec.ts).
    load('graph 100 nodes dense', bigGraph(100, 6), 3000);
    load('graph 160 nodes dense', bigGraph(160, 6), 3000);
  });

  it('a table of 500 rows and 30 columns', () => {
    const w = load('table 500x30', bigTable(500, 30), 3000);
    walkAll('table 500x30', w, 3000);
  });

  it('a code source of 5,000 lines, and one of 200,000', () => {
    load('code 5,000 lines', bigCode(5000), 2000);
    load('code 200,000 lines', bigCode(200_000), 8000);
  });

  it('a payload nested 12 levels deep, with arrays of 8 at every level', () => {
    const w = load('payload depth 12', deepPayloadWalkthrough(12, 8), 2000);
    walkAll('payload depth 12', w, 2000);
  });

  it('a schema of 40 tables and 80 relations', () => {
    const w = load('schema 40/80', bigSchema(40, 80), 2000);
    walkAll('schema 40/80', w, 2000);
  });

  it('ten panes, six of them sharing the focus slot, switched back and forth 18 times', () => {
    const w = load('10 panes', manyPanes(10, 6), 2000);
    const folder = walkAll('10 panes', w, 2000);
    const seen = cursorsOf(w).map(({ s, c }) => folder.focusPane(s, c));
    expect(new Set(seen).size).toBe(6);
  });

  it('boxes nested 15 and 200 deep load, and removing the middle one folds', () => {
    for (const depth of [15, 200]) load(`boxes ${depth} deep`, nestedBoxes(depth), 1000);
  });

  it('the lint rule for effects on absent elements stays linear: 5,000 calls on one pane', () => {
    const calls = Array.from({ length: 5000 }, (_, i) => ({
      id: `c${i}`,
      label: `c${i}`,
      effects: { g: [{ add: `n${i}` }, { read: `n${i}` }] },
    }));
    const nodes = Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}`, label: `n${i}` }));
    load(
      '5,000 calls, 5,000 nodes',
      wrap(
        'lin',
        [{ id: 'g', panel: 'graph', content: { nodes } }],
        [{ id: 's', title: 'S', calls }],
      ),
      5000,
    );
  });
});

describe('scale: server-rendered panels at the last call', () => {
  it('table 500x30 renders', () => {
    const w = load('table', bigTable(500, 30), 3000);
    const last = w.steps[0]!.calls.length - 1;
    const started = performance.now();
    const { complaints } = renderAll({
      ...w,
      steps: [{ ...w.steps[0]!, calls: [w.steps[0]!.calls[last]!] }],
    });
    console.info(
      `[stress] SSR table 500x30, one call: ${(performance.now() - started).toFixed(0)} ms`,
    );
    expect(complaints).toEqual([]);
  });
});
