/**
 * Heavy content for each panel, in the real viewer. See stress-scale.spec.ts for how the
 * budgets are chosen.
 */
import { expect, test } from '@playwright/test';
import {
  bigCode,
  bigGraph,
  bigSchema,
  bigTable,
  deepPayloadWalkthrough,
  manyPanes,
  nestedBoxes,
} from '../stress/gen';
import { openConfig, report, shell, stepTimes, watchErrors } from './stress-helpers';

test.describe.configure({ mode: 'default' });
test.setTimeout(240_000);

// ELK runs on the page's main thread, and its time grows with edges far faster than with nodes
// (measured in this project's layout settings: 160 nodes with 318 edges about 1 s, with 954 edges about
// 40 s). The two sparse sizes below are the supported range; the dense case further down is a pinned defect.
for (const [nodes, fanout, budget] of [
  [160, 2, 20_000],
  [300, 2, 30_000],
] as const) {
  test(`a graph of ${nodes} nodes and about ${nodes * fanout} edges is laid out and stepped through`, async ({
    page,
  }, testInfo) => {
    const errors = watchErrors(page);
    const config = bigGraph(nodes, fanout);
    const edges = (config.layout.panes[0]!.content as { edges: unknown[] }).edges.length;
    const calls = config.steps[0]!.calls.length;
    // Open on the last call so every node and edge is shown; ELK has to place all of them.
    const started = Date.now();
    await openConfig(page, 'graph', config, `#w=big-graph&s=1&c=${calls}`);
    await expect(page.locator('.react-flow__node')).toHaveCount(nodes, { timeout: budget });
    const ms = Date.now() - started;
    report(
      testInfo,
      `graph ${nodes} nodes / ${edges} edges: load until every node is in the DOM`,
      ms,
    );
    expect(ms).toBeLessThan(budget);

    // Walk the whole growth from the first call. The layout is cached, so this is the render cost.
    await page.goto('/?src=graph.json#w=big-graph&s=1&c=1');
    await expect(page.locator('.react-flow__node')).toHaveCount(nodes);
    const times = await stepTimes(page, 'ArrowRight', calls - 1);
    report(testInfo, `graph ${nodes} nodes: mean per call (re-fits the view)`, times.mean);
    report(testInfo, `graph ${nodes} nodes: worst per call`, times.worst);
    expect(times.worst).toBeLessThan(10_000);

    // No two nodes may share a position: the layout must separate them.
    const spots = await page
      .locator('.react-flow__node')
      .evaluateAll((all) => all.map((node) => (node as HTMLElement).style.transform));
    expect(new Set(spots).size).toBe(nodes);
    expect(errors).toEqual([]);
  });
}

// DEFECT: layout has no time limit and no worker, and ELK's time grows steeply with edge count. In this
// project's settings 100 nodes with 594 edges (a dense but plausible service map) took 7.7 to 8.6 s of
// main-thread time in Chromium and about 33 s in Node; 160 nodes with 954 edges took about 40 s in an
// uncontended Chromium run, and did not finish within several minutes when a second page was also running
// ELK. While it runs the page shows "Laying out…" and does not respond to anything
// (src/panels/_diagram/layout.ts withElk: elk.bundled.js, layered algorithm, no timeout, no worker).
// The 3 s budget is about 2.5 times below what was measured: a pass on much faster hardware does not
// mean the defect is fixed; a worker or a timeout would make the page responsive in any case.
// That 100/594 loads without a lint problem is checked in tests/stress/scale.test.tsx.
test.fail('a graph of 100 nodes and 594 edges is laid out within 3 s', async ({ page }) => {
  test.setTimeout(90_000);
  const started = Date.now();
  await openConfig(page, 'dense', bigGraph(100, 6), '#w=big-graph&s=1&c=1');
  await expect(page.locator('.react-flow__node')).toHaveCount(100, { timeout: 60_000 });
  expect(Date.now() - started).toBeLessThan(3000);
});

test('a table of 500 rows and 30 columns renders, marks cells and keeps rows in place', async ({
  page,
}, testInfo) => {
  const errors = watchErrors(page);
  const { ms } = await openConfig(page, 'table', bigTable(500, 30), '#w=big-table&s=1&c=1');
  report(testInfo, 'table 500x30: load and first paint', ms);
  expect(ms).toBeLessThan(15_000);
  await expect(page.locator('.fw-table tbody tr')).toHaveCount(500);
  await expect(page.locator('.fw-table thead th')).toHaveCount(30);
  const times = await stepTimes(page, 'ArrowRight', 11);
  report(testInfo, 'table 500x30: mean per call', times.mean);
  expect(times.worst).toBeLessThan(5000);
  // Rows that were removed stay in the DOM, hidden, so positions do not shift. Calls 4 and 8 removed a
  // row each; call 12 removes a third, which is still drawn, marked, on its own call.
  await expect(page.locator('.fw-table tbody tr')).toHaveCount(500);
  await expect(page.locator('.fw-table tbody tr.is-absent')).toHaveCount(2);
  await expect(page.locator('.fw-table tbody tr.is-removed')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a code source of 5,000 lines scrolls the marked line into view; 50,000 lines still loads', async ({
  page,
}, testInfo) => {
  const errors = watchErrors(page);
  const { ms } = await openConfig(page, 'code', bigCode(5000), '#w=big-code&s=1&c=2');
  report(testInfo, 'code 5,000 lines: load and first paint', ms);
  expect(ms).toBeLessThan(15_000);
  await expect(page.locator('.fw-code-line')).toHaveCount(5000);
  await expect(page.locator('.fw-code-line.is-read').first()).toHaveAttribute('data-line', '2498');
  await expect
    .poll(() => page.locator('.fw-code-scroll').evaluate((box) => box.scrollTop))
    .toBeGreaterThan(1000);
  const inside = await page
    .locator('.fw-code-line.is-read')
    .first()
    .evaluate((row) => {
      const box = row.closest('.fw-code-scroll')!.getBoundingClientRect();
      const at = row.getBoundingClientRect();
      return at.top >= box.top - 1 && at.bottom <= box.bottom + 1;
    });
  expect(inside, 'the first marked line is inside the scroll box').toBe(true);

  const big = await openConfig(page, 'code50', bigCode(50_000), '#w=big-code&s=1&c=3');
  report(testInfo, 'code 50,000 lines: load and first paint', big.ms);
  expect(big.ms).toBeLessThan(60_000);
  await expect(page.locator('.fw-code-line')).toHaveCount(50_000);
  expect(errors).toEqual([]);
});

test('a payload nested 12 levels deep marks and changes the leaf', async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  const config = deepPayloadWalkthrough(12, 8);
  const { ms } = await openConfig(page, 'deep', config, '#w=deep-payload&s=1&c=1');
  report(testInfo, 'payload depth 12: load and first paint', ms);
  const path = Array.from({ length: 12 }, (_, i) => `0.k${i}`).join('.');
  await expect(page.locator(`[data-path="${path}"]`)).toHaveAttribute('data-mark', 'read');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(`[data-path="${path}"]`)).toHaveAttribute('data-mark', 'updated');
  await expect(page.locator(`[data-path="${path}"]`)).toContainText('changed');
  expect(errors).toEqual([]);
});

test('a schema of 40 tables and 80 relations draws every relation', async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  const { ms } = await openConfig(page, 'schema', bigSchema(40, 80), '#w=big-schema&s=1&c=1');
  report(testInfo, 'schema 40 tables / 80 relations: load and first paint', ms);
  expect(ms).toBeLessThan(15_000);
  await expect(page.locator('.fw-schema-table')).toHaveCount(40);
  await expect(page.locator('.fw-schema-relation')).toHaveCount(80);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.fw-schema-column[data-entity="tbl4.created"]')).toHaveClass(
    /is-updated/,
  );
  await expect(
    page.locator('.fw-schema-column[data-entity="tbl4.created"] .fw-schema-type'),
  ).toHaveText('date');
  expect(errors).toEqual([]);
});

test('ten panes, six sharing the focus slot: exactly one focus pane is visible and show switches it', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const config = manyPanes(10, 6);
  await openConfig(page, 'panes', config, '#w=many-panes&s=1&c=1');
  const focus = config.layout.panes.filter((p) => p.role === 'focus').map((p) => p.id);
  const calls = config.steps[0]!.calls;
  for (let i = 0; i < calls.length; i += 1) {
    await expect(page.locator('.fw-pane')).toHaveCount(4 + 1);
    await expect(page.locator(`.fw-pane[data-pane="${calls[i]!.show}"]`)).toBeVisible();
    for (const other of focus.filter((id) => id !== calls[i]!.show)) {
      await expect(page.locator(`.fw-pane[data-pane="${other}"]`)).toHaveCount(0);
    }
    if (i < calls.length - 1) await page.keyboard.press('ArrowRight');
  }
  await expect(shell(page)).toHaveAttribute('data-call', String(calls.length));
  expect(errors).toEqual([]);
});

test('boxes nested 15 and 60 deep render and keep the deepest one reachable', async ({
  page,
}, testInfo) => {
  const errors = watchErrors(page);
  for (const depth of [15, 60]) {
    const { ms } = await openConfig(page, `nest${depth}`, nestedBoxes(depth), '#w=nested&s=1&c=1');
    report(testInfo, `boxes ${depth} deep: load and first paint`, ms);
    const deepest = page.locator(`.fw-box[data-entity="lvl${depth - 1}"]`);
    await expect(deepest).toBeAttached();
    await expect(deepest).toHaveClass(/is-read/);
    const width = await deepest.evaluate((el) => el.getBoundingClientRect().width);
    report(testInfo, `boxes ${depth} deep: innermost box width`, width, 'px');
  }
  expect(errors).toEqual([]);
});
