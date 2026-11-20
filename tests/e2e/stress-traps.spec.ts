/**
 * Panel-specific traps, ids, loading paths and hostile text, in the real viewer.
 * `test.fail` marks a pinned defect: the test body states what should happen and the
 * comment above it names what is wrong. A passing sibling proves the fixture is sound.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { HOSTILE_TEXT, collection, longWalkthrough, wrap } from '../stress/gen';
import { openConfig, openRaw, pageOverflow, position, shell, watchErrors } from './stress-helpers';

const call = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, ...extra });
const steps = (calls: Record<string, unknown>[]) => [
  { id: 's', title: 'S', calls: calls as never },
];
const graph = (content: object, calls = [call('k')]) =>
  wrap(
    'traps',
    [{ id: 'g', panel: 'graph', content: { initial: true, ...content } as never }],
    steps(calls),
  );
const node = (id: string, extra: object = {}) => ({ id, label: id.toUpperCase(), ...extra });

async function lines(page: Page, edgeId: string) {
  return page.locator(`.react-flow__edge[data-id="${edgeId}"] .fw-edge-line`).evaluateAll((all) =>
    all.map(
      (line) =>
        // A routed edge is a path (its `d`); a straight one is a line (its end points).
        line.getAttribute('d') ??
        ['x1', 'y1', 'x2', 'y2'].map((a) => Number(line.getAttribute(a)).toFixed(2)).join(','),
    ),
  );
}

// ---------------------------------------------------------------------------
test.describe('graph edges', () => {
  test('precondition: a plain edge and two opposite edges each draw one line', async ({ page }) => {
    const errors = watchErrors(page);
    await openConfig(
      page,
      'edges',
      graph({
        nodes: [node('a'), node('b'), node('c')],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
          { from: 'b', to: 'c' },
        ],
      }),
    );
    await expect(page.locator('.fw-edge-line')).toHaveCount(3);
    const [ab] = await lines(page, 'a.b');
    const [ba] = await lines(page, 'b.a');
    expect(ab, 'opposite edges are offset from each other').not.toBe(ba);
    expect(errors).toEqual([]);
  });

  // DEFECT: a self-loop is dropped in silence: FloatingEdge returns null when the two ends coincide
  // (src/panels/_diagram/Diagram.tsx FloatingEdge, `length < 1`), and lint accepts it.
  test('precondition: a self-loop loads and its node is drawn', async ({ page }) => {
    const errors = watchErrors(page);
    await openConfig(
      page,
      'loop',
      graph({
        nodes: [node('a'), node('b')],
        edges: [
          { id: 'loop', from: 'a', to: 'a' },
          { from: 'a', to: 'b' },
        ],
      }),
    );
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await expect(page.locator('.react-flow__edge[data-id="a.b"] .fw-edge-line')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
  test('a self-loop edge is drawn', async ({ page }) => {
    await openConfig(
      page,
      'loop',
      graph({ nodes: [node('a'), node('b')], edges: [{ id: 'loop', from: 'a', to: 'a' }] }),
    );
    await expect(page.locator('.react-flow__edge[data-id="loop"] .fw-edge-line')).toHaveCount(1, {
      timeout: 3000,
    });
  });

  // DEFECT: two edges between the same ends (allowed with explicit ids, and recommended by the docs)
  // are drawn on exactly the same line, so one hides the other.
  test('precondition: parallel edges with explicit ids both exist', async ({ page }) => {
    await openConfig(
      page,
      'parallel',
      graph({
        nodes: [node('a'), node('b')],
        edges: [
          { id: 'e1', from: 'a', to: 'b', label: 'one' },
          { id: 'e2', from: 'a', to: 'b', label: 'two' },
        ],
      }),
    );
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    await expect(page.locator('.fw-edge-line')).toHaveCount(2);
  });
  test('parallel edges are drawn apart', async ({ page }) => {
    await openConfig(
      page,
      'parallel',
      graph({
        nodes: [node('a'), node('b')],
        edges: [
          { id: 'e1', from: 'a', to: 'b', label: 'one' },
          { id: 'e2', from: 'a', to: 'b', label: 'two' },
        ],
      }),
    );
    await expect(page.locator('.fw-edge-line')).toHaveCount(2);
    const [one] = await lines(page, 'e1');
    const [two] = await lines(page, 'e2');
    expect(one).not.toBe(two);
  });

  test('cycles, disconnected components and an isolated node are laid out apart, with no errors', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id));
    const edges = [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
      ['d', 'e'],
    ].map(([from, to]) => ({ from, to }));
    await openConfig(page, 'cycle', graph({ nodes, edges }));
    await expect(page.locator('.react-flow__node')).toHaveCount(6);
    const spots = await page
      .locator('.react-flow__node')
      .evaluateAll((all) => all.map((n) => (n as HTMLElement).style.transform));
    expect(new Set(spots).size).toBe(6);
    await expect(page.locator('.fw-edge-line')).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test('node ids with dashes, underscores and leading digits are addressable, selectable and survive a reload from the URL', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const ids = ['a-b', 'c_d', 'e-f', 'g_h', '1-2_3-4'];
    await openConfig(
      page,
      'ids',
      graph({ nodes: ids.map((id) => node(id)), edges: [{ from: 'a-b', to: 'c_d' }] }),
    );
    for (const id of ids) {
      await page.locator(`.react-flow__node[data-id="${id}"]`).click();
      await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toHaveClass(/is-selected/);
      await expect(page).toHaveURL(
        new RegExp(`sel=${encodeURIComponent(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      );
    }
    await page.reload();
    await expect(page.locator(`.react-flow__node[data-id="1-2_3-4"]`)).toHaveClass(/is-selected/);
    expect(errors).toEqual([]);
  });

  test('when every node is pinned the pinned positions are used as given', async ({ page }) => {
    await openConfig(
      page,
      'pins',
      graph({
        nodes: [node('a', { x: 0, y: 0 }), node('b', { x: 400, y: 300 })],
        edges: [{ from: 'a', to: 'b' }],
      }),
    );
    await expect(page.locator('.react-flow__node[data-id="b"]')).toBeVisible();
    const at = (id: string) =>
      page
        .locator(`.react-flow__node[data-id="${id}"]`)
        .evaluate((n) => (n as HTMLElement).style.transform);
    expect(await at('a')).toContain('translate(0px, 0px)');
    expect(await at('b')).toContain('translate(400px, 300px)');
  });

  // Was a pinned defect (a node with only `x` went to ELK and its pin was dropped silently). Now a
  // pin on one axis is kept, the layout places the rest round it, and a pin the layout cannot use
  // (groups, grid, tree, hub) is reported by lint as graph/pin-ignored.
  test('a node pinned in x only keeps its x', async ({ page }) => {
    await openConfig(
      page,
      'halfpin',
      graph({ nodes: [node('a', { x: 900 }), node('b')], edges: [{ from: 'a', to: 'b' }] }),
    );
    await expect(page.locator('.react-flow__node[data-id="a"]')).toBeVisible();
    const t = await page
      .locator('.react-flow__node[data-id="a"]')
      .evaluate((n) => (n as HTMLElement).style.transform);
    expect(t).toContain('translate(900px');
  });
});

// ---------------------------------------------------------------------------
test.describe('schema', () => {
  const schema = (relations: object[]) =>
    wrap(
      'schema',
      [
        {
          id: 's',
          panel: 'schema',
          content: {
            tables: [
              {
                id: 'orders',
                label: 'Orders',
                columns: [
                  { id: 'id', key: 'PK' },
                  { id: 'user-ref', note: 'dashed' },
                  { id: 'plain' },
                ],
              },
              { id: 'users', label: 'Users', columns: [{ id: 'id', key: 'PK' }] },
            ],
            relations,
          } as never,
        },
      ],
      steps([call('k')]),
    );

  test('relations to plain columns, to tables, back to the same table and in both directions are drawn', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openConfig(
      page,
      'rel',
      schema([
        { from: 'orders.plain', to: 'users.id' },
        { from: 'users.id', to: 'orders.id' },
        { from: 'orders.id', to: 'orders.plain' },
        { from: 'orders', to: 'users' },
      ]),
    );
    await expect(page.locator('.fw-schema-relation')).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  // A column id cannot contain a dot, so "orders.user-ref" can only mean the column "user-ref" of
  // the table "orders".
  test('a column with a dash in its id is drawn', async ({ page }) => {
    await openConfig(page, 'dashed', schema([{ from: 'orders.user-ref', to: 'users.id' }]));
    await expect(page.locator('.fw-schema-column[data-entity="orders.user-ref"]')).toBeVisible();
  });
  test('a relation from a column with a dash in its id is drawn', async ({ page }) => {
    await openConfig(page, 'dashed', schema([{ from: 'orders.user-ref', to: 'users.id' }]));
    await expect(page.locator('.fw-schema-relation')).toHaveCount(1, { timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
test.describe('boxes', () => {
  const boxes = () =>
    wrap(
      'nest',
      [
        {
          id: 'b',
          panel: 'boxes',
          content: {
            boxes: [node('outer', { initial: false }), node('inner', { parent: 'outer' })],
          } as never,
        },
      ],
      steps([call('k', { effects: { b: [{ read: 'inner' }] } })]),
    );

  test('precondition: the inner box is present and marked as read, though its parent has not been added', async ({
    page,
  }) => {
    await openConfig(page, 'nest', boxes());
    await expect(page.locator('.fw-box[data-entity="inner"]')).toHaveAttribute('data-mark', 'read');
    await expect(page.locator('.fw-box[data-entity="outer"]')).toHaveAttribute(
      'data-mark',
      'absent',
    );
  });

  // WEAKNESS: an absent box is `visibility: hidden`, and that is inherited by the boxes inside it, so a
  // box that the state says is present (and that the call reads) cannot be seen. Lint accepts it
  // (src/panels/boxes/boxes.css `.fw-box.is-absent`; no lint rule relates a child's start to its parent's).
  test.fail('a present box inside an absent box is visible', async ({ page }) => {
    await openConfig(page, 'nest', boxes());
    await expect(page.locator('.fw-box[data-entity="inner"]')).toBeVisible({ timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
test('the same id in four panes selects it in all four', async ({ page }) => {
  const errors = watchErrors(page);
  const config = wrap(
    'same',
    [
      { id: 'g', panel: 'graph', content: { initial: true, nodes: [node('shared')] } as never },
      {
        id: 't',
        panel: 'table',
        content: {
          columns: [{ id: 'c', label: 'C' }],
          rows: [{ id: 'shared', cells: { c: 'a row' } }],
        },
      },
      { id: 'b', panel: 'boxes', content: { boxes: [node('shared')] } },
      { id: 's', panel: 'schema', content: { tables: [{ id: 'shared', label: 'T' }] } },
    ],
    steps([call('k')]),
  );
  await openConfig(page, 'same', config);
  await page.locator('.fw-table tr[data-entity="shared"]').click();
  await expect(page.locator('.react-flow__node[data-id="shared"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.fw-box[data-entity="shared"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.fw-schema-table[data-entity="shared"]')).toHaveClass(/is-selected/);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
test.describe('URL hash and selection', () => {
  const walk = () => longWalkthrough(4, 3);

  test('cursors that are out of range, negative, fractional, non-numeric or huge open at a valid call', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    for (const [hash, expected] of [
      ['#w=long&s=999&c=999', '4.3'],
      ['#w=long&s=-1&c=-1', '1.1'],
      ['#w=long&s=x&c=y', '1.1'],
      ['#w=long&s=2.7&c=1.2', '2.1'],
      ['#w=long&s=99999999999999999999&c=2', '4.2'],
      ['#w=nope&s=3&c=3', '1.1'],
      ['#', '1.1'],
    ] as const) {
      await openConfig(page, 'long', walk(), hash);
      expect(await position(page), hash).toBe(expected);
    }
    expect(errors).toEqual([]);
  });

  // DEFECT: a number too large for a double becomes Infinity, which toInt maps to 0, so the link opens
  // on step 1 where 99999999999999999999 opens on the last step (src/core/cursor.ts toInt).
  test('a cursor of 1e999 opens on the last call, like any other huge number', async ({ page }) => {
    await openConfig(page, 'long', walk(), '#w=long&s=1e999&c=1');
    expect(await position(page)).toBe('4.1');
  });

  test('a selection that names no element, or one in a hidden focus pane, shows and clears without errors', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const config = wrap(
      'hidden',
      [
        {
          id: 'one',
          panel: 'table',
          role: 'focus',
          content: {
            columns: [{ id: 'c', label: 'C' }],
            rows: [{ id: 'r1', cells: { c: 'first' } }],
          },
        },
        {
          id: 'two',
          panel: 'table',
          role: 'focus',
          content: {
            columns: [{ id: 'c', label: 'C' }],
            rows: [{ id: 'r2', cells: { c: 'second' } }],
          },
        },
      ],
      steps([call('k', { show: 'one' })]),
    );
    await openConfig(page, 'hidden', config, '#w=hidden&sel=ghost');
    await expect(page.locator('.fw-selected')).toContainText('ghost');
    await page.goto('/?src=hidden.json#w=hidden&sel=r2');
    await expect(page.locator('.fw-selected')).toContainText('second');
    await expect(page.locator('.fw-table tr[data-entity="r2"]')).toHaveCount(0);
    await page.locator('.fw-selected').getByRole('button', { name: 'Clear' }).click();
    await expect(page).not.toHaveURL(/sel=/);
    expect(errors).toEqual([]);
  });

  test('hash edits made by hand while the config is still loading are honoured', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/slow.json', async (route) => {
      await new Promise((done) => setTimeout(done, 800));
      await route.fulfill({ json: walk() });
    });
    await page.goto('/?src=slow.json#w=long&s=1&c=1');
    await page.evaluate(() => {
      window.location.hash = '#w=long&s=3&c=2';
    });
    await expect(shell(page)).toBeVisible();
    expect(await position(page)).toBe('3.2');
    await page.evaluate(() => {
      window.location.hash = '#w=long&s=2&c=3';
    });
    await expect.poll(() => position(page)).toBe('2.3');
  });

  test('a collection whose walkthroughs share an id shows one duplicate-id problem at the second', async ({
    page,
  }) => {
    await page.route('**/dup.json', (route) =>
      route.fulfill({ json: collection(['same', 'same']) }),
    );
    await page.goto('/?src=dup.json');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This config has problems');
    await expect(page.locator('.fw-problems li')).toHaveCount(1);
    await expect(page.locator('.fw-problems li code')).toHaveText('walkthroughs[1].id');
  });

  test('a collection with distinct ids shows a picker, and picking resets to the first call', async ({
    page,
  }) => {
    await page.route('**/many.json', (route) =>
      route.fulfill({ json: collection(['one', 'two', 'three']) }),
    );
    await page.goto('/?src=many.json#w=three&s=2&c=2');
    await expect(page.locator('.fw-picker select')).toHaveValue('three');
    await page.locator('.fw-picker select').selectOption('one');
    expect(await position(page)).toBe('1.1');
  });
});

// ---------------------------------------------------------------------------
test.describe('loading with ?src=', () => {
  const heading = (page: Page) => page.getByRole('heading', { level: 1 });

  test('invalid JSON, an empty body and an HTML error page say the config could not be loaded', async ({
    page,
  }) => {
    for (const [name, body] of [
      ['bad', '{"id": '],
      ['empty', ''],
      ['html', '<!doctype html><title>Not found</title>'],
    ] as const) {
      await page.route(`**/${name}.json`, (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body }),
      );
      await page.goto(`/?src=${name}.json`);
      await expect(heading(page), name).toHaveText('The config could not be loaded');
      await expect(page.locator('.fw-problems li')).toHaveCount(1);
    }
  });

  test('JSON of the wrong shape (null, a list, a number, a string, an empty object) lists problems and does not crash', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    for (const body of [
      'null',
      '[]',
      '5',
      '"x"',
      '{}',
      '{"walkthroughs": []}',
      '{"walkthroughs": [null]}',
    ]) {
      await page.route('**/shape.json', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body }),
      );
      await page.goto(`/?src=shape.json`);
      await expect(heading(page), body).toHaveText('This config has problems');
      expect(await page.locator('.fw-problems li').count(), body).toBeGreaterThan(0);
    }
    expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
  });

  test('the content type is ignored: a valid config served as text/plain still loads', async ({
    page,
  }) => {
    await page.route('**/plain.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: JSON.stringify(longWalkthrough(2, 2)),
      }),
    );
    await page.goto('/?src=plain.json');
    await expect(shell(page)).toBeVisible();
  });

  test('a 20 MB config loads, or fails with a message, without hanging the page', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const line =
      'const value = compute(0, 1, 2, 3, 4); // a line of plausible source text 0123456789';
    const text = Array.from({ length: 250_000 }, () => line).join('\n');
    const config = wrap(
      'huge',
      [{ id: 'c', panel: 'code', content: { sources: [{ id: 'big', title: 'big', text }] } }],
      steps([call('k', { effects: { c: [{ read: 'big', lines: [[1, 3]] }] } })]),
    );
    const started = Date.now();
    await page.route('**/huge.json', (route) => route.fulfill({ json: config }));
    await page.goto('/?src=huge.json');
    await expect(shell(page)).toBeVisible({ timeout: 100_000 });
    const ms = Date.now() - started;
    testInfo.annotations.push({
      type: 'perf',
      description: `20 MB code source (250,000 lines) shown after ${ms} ms`,
    });
    console.info(`[stress] 20 MB code source, 250,000 lines: ${ms} ms to a visible shell`);
    expect(ms).toBeLessThan(100_000);
  });
});

// ---------------------------------------------------------------------------
test.describe('hostile text', () => {
  const config = () =>
    wrap(
      'hostile',
      [
        {
          id: 'g',
          panel: 'graph',
          content: {
            initial: true,
            nodes: HOSTILE_TEXT.map((t, i) => ({ id: `n${i}`, label: t, sub: t })),
          } as never,
        },
        {
          id: 't',
          panel: 'table',
          content: {
            columns: HOSTILE_TEXT.map((t, i) => ({ id: `c${i}`, label: t })),
            rows: [
              { id: 'r', cells: Object.fromEntries(HOSTILE_TEXT.map((t, i) => [`c${i}`, t])) },
            ],
          },
        },
        {
          id: 'p',
          panel: 'payload',
          content: {
            payloads: [
              {
                id: 'x',
                title: HOSTILE_TEXT[1]!,
                value: Object.fromEntries(HOSTILE_TEXT.map((t, i) => [`k${i}`, t])),
                raw: { text: HOSTILE_TEXT.join('\n') },
              },
            ],
          },
        },
      ],
      [
        {
          id: 's',
          title: HOSTILE_TEXT[0]!,
          text: HOSTILE_TEXT[2]!,
          calls: [
            {
              id: 'k',
              label: HOSTILE_TEXT[1]!,
              text: HOSTILE_TEXT.join('\n'),
              where: HOSTILE_TEXT[3]!,
              request: HOSTILE_TEXT[4]!,
              response: { lang: HOSTILE_TEXT[0]!, text: HOSTILE_TEXT[0]! },
            },
          ],
        },
      ],
      { title: HOSTILE_TEXT[0]!, lead: HOSTILE_TEXT[1]! },
    );

  async function check(page: Page) {
    await expect(shell(page)).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned),
    ).toBeUndefined();
    // The text is on the page as text, in the places it was written.
    await expect(page.locator('.fw-head h1')).toHaveText(HOSTILE_TEXT[0]!);
    await expect(page.locator('.fw-card-title')).toHaveText(HOSTILE_TEXT[1]!);
    await expect(page.locator('.fw-table tbody td').first()).toHaveText(HOSTILE_TEXT[0]!);
    await expect(page.locator('.react-flow__node[data-id="n9"] .fw-node-label')).toHaveText(
      HOSTILE_TEXT[9]!,
    );
    expect(
      await page.locator('script').count(),
      'only the viewer script is in the DOM',
    ).toBeLessThanOrEqual(2);
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(await page.locator('svg[onload]').count()).toBe(0);
  }

  test('through ?src=: hostile labels, cells, payloads and card text stay text', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openConfig(page, 'hostile', config());
    await check(page);
    expect(errors).toEqual([]);
  });

  test('through a page built by the command line: hostile text is written into the file and read back intact', async ({
    page,
  }, testInfo) => {
    const dir = mkdtempSync(join(tmpdir(), 'fw-hostile-'));
    const src = join(dir, 'hostile.json');
    const out = testInfo.outputPath('hostile.html');
    writeFileSync(src, JSON.stringify(config()));
    execFileSync(process.execPath, ['dist/cli/index.js', 'build', src, '-o', out], {
      stdio: 'pipe',
    });
    const errors = watchErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pathToFileURL(out).href);
    await check(page);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
test.describe('a config that passes lint must not blank the page', () => {
  const twoPanes = (firstPane: string) =>
    wrap(
      'blank',
      [
        {
          id: firstPane,
          panel: 'graph',
          content: { initial: true, nodes: [node('a')] } as never,
        },
        { id: 'other', panel: 'graph', content: { nodes: [node('b')] } as never },
      ],
      steps([call('k', { effects: { other: [{ add: 'b' }] } })]),
    );
  const refText = (text: unknown) =>
    wrap(
      'blank',
      [
        {
          id: 'p',
          panel: 'payload',
          content: { payloads: [{ id: 'd', title: 'D', value: { link: { $ref: 'd', text } } }] },
        },
      ],
      steps([call('k')]),
    );

  test('precondition: the same shapes with ordinary names and string text show the shell', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openConfig(page, 'blank', twoPanes('first'));
    await expect(page.locator('.react-flow__node[data-id="a"]')).toBeAttached();
    await openConfig(page, 'blank', refText('see itself'));
    await expect(page.locator('[data-ref="d"]')).toHaveText('see itself');
    expect(errors).toEqual([]);
  });

  // DEFECT: loadConfig throws for a pane named like an Object.prototype member, and nothing in the
  // viewer catches it, so React unmounts the whole tree (see lint.test.tsx for the cause).
  test('a pane named "constructor" shows the walkthrough', async ({ page }) => {
    const errors = watchErrors(page);
    await openRaw(page, 'blank', twoPanes('constructor'));
    await expect(page.locator('.react-flow__node[data-id="a"]')).toBeAttached({ timeout: 3000 });
    expect(errors).toEqual([]);
  });

  // A $ref whose text is an object used to throw while drawing. Lint now refuses it, so the page
  // lists the problem instead of going blank.
  test('a $ref with text {} is listed as a problem, not drawn', async ({ page }) => {
    const errors = watchErrors(page);
    await openRaw(page, 'blank', refText({}));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This config has problems');
    await expect(page.getByText(/payload\/bad-ref/)).toBeVisible();
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A long token with no break opportunity (a URL, a hash, an identifier) is ordinary content.
test.describe('long unbroken text', () => {
  const URLISH = `https://example.test/a/b?q=${'w'.repeat(280)}`;
  type Field = [string, (text: string) => object];
  const base = () =>
    wrap(
      'long',
      [
        {
          id: 'g',
          panel: 'graph',
          content: { initial: true, nodes: [{ id: 'a', label: 'A' }] } as never,
        },
      ],
      steps([call('k')]),
    );
  const withPane = (pane: object) => ({ layout: { panes: [pane] } });
  const withCall = (extra: Record<string, unknown>) => ({ steps: steps([call('k', extra)]) });

  // DEFECT: one 300-character URL in any of these fields spills out of its box and gives the page a
  // sideways scroll (measured at 1,800 to 3,900 px). `overflow-wrap` is set only on .fw-selected,
  // .fw-code, .fw-fields dd and .fw-problems li (src/shell/shell.css:340, :404, :428, :546); the
  // header h1, .fw-lead, .fw-step-title, .fw-card-title, .fw-card-text, .fw-card-where, .fw-pane-title,
  // the code source title and the sequence lane buttons have none. Not every offender was traced to
  // its own rule; the fix may also need `min-width: 0` on some flex or grid children.
  const overflowing: Field[] = [
    ['walkthrough title', (t) => ({ title: t })],
    ['lead', (t) => ({ lead: t })],
    ['step title', (t) => ({ steps: steps([call('k')]).map((st) => ({ ...st, title: t })) })],
    ['call label', (t) => withCall({ label: t })],
    ['call text', (t) => withCall({ text: t })],
    ['call where', (t) => withCall({ where: t })],
    [
      'pane title',
      (t) =>
        withPane({
          id: 'g',
          panel: 'graph',
          title: t,
          content: { initial: true, nodes: [{ id: 'a', label: 'A' }] },
        }),
    ],
    [
      'code source title',
      (t) =>
        withPane({
          id: 'c',
          panel: 'code',
          content: { sources: [{ id: 'x', title: t, text: 'a' }] },
        }),
    ],
    [
      'lane title',
      (t) => ({
        lanes: [
          { id: 'client', title: t },
          { id: 'gateway', title: 'G' },
        ],
        layout: { panes: [{ id: 'q', panel: 'sequence' }] },
        steps: steps([call('k', { from: 'client', to: 'gateway' })]),
      }),
    ],
  ];
  const contained: Field[] = [
    ['request block', (t) => withCall({ request: t })],
    [
      'graph label and sub',
      (t) =>
        withPane({
          id: 'g',
          panel: 'graph',
          content: { initial: true, nodes: [{ id: 'a', label: t, sub: t }] },
        }),
    ],
    [
      'table header and cell',
      (t) =>
        withPane({
          id: 't',
          panel: 'table',
          content: { columns: [{ id: 'c', label: t }], rows: [{ id: 'r', cells: { c: t } }] },
        }),
    ],
    [
      'box label and sub',
      (t) =>
        withPane({ id: 'b', panel: 'boxes', content: { boxes: [{ id: 'x', label: t, sub: t }] } }),
    ],
    [
      'schema label, column, type, note',
      (t) =>
        withPane({
          id: 's',
          panel: 'schema',
          content: {
            tables: [
              { id: 'x', label: t, sub: t, columns: [{ id: 'c', label: t, type: t, note: t }] },
            ],
          },
        }),
    ],
    [
      'payload title, key, value, raw',
      (t) =>
        withPane({
          id: 'p',
          panel: 'payload',
          content: {
            payloads: [{ id: 'x', title: t, sub: t, value: { [t]: t }, raw: { text: t } }],
          },
        }),
    ],
    [
      'code text',
      (t) =>
        withPane({
          id: 'c',
          panel: 'code',
          content: { sources: [{ id: 'x', title: 'x', text: t }] },
        }),
    ],
  ];
  const config = (make: (t: string) => object, token = URLISH) =>
    ({ ...base(), ...make(token) }) as never;

  test('precondition: a short title does not widen the page, so the measurement is meaningful', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openConfig(
      page,
      'long',
      config((t) => ({ title: t }), 'Short title'),
    );
    expect(await pageOverflow(page)).toBe(0);
  });

  for (const [name, make] of overflowing) {
    test(`${name}: a 300-character URL does not widen the page`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await openConfig(page, 'long', config(make));
      await expect(shell(page)).toBeVisible();
      expect(await pageOverflow(page)).toBe(0);
    });
  }

  for (const width of [1280, 390]) {
    test(`${width}px wide: a 300-character URL stays inside its own box in ${contained.length} other places`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height: 800 });
      for (const [name, make] of contained) {
        await openConfig(page, 'long', config(make));
        await expect(shell(page)).toBeVisible();
        expect(await pageOverflow(page), name).toBe(0);
      }
      expect(errors).toEqual([]);
    });
  }
});
