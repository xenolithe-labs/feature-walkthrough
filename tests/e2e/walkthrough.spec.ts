import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { demos } from '../../src/walkthroughs';
import { withPanes } from '../helpers/panes';
import { openConfig } from './stress-helpers';

const walkthroughs = 'walkthroughs' in demos ? demos.walkthroughs : [demos];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const shell = (page: Page) => page.locator('.fw[data-walkthrough]');

async function position(page: Page): Promise<string> {
  const root = shell(page);
  return `${await root.getAttribute('data-step')}.${await root.getAttribute('data-call')}`;
}

async function open(page: Page, hash = ''): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/${hash}`);
  await expect(shell(page)).toBeVisible();
  await expect(page.locator('.fw-pane').first()).toBeVisible();
  // A graph or flow pane draws its nodes a moment later. Not every walkthrough has one.
  await page.waitForFunction(
    () =>
      document.querySelector('.fw-pane[data-panel="graph"], .fw-pane[data-panel="flow"]') ===
        null || document.querySelector('.react-flow__node') !== null,
  );
}

for (const walkthrough of walkthroughs) {
  const cursors = walkthrough.steps.flatMap((step, s) =>
    step.calls.map((call, c) => ({ at: `${s + 1}.${c + 1}`, label: call.label })),
  );

  test(`${walkthrough.id}: every call steps forward and back with no console errors`, async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await open(page, `#w=${walkthrough.id}`);

    for (const [index, cursor] of cursors.entries()) {
      if (index > 0) await page.keyboard.press('ArrowRight');
      expect(await position(page)).toBe(cursor.at);
      await expect(page.locator('.fw-card-title')).toHaveText(cursor.label);
    }
    await expect(page.getByRole('button', { name: 'Next call' })).toBeDisabled();
    await page.keyboard.press('ArrowRight');
    expect(await position(page)).toBe(cursors.at(-1)!.at);

    for (const cursor of [...cursors].reverse().slice(1)) {
      await page.keyboard.press('ArrowLeft');
      expect(await position(page)).toBe(cursor.at);
    }
    await expect(page.getByRole('button', { name: 'Previous call' })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test(`${walkthrough.id}: no element moves between the first call and the last`, async ({
    page,
  }) => {
    // Graph and flow nodes, and the cells and index labels of an array. Pointers and ranges
    // move by design, but the cells they move over must not. The event slots and offsets of a
    // bus and the instants and ticks of a timeline have fixed places too: they are measured from
    // the scrolling content they sit in, which a reveal may scroll.
    // The rows of a table are included when a table pane is always on the page (not one that
    // shares a slot, which is not there at the first call). They are measured from the table.
    const fixedTable = walkthrough.layout.panes.some(
      (pane) => pane.panel === 'table' && pane.role !== 'focus',
    );
    const places = () =>
      page
        .locator(
          `.react-flow__node, .fw-array-cell, .fw-array-index, .fw-bus-event, .fw-bus-offset, .fw-tl-instant, .fw-tl-tick${fixedTable ? ', .fw-table tbody tr' : ''}`,
});

          '.react-flow__node, .fw-array-cell, .fw-array-index, .fw-bus-event, .fw-bus-offset, .fw-tl-instant, .fw-tl-tick, .fw-by-field',
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            if (node.classList.contains('react-flow__node')) {
              return [node.getAttribute('data-id'), (node as HTMLElement).style.transform];
            }
            const box = node.getBoundingClientRect();
            const pane = (
              node.closest('.fw-bus-grid, .fw-tl-inner, .fw-table') ?? node.closest('.fw-pane')!
});

              node.closest('.fw-bus-grid, .fw-tl-inner, .fw-by-inner') ?? node.closest('.fw-pane')!
            ).getBoundingClientRect();
            return [
              node.getAttribute('data-entity') ?? node.textContent,
              Math.round(box.left - pane.left),
              Math.round(box.top - pane.top),
            ];
          }),
        );
    await open(page, `#w=${walkthrough.id}`);
    const before = await places();
    expect(before.length).toBeGreaterThan(0);
    for (let index = 1; index < cursors.length; index += 1) await page.keyboard.press('ArrowRight');
    expect(await position(page)).toBe(cursors.at(-1)!.at);
    expect(await places()).toEqual(before);
  });
}

test('Shift with an arrow moves one step, and the step strip and dots jump', async ({ page }) => {
  await open(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  expect(await position(page)).toBe('2.1');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowLeft');
  expect(await position(page)).toBe('1.1');

  await page.getByRole('navigation', { name: 'Steps' }).getByRole('button').nth(3).click();
  expect(await position(page)).toBe('4.1');
  await page.getByRole('list', { name: 'Calls in this step' }).getByRole('button').nth(2).click();
  expect(await position(page)).toBe('4.3');
  await expect(page).toHaveURL(/#w=oauth-pkce&s=4&c=3$/);
});

test('a deep link opens the same call and the same selection', async ({ page }) => {
  await open(page, '#w=oauth-pkce&s=4&c=3&sel=code');
  expect(await position(page)).toBe('4.3');
  await expect(page.locator('.fw-card-title')).toHaveText('Use up the code');
  await expect(page.locator('.fw-selected')).toContainText('authorization code');
  await expect(page.locator('.react-flow__node[data-id="code"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.react-flow__node[data-id="code"]')).toHaveClass(/is-updated/);
  await expect(page.locator('.react-flow__node[data-id="pending"]')).toHaveClass(/is-removed/);

  // A stale link falls back to the nearest valid call instead of failing.
  await page.goto('/#w=oauth-pkce&s=99&c=99');
  await expect(shell(page)).toHaveAttribute('data-step', '5');
  await expect(shell(page)).toHaveAttribute('data-call', '4');
});

test('selecting an element in one place highlights it everywhere', async ({ page }) => {
  await open(page, '#w=oauth-pkce&s=4&c=1');
  // Pick the authorization code from the card.
  await page
    .locator('.fw-card')
    .getByRole('button', { name: /authorization code/ })
    .click();
  await expect(page).toHaveURL(/sel=code/);
  await expect(page.locator('.react-flow__node[data-id="code"]')).toHaveClass(/is-selected/);
  // The sequence marks every message whose call touched the code.
  const related = page.locator('.fw-seq-message.is-related');
  await expect(related).toHaveCount(3);
  await expect(related.first()).toHaveAttribute('data-entity', 'redirect-back');

  // Pick a different element in the graph: the selection moves there.
  await page.locator('.react-flow__node[data-id="verifier"]').click();
  await expect(page).toHaveURL(/sel=verifier/);
  await expect(page.locator('.react-flow__node[data-id="code"]')).not.toHaveClass(/is-selected/);
  await expect(page.locator('.fw-selected')).toContainText('code_verifier');

  await page.locator('.fw-selected').getByRole('button', { name: 'Clear' }).click();
  await expect(page).not.toHaveURL(/sel=/);
});

test('elements appear only once a call adds them', async ({ page }) => {
  await open(page, '#w=oauth-pkce&s=1&c=1');
  await expect(page.locator('.react-flow__node[data-id="verifier"]')).toHaveClass(/is-added/);
  await expect(page.locator('.react-flow__node[data-id="access"]')).toHaveClass(/is-absent/);
  await expect(page.locator('.fw-seq-message')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.react-flow__node[data-id="verifier"]')).toHaveClass(/is-read/);
  await expect(page.locator('.react-flow__node[data-id="challenge"]')).toHaveClass(/is-added/);
  await expect(page.locator('.fw-seq-message')).toHaveCount(2);
  await expect(page.locator('.fw-seq-message.is-added')).toHaveAttribute(
    'data-entity',
    'make-challenge',
  );
});

for (const walkthrough of walkthroughs) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${walkthrough.id}: a phone-width page has no sideways scroll (${scheme})`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      // The last step: everything the walkthrough adds is on the page.
      await open(page, `#w=${walkthrough.id}&s=${walkthrough.steps.length}&c=1`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
      expect(errors).toEqual([]);
    });
  }
}

test('table rows and nested boxes keep their place as elements appear', async ({ page }) => {
  const places = (selector: string) =>
    page.locator(selector).evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const pane = node.closest('.fw-pane')!.getBoundingClientRect();
        return [
          node.getAttribute('data-entity'),
          Math.round(box.left - pane.left),
          Math.round(box.top - pane.top),
        ];
      }),
    );
  // The alarm is absent here and present later, in both the boxes and the table.
  await open(page, '#w=terraform-apply&s=2&c=1');
  await expect(page.locator('.fw-box[data-entity="alarm"]')).toHaveClass(/is-absent/);
  const boxes = await places('.fw-box');
  const rows = await places('.fw-table tbody tr');
  await page.goto('/#w=terraform-apply&s=3&c=5');
  await expect(page.locator('.fw-box[data-entity="alarm"]')).not.toHaveClass(/is-absent/);
  await expect(page.locator('.fw-table tr[data-entity="alarm"]')).toHaveClass(/is-added/);
  expect(await places('.fw-box')).toEqual(boxes);
  expect(await places('.fw-table tbody tr')).toEqual(rows);
});

test('the focus pane follows the call, and the code panel marks its lines', async ({ page }) => {
  await open(page, '#w=react-render&s=1&c=1');
  await expect(page.locator('.fw-pane[data-pane="source"]')).toBeVisible();
  await expect(page.locator('.fw-pane[data-pane="dom"]')).toHaveCount(0);
  await expect(page.locator('.fw-code-line.is-read')).toHaveCount(1);
  await expect(page.locator('.fw-code-line.is-read')).toContainText('onClick');

  await page.goto('/#w=react-render&s=4&c=1');
  await expect(page.locator('.fw-pane[data-pane="dom"]')).toBeVisible();
  await expect(page.locator('.fw-pane[data-pane="source"]')).toHaveCount(0);
  const cell = page.locator('.fw-table tr[data-entity="dom-badge"] td[data-column="text"]');
  await expect(cell).toHaveText('4');
  await expect(cell).toHaveClass(/is-cell-updated/);
  // One id, three panes: the same resource in the graph, the boxes and the table.
  await page.goto('/#w=terraform-apply&s=3&c=3');
  await page.locator('.fw-box[data-entity="instance"]').click();
  await expect(page.locator('.react-flow__node[data-id="instance"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.fw-table tr[data-entity="instance"]')).toHaveClass(/is-selected/);
});

test('the theme button overrides the system theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  await page.getByRole('button', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('a JSON config loaded with ?src= shows the same thing as the bundled one', async ({
  page,
}) => {
  const snapshot = async () => ({
    title: await page.locator('.fw-head h1').innerText(),
    card: await page.locator('.fw-card').innerText(),
    messages: await page
      .locator('.fw-seq-message')
      .evaluateAll((nodes) =>
        nodes.map(
          (node) => `${node.getAttribute('data-entity')}:${node.getAttribute('data-mark')}`,
        ),
      ),
    nodes: await page
      .locator('.react-flow__node')
      .evaluateAll((nodes) =>
        nodes.map(
          (node) => `${node.getAttribute('data-id')}:${node.className}:${node.textContent}`,
        ),
      ),
  });

  await open(page, '#w=oauth-pkce&s=4&c=3');
  const bundled = await snapshot();

  await page.route('**/demo.json', (route) => route.fulfill({ json: demos }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?src=demo.json#w=oauth-pkce&s=4&c=3');
  await expect(page.locator('.react-flow__node').first()).toBeAttached();
  expect(await snapshot()).toEqual(bundled);
  // Moving keeps the ?src= part of the address.
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\?src=demo\.json#w=oauth-pkce&s=4&c=4$/);
});

test('a config with problems lists each one with its path', async ({ page }) => {
  const broken = structuredClone(walkthroughs[0]!);
  broken.layout.panes[0]!.panel = 'hologram';
  broken.steps[0]!.calls[0]!.to = 'printer';
  await page.route('**/broken.json', (route) => route.fulfill({ json: broken }));
  await page.goto('/?src=broken.json');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This config has problems');
  await expect(page.getByText('layout.panes[0].panel')).toBeVisible();
  await expect(page.getByText('steps[0].calls[0].to')).toBeVisible();
  await expect(page.getByText(/Registered: "sequence", "graph"/)).toBeVisible();

  await page.route('**/missing.json', (route) => route.fulfill({ status: 404, body: 'no' }));
  await page.goto('/?src=missing.json');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'The config could not be loaded',
  );
});

test('the command line builds one HTML file that shows the config from disk', async ({
  page,
}, testInfo) => {
  const out = testInfo.outputPath('example.html');
  execFileSync(process.execPath, [
    'dist/cli/index.js',
    'build',
    'skills/feature-walkthrough/example.json',
    '-o',
    out,
  ]);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(out).href);
  await expect(page.locator('.fw-head h1')).toHaveText('Reading through a cache');
  await expect(page.locator('.fw-seq-message')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.fw-table tr.is-added')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the command line exits 1 and names the problem for a bad config', () => {
  const result = spawnSync(process.execPath, ['dist/cli/index.js', 'lint', 'package.json'], {
    encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('package.json: error');
});

test('git demo: a link in a payload selects the same commit in the graph, and raw text can be shown', async ({
  page,
}) => {
  await open(page, '#w=git-commit&s=3&c=4');
  const commit = page.locator('.fw-payload[data-entity="4fa6696"]');
  await expect(commit).toHaveAttribute('data-mark', 'added');
  await expect(commit.locator('[data-path="tree"]')).toHaveAttribute('data-mark', 'added');

  await commit.locator('[data-ref="fdc907b"]').click();
  await expect(page).toHaveURL(/sel=fdc907b/);
  await expect(page.locator('.fw-payload[data-entity="fdc907b"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.react-flow__node[data-id="fdc907b"]')).toHaveClass(/is-selected/);

  await commit.getByRole('button', { name: 'cat-file -p' }).click();
  await expect(commit.locator('.fw-payload-raw')).toContainText(
    'parent fdc907bdce78276fddffadd756241a26270afeea',
  );

  // The model pane marks the columns this call is about and draws its relations.
  await expect(page.locator('.fw-schema-column[data-entity="commit.parent"]')).toHaveAttribute(
    'data-mark',
    'read',
  );
  await expect(page.locator('.fw-schema-relation[data-entity="commit.parent:commit"]')).toHaveClass(
    /is-read/,
  );
});

test('the call list shows where the reader is and jumps to any call', async ({ page }) => {
  await open(page, '#w=git-commit&s=1&c=1');
  await expect(page.locator('.fw-where')).toContainText('Call 1 of 17');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');

  await page.locator('.fw-outline > summary').click();
  await expect(page.locator('.fw-outline-call')).toHaveCount(17);
  await page.locator('.fw-outline-call', { hasText: 'Write the commit' }).click();
  await expect(page).toHaveURL(/#w=git-commit&s=3&c=4$/);
  await expect(page.locator('.fw-where')).toContainText('Call 9 of 17 · Write the commit');
  await expect(page.locator('.fw-outline-list')).toBeHidden();
});

test('algorithm demos: the array shows pointers, the window and the code pointer', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // Round 2, the call that asks "which side is it on?": lo=5, hi=9, mid=7.
  await open(page, '#w=binary-search&s=3&c=4');
  await expect(page.locator('.fw-array-pointer[data-entity="lo"]')).toHaveAttribute(
    'aria-label',
    'pointer lo: index 5 (value 31)',
  );
  await expect(page.locator('.fw-array-cell[data-entity="items.7"]')).toHaveAttribute(
    'data-mark',
    'read',
  );
  // Everything left of lo is outside the window and dimmed; the window itself is not.
  await expect(page.locator('.fw-array-cell[data-entity="items.4"]')).toHaveAttribute(
    'data-dim',
    'true',
  );
  await expect(page.locator('.fw-array-cell[data-entity="items.6"]')).not.toHaveAttribute(
    'data-dim',
    /.*/,
  );
  await expect(page.locator('.fw-array-range[data-entity="window"]')).toHaveAttribute(
    'aria-label',
    'range window: indexes 5 to 9',
  );
  // The code panel points at line 9 and marks just the comparison inside it.
  await expect(page.locator('.fw-code-line[data-at]')).toHaveAttribute('data-line', '9');
  await expect(page.locator('.fw-code-expr')).toHaveText('items[mid] < target');

  // A cell can be chosen with the keyboard and the choice goes into the address.
  await page.locator('.fw-array-cell[data-entity="items.6"]').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/sel=items\.6/);
  await expect(page.locator('.fw-array-cell[data-entity="items.6"]')).toHaveClass(/is-selected/);

  // The last call of the miss: hi is one off the left end and the window is empty.
  await page.goto('/#w=binary-search-missing&s=5&c=2');
  await expect(page.locator('.fw-array-pointer[data-entity="hi"]')).toHaveAttribute(
    'data-off',
    'before',
  );
  await expect(page.locator('.fw-array-range[data-entity="window"]')).toHaveAttribute(
    'data-mark',
    'absent',
  );
  expect(errors).toEqual([]);
});

test('algorithm demos: a call stack, a queue and a table follow the code', async ({ page }) => {
  await open(page, '#w=quicksort&s=1&c=1');
  await expect(page.locator('.fw-box[data-entity="stack-0"]')).not.toHaveClass(/is-absent/);
  await expect(page.locator('.fw-box[data-entity="stack-1"]')).toHaveClass(/is-absent/);
  await page.goto('/#w=quicksort&s=16&c=2');
  await expect(page.locator('.fw-array-cell[data-tone="good"]')).toHaveCount(7);

  await page.goto('/#w=bfs&s=8&c=2');
  await expect(page.locator('.fw-array-cell:not(.is-absent)')).toHaveCount(6);
  await expect(page.locator('.react-flow__node.is-absent')).toHaveCount(0);

  await page.goto('/#w=edit-distance&s=6&c=1');
  await expect(page.locator('.fw-table tr[data-entity="dp-r4"] td[data-column="c4"]')).toHaveText(
    '2',
  );
});

test('code is coloured in both themes, and a marked expression is one box', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '#w=quicksort&s=4&c=5');
  const keyword = page.locator('.fw-code-line[data-line="10"] code span', { hasText: 'function' });
  const light = await keyword.evaluate((node) => getComputedStyle(node).color);
  await page.getByRole('button', { name: 'Dark theme' }).click();
  const dark = await keyword.evaluate((node) => getComputedStyle(node).color);
  expect(light).not.toBe(dark);
  // The colours differ from the plain text colour, so something was really coloured.
  const plain = await page
    .locator('.fw-code-number')
    .first()
    .evaluate((node) => getComputedStyle(node).color);
  expect(dark).not.toBe(plain);

  const marked = page.locator('.fw-code-line[data-mark] mark.fw-code-expr');
  await expect(marked).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('bus: a consumer group has offsets, lag and an owner, and an event can be chosen with the keyboard', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // c1 has committed offset 2 in p0, which has three events.
  await open(page, '#w=kafka-consumer-group&s=3&c=2');
  await expect(page.locator('.fw-bus-cursor[data-entity="billing-p0"]')).toHaveAttribute(
    'aria-label',
    /committed offset 2, end 3, lag 1, owner c1/,
  );
  // Events that are not published yet keep their slot but are not shown.
  await expect(page.locator('.fw-bus-event[data-entity="e5"]')).toHaveAttribute(
    'data-mark',
    'absent',
  );
  await expect(page.locator('.fw-bus-event[data-entity="e4"]')).toHaveAttribute(
    'aria-label',
    /delivered, offset 2/,
  );
  await page.locator('.fw-bus-event[data-entity="e4"]').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/sel=e4/);
  await expect(page.locator('.fw-bus-event[data-entity="e4"]')).toHaveClass(/is-selected/);

  // After the rebalance c2 owns p0 and the committed offset has not moved.
  await page.goto('/#w=kafka-consumer-group&s=6&c=1');
  await expect(page.locator('.fw-bus-cursor[data-entity="billing-p0"]')).toHaveAttribute(
    'aria-label',
    /committed offset 2, end 5, lag 3, owner c2/,
  );
  await expect(page.locator('.fw-bus-party[data-entity="c1"]')).toHaveAttribute(
    'aria-label',
    /stopped/,
  );
  expect(errors).toEqual([]);
});

test('bus: the panel shows which rules matched an event', async ({ page }) => {
  await open(page, '#w=eventbridge-routing&s=2&c=1');
  await expect(page.locator('.fw-bus-rule[data-entity="r-order"] .fw-bus-match')).toContainText(
    'matches OrderPlaced',
  );
  await expect(page.locator('.fw-bus-rule[data-entity="r-vip"] .fw-bus-match')).toContainText(
    'matches OrderPlaced',
  );
  await expect(page.locator('.fw-bus-rule[data-entity="r-refund"] .fw-bus-match')).toContainText(
    'no match',
  );
  // The same id in the bus and in the payload pane: choosing it in one selects it in the other.
  await page.locator('.fw-bus-event[data-entity="e1"]').click();
  await expect(page.locator('.fw-bus-event[data-entity="e1"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.fw-pane[data-panel="payload"] .is-selected').first()).toBeVisible();
});

test('timeline: now moves forward, the future is hidden, and a missed heartbeat shows', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // 20 s: eight seconds of silence, the limit (22 s) is still ahead.
  await open(page, '#w=temporal-heartbeat&s=3&c=2');
  await expect(page.locator('.fw-tl-now')).toHaveAttribute('aria-label', 'now: 20 s');
  await expect(page.locator('.fw-tl-limit[data-entity="hbt1"]')).toHaveAttribute(
    'data-status',
    'pending',
  );
  await expect(page.locator('.fw-tl-instant[data-entity="hb3"]')).toHaveAttribute(
    'data-mark',
    /^(?!absent)/,
  );
  await expect(page.locator('.fw-tl-instant[data-entity="hb4"]')).toHaveAttribute(
    'data-mark',
    'absent',
  );
  await expect(page.locator('.fw-tl-span[data-entity="a2"]')).toHaveAttribute(
    'data-mark',
    'absent',
  );

  // 22 s: the limit ran out.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.fw-tl-now')).toHaveAttribute('aria-label', 'now: 22 s');
  await expect(page.locator('.fw-tl-limit[data-entity="hbt1"]')).toHaveAttribute(
    'data-status',
    'missed',
  );
  await expect(page.locator('.fw-tl-instant[data-entity="timeout"]')).toHaveAttribute(
    'data-mark',
    'added',
  );

  // Attempt 2 completes: both of its limits held.
  await page.goto('/#w=temporal-heartbeat&s=5&c=3');
  await expect(page.locator('.fw-tl-limit[data-entity="hbt2"]')).toHaveAttribute(
    'data-status',
    'met',
  );

  // An instant can be chosen with the keyboard.
  await page.locator('.fw-tl-instant[data-entity="hb4"]').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/sel=hb4/);
  await expect(page.locator('.fw-tl-instant[data-entity="hb4"]')).toHaveClass(/is-selected/);
  expect(errors).toEqual([]);
});

test('timeline: a narrow screen scrolls the axis inside the pane, not the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '#w=temporal-heartbeat&s=5&c=3');
  const sizes = await page.locator('.fw-tl-scroll').evaluate((box) => ({
    inner: box.scrollWidth,
    outer: box.clientWidth,
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(sizes.inner).toBeGreaterThan(sizes.outer);
  expect(sizes.page).toBe(0);
});

// ---------------------------------------------------------------------------------------------
// Views: the grid shows every pane at once; the focus view puts the panes a call touches on a
// stage and lists the rest in a bar.
// ---------------------------------------------------------------------------------------------

const VIEW_KEY = 'feature-walkthrough:view';
const viewOf = (page: Page) => shell(page).getAttribute('data-view');
const pageHeight = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight);
const sideOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const callCount = async (page: Page) =>
  Number((await page.locator('.fw-where-count').textContent())!.match(/of (\d+)/)![1]);

test('the grid is the default and the view control switches to focus and back', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await open(page, '#w=git-commit&s=3&c=4');
  expect(await viewOf(page)).toBe('grid');
  await expect(page.locator('.fw-stage')).toHaveCount(0);
  const group = page.getByRole('group', { name: 'View' });
  await expect(group.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
  await expect(group.getByRole('button', { name: 'Focus' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  await group.getByRole('button', { name: 'Focus' }).click();
  expect(await viewOf(page)).toBe('focus');
  await expect(page.locator('.fw-stage')).toBeVisible();
  await expect(page.locator('.fw-rail-item')).not.toHaveCount(0);
  await expect(page).toHaveURL(/v=focus/);
  // The place is kept.
  expect(await position(page)).toBe('3.4');

  await group.getByRole('button', { name: 'Grid' }).click();
  expect(await viewOf(page)).toBe('grid');
  await expect(page.locator('.fw-stage')).toHaveCount(0);
  await expect(page).toHaveURL(/v=grid/);
  expect(await position(page)).toBe('3.4');
  expect(errors).toEqual([]);
});

test('the choice is remembered, an address can force a view, and the config can set a default', async ({
  page,
}) => {
  await open(page, '#w=bfs&s=2&c=4');
  await page.getByRole('button', { name: 'Focus' }).click();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), VIEW_KEY)).toBe('focus');

  // A new visit without a view in the address follows the reader's choice, on any walkthrough.
  await page.goto('/#w=quicksort&s=1&c=1');
  await page.reload();
  await expect(shell(page)).toBeVisible();
  expect(await viewOf(page)).toBe('focus');
  expect(await page.evaluate(() => window.location.hash)).not.toContain('v=');

  // The address wins over the stored choice, without overwriting it.
  await page.goto('/#w=quicksort&s=1&c=1&v=grid');
  await page.reload();
  expect(await viewOf(page)).toBe('grid');
  expect(await page.evaluate((key) => window.localStorage.getItem(key), VIEW_KEY)).toBe('focus');

  // Moving and switching walkthroughs keep the view named in the address.
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.location.hash)).toContain('v=grid');
  await page.locator('.fw-picker select').selectOption('binary-search');
  expect(await page.evaluate(() => window.location.hash)).toContain('v=grid');
  expect(await viewOf(page)).toBe('grid');

  // The author's default applies until the reader chooses.
  await page.evaluate((key) => window.localStorage.removeItem(key), VIEW_KEY);
  await openConfig(page, 'focus-default', withPanes('git-commit', 4, 'focus'));
  expect(await viewOf(page)).toBe('focus');
  await page.getByRole('button', { name: 'Grid' }).click();
  await page.reload();
  expect(await viewOf(page)).toBe('grid');
});

test('focus view on a desktop window: the page does not scroll and shows at most three panes', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConfig(page, 'eight', withPanes('git-commit', 8), '#v=focus');
  const total = await callCount(page);
  for (let index = 0; index < total; index += 1) {
    if (index > 0) await page.keyboard.press('ArrowRight');
    expect(await pageHeight(page)).toBeLessThanOrEqual(900);
    expect(await sideOverflow(page)).toBe(0);
    const staged = await page.locator('.fw-stage-pane').count();
    expect(staged).toBeGreaterThanOrEqual(2);
    expect(staged).toBeLessThanOrEqual(3);
    // Eight panes are listed, and every one the call touches is on stage or named in the bar.
    await expect(page.locator('.fw-rail-item')).toHaveCount(8);
    const rail = await page.locator('.fw-rail-item').evaluateAll((items) =>
      items.map((item) => ({
        touched: (item as HTMLElement).dataset.touched === 'true',
        onStage: (item as HTMLElement).dataset.onStage === 'true',
      })),
    );
    expect(rail.filter((item) => item.onStage).length).toBe(staged);
    if (rail.some((item) => item.touched && !item.onStage)) {
      await expect(page.locator('.fw-rail-note')).toContainText('Also touched');
    }
  }
  expect(errors).toEqual([]);
});

test('focus view with two panes: both stay on stage, side by side', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConfig(page, 'two', withPanes('oauth-pkce', 2), '#v=focus&s=2&c=1');
  await expect(page.locator('.fw-stage-pane')).toHaveCount(2);
  await expect(page.locator('.fw-rail-item')).toHaveCount(2);
  const [a, b] = await page
    .locator('.fw-stage-pane')
    .evaluateAll((list) => list.map((item) => item.getBoundingClientRect().toJSON() as DOMRect));
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  expect(a!.height).toBeGreaterThan(400);
  expect(await pageHeight(page)).toBeLessThanOrEqual(900);
});

test('focus view: the bar says what the call does to each pane, and a swap is marked and announced', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '#w=git-commit&s=1&c=1&v=focus');
  let swaps = 0;
  const total = await callCount(page);
  for (let index = 0; index < total; index += 1) {
    if (index > 0) await page.keyboard.press('ArrowRight');
    const swapped = page.locator('.fw-stage-pane[data-swapped="true"]');
    if ((await swapped.count()) === 0) {
      await expect(page.locator('.fw-tag.is-swapped')).toHaveCount(0);
      continue;
    }
    swaps += 1;
    const name = (await swapped.locator('.fw-pane-name').textContent())!;
    await expect(swapped.locator('.fw-tag.is-swapped')).toHaveText('Swapped in');
    await expect(page.locator('.fw-rail-new')).toHaveCount(1);
    await expect(page.locator('[aria-live="polite"]', { hasText: 'is now shown' })).toContainText(
      name,
    );
  }
  expect(swaps).toBeGreaterThan(0);

  // A touched pane says so in words, not only in colour.
  await page.goto('/#w=bfs&s=2&c=4&v=focus');
  await page.reload();
  await expect(page.locator('.fw-rail-item[data-touched="true"]').first()).toContainText(
    /\d+ (added|changed|read|removed)/,
  );
  await expect(page.locator('.fw-rail-item[data-touched="false"]').first()).toContainText(
    'not touched',
  );
});

test('focus view: a pane can be pinned from the bar, and following the call lets go of it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '#w=quicksort&s=2&c=3&v=focus');
  const off = page.locator('.fw-rail-item[data-on-stage="false"]');
  if ((await off.count()) === 0) {
    // Everything fits on this stage: nothing to pin.
    await expect(page.getByRole('button', { name: 'Follow the call' })).toHaveCount(0);
    return;
  }
  const id = (await off.first().getAttribute('data-pane'))!;
  const item = page.locator(`.fw-rail-item[data-pane="${id}"]`);
  await item.focus();
  await page.keyboard.press('Enter');
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  await expect(item).toHaveAttribute('data-on-stage', 'true');
  // The pin holds while the reader steps on, and the arrow keys still step from the bar.
  await page.keyboard.press('ArrowRight');
  expect(await position(page)).toBe('2.4');
  await expect(item).toHaveAttribute('data-on-stage', 'true');
  await page.getByRole('button', { name: 'Follow the call' }).click();
  await expect(item).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Follow the call' })).toHaveCount(0);
});

test('focus view at phone width: one pane at a time, the stage on the first screen, no sideways scroll', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '#w=git-commit&s=3&c=4&v=focus');
  expect(await sideOverflow(page)).toBe(0);
  await expect(page.locator('.fw-stage-pane')).toHaveCount(1);
  const stage = (await page.locator('.fw-stage').boundingBox())!;
  expect(stage.y + 250).toBeLessThan(844);
  // Much less page than the grid has at this width.
  const focusHeight = await pageHeight(page);
  await page.goto('/#w=git-commit&s=3&c=4&v=grid');
  await page.reload();
  expect(focusHeight).toBeLessThan((await pageHeight(page)) * 0.6);

  // The other panes are one tap away and each says what the call does to it.
  await page.goto('/#w=git-commit&s=3&c=4&v=focus');
  await page.reload();
  const items = page.locator('.fw-rail-item');
  expect(await items.count()).toBeGreaterThanOrEqual(3);
  const second = items.nth(1);
  await second.scrollIntoViewIfNeeded();
  await second.click();
  await expect(page.locator('.fw-stage-pane')).toHaveCount(1);
  await expect(page.locator('.fw-stage-pane')).toHaveAttribute(
    'data-pane',
    (await second.getAttribute('data-pane'))!,
  );
  // Every control is big enough to touch.
  for (const control of await page.locator('.fw-rail-item, .fw-view').all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(24);
  }
  expect(await sideOverflow(page)).toBe(0);

  // The other theme, and the next call.
  await page.getByRole('button', { name: /theme/ }).click();
  await page.keyboard.press('ArrowRight');
  expect(await sideOverflow(page)).toBe(0);
  expect(errors).toEqual([]);
});

for (const id of [
  'git-commit',
  'quicksort',
  'bfs',
  'react-render',
  'terraform-apply',
  'oauth-pkce',
]) {
  test(`focus view: every panel of ${id} fits its place on the stage`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, `#w=${id}&v=focus`);
    const total = await callCount(page);
    const sample = [...new Set([0, 1, 2, Math.floor(total / 2), total - 2, total - 1])].filter(
      (index) => index >= 0 && index < total,
    );
    let at = 0;
    for (const target of sample) {
      while (at < target) {
        await page.keyboard.press('ArrowRight');
        at += 1;
      }
      await page.waitForTimeout(150);
      const stage = (await page.locator('.fw-stage').boundingBox())!;
      for (const pane of await page.locator('.fw-stage-pane').all()) {
        const box = (await pane.boundingBox())!;
        expect(box.height).toBeGreaterThan(150);
        expect(box.y).toBeGreaterThanOrEqual(stage.y - 1);
        expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
        // A diagram has drawn at least one node inside its frame.
        const nodes = pane.locator('.react-flow__node:not(.is-absent)');
        if ((await nodes.count()) > 0) {
          const inside = await nodes.evaluateAll(
            (list, frame) =>
              list.some((node) => {
                const rect = node.getBoundingClientRect();
                return (
                  rect.width > 0 &&
                  rect.right > frame.x &&
                  rect.left < frame.x + frame.width &&
                  rect.bottom > frame.y &&
                  rect.top < frame.y + frame.height
                );
              }),
            box,
          );
          expect(inside).toBe(true);
        }
      }
    }
    expect(errors).toEqual([]);
  });
}

/** Every staged pane that has a marked element shows the first one inside its frame. */
async function expectMarkedItemsInView(page: Page): Promise<void> {
  await page.waitForTimeout(250);
  const hidden = await page.evaluate(() => {
    const marked =
      '[data-mark="added"],[data-mark="updated"],[data-mark="read"],[data-mark="removed"]';
    const problems: string[] = [];
    for (const pane of document.querySelectorAll<HTMLElement>('.fw-stage-pane')) {
      const target = pane.querySelector<HTMLElement>(marked);
      if (target === null) continue;
      const frame = pane.querySelector<HTMLElement>('.fw-pane-body')!.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const overlapY = Math.min(box.bottom, frame.bottom) - Math.max(box.top, frame.top);
      const overlapX = Math.min(box.right, frame.right) - Math.max(box.left, frame.left);
      if (overlapY < Math.min(box.height, 8) || overlapX < Math.min(box.width, 8)) {
        problems.push(`${pane.dataset.pane}: ${target.className}`);
      }
    }
    return problems;
  });
  expect(hidden).toEqual([]);
}

test('focus view: the marked items of every staged pane are in view, small or large, however the pane got its size', async ({
  page,
}) => {
  const links = [
    '#w=git-commit&s=3&c=4',
    '#w=terraform-apply&s=3&c=2',
    '#w=bfs&s=2&c=4',
    '#w=quicksort&s=5&c=3',
    '#w=react-render&s=2&c=2',
    '#w=kafka-broker-failure&s=3&c=1',
    '#w=aws-scp-inheritance&s=2&c=1',
  ];
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    for (const link of links) {
      await page.goto(`/${link}&v=focus`);
      await page.reload();
      await expect(page.locator('.fw-stage-pane').first()).toBeVisible();
      await expectMarkedItemsInView(page);
    }
  }

  // A window that is resized while the reader looks: the stage steps on to the next call.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#w=git-commit&s=3&c=4&v=focus');
  await page.reload();
  await expect(page.locator('.fw-stage-pane')).toHaveCount(3);
  for (const width of [1024, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expectMarkedItemsInView(page);
  }

  // A pane the reader pins is shown at the size of its place, with its marks in view.
  await page.goto('/#w=bfs&s=2&c=4&v=focus');
  await page.reload();
  const off = page.locator('.fw-rail-item[data-on-stage="false"]');
  if ((await off.count()) > 0) await off.first().click();
  await expectMarkedItemsInView(page);
});

test('code: a diff shows signs and both line numbers, and switches to the result', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await open(page, '#w=terraform-apply&s=1&c=1');
  const removed = page.locator('.fw-code-line[data-kind="del"]');
  const added = page.locator('.fw-code-line[data-kind="add"]');
  await expect(removed).toHaveCount(1);
  await expect(removed).toContainText('t3.micro');
  await expect(removed.locator('.fw-code-sign')).toContainText('−');
  await expect(added.first().locator('.fw-code-sign')).toContainText('+');
  // The removed line has an old number only, an added one a new number only.
  await expect(removed.locator('.fw-code-number.is-old')).toHaveText('2');
  await expect(removed.locator('.fw-code-number.is-new')).toHaveText('');
  // The call marks the removed line through "old" and its replacement through "lines".
  await expect(removed).toHaveAttribute('data-mark', 'updated');
  await expect(added.first()).toHaveAttribute('data-mark', 'updated');
  // Removed lines have syntax colours too.
  await expect(removed.locator('code span[style*="color"]').first()).toBeVisible();

  await page.getByRole('button', { name: 'Result', exact: true }).click();
  await expect(page.locator('.fw-code-line[data-kind]')).toHaveCount(0);
  await expect(page.locator('.fw-code-lines[data-view="result"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Result', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(removed).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('code: a transcript is revealed up to a line and scrolls to the newest one', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await open(page, '#w=terraform-apply&s=3&c=6');
  const terminal = page.locator('.fw-code-panel[data-source="session"]');
  const scroller = terminal.locator('.fw-code-scroll');
  const shown = terminal.locator('.fw-code-line:not(.is-hidden)');
  await expect(shown.last()).toContainText("Only 'yes'");
  const hidden = terminal.locator('.fw-code-line.is-hidden');
  expect(await hidden.count()).toBeGreaterThan(5);
  // Hidden lines are not offered to a screen reader, and the newest line is inside the pane.
  await expect(hidden.first()).toHaveAttribute('aria-hidden', 'true');
  const newest = await shown.last().boundingBox();
  const box = await scroller.boundingBox();
  expect(newest!.y + newest!.height).toBeLessThanOrEqual(box!.y + box!.height + 1);
  expect(newest!.y).toBeGreaterThanOrEqual(box!.y - 1);
  await expect(terminal.locator('.fw-code-line.is-command')).toHaveCount(1);
  // At the refresh call only the command and the refresh lines are revealed.
  await open(page, '#w=terraform-apply&s=2&c=2');
  await expect(
    page.locator('.fw-code-panel[data-source="session"] .fw-code-line:not(.is-hidden)'),
  ).toHaveCount(6);
  expect(errors).toEqual([]);
});

test('sequence: fragments, branches, styles and notes are drawn and reachable', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await open(page, '#w=oauth-pkce&s=4&c=6');
  const frame = page.locator('.fw-seq-frame[data-kind="alt"]');
  await expect(frame).toHaveCount(1);
  await expect(frame).toContainText('code_verifier matches');
  await expect(frame.locator('.fw-seq-divider')).toContainText('it does not match');
  // A reply is dashed; a call is not.
  const dash = (id: string) =>
    page
      .locator(`.fw-seq-message[data-entity="${id}"] .fw-seq-line`)
      .evaluate((node) => getComputedStyle(node).strokeDasharray);
  expect(await dash('token-response')).not.toBe('none');
  expect(await dash('token-error')).not.toBe('none');
  expect(await dash('verify')).toBe('none');
  // Messages stay where they were when later ones appear.
  const y = async (id: string) =>
    (await page.locator(`.fw-seq-message[data-entity="${id}"] .fw-seq-hit`).boundingBox())!.y;
  const before = await y('token-response');
  await page.keyboard.press('ArrowLeft');
  expect(await y('token-response')).toBe(before);
  await page.keyboard.press('ArrowRight');

  // The tab of a frame is a button: keyboard reachable, and selects the frame.
  const tab = frame.locator('.fw-seq-tab');
  await tab.focus();
  await page.keyboard.press('Enter');
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.fw-seq-message.is-related')).toHaveCount(3);
  await page.keyboard.press('Enter');
  await expect(tab).toHaveAttribute('aria-pressed', 'false');

  // A note appears with its message and is a button too.
  await open(page, '#w=oauth-pkce&s=1&c=3');
  const note = page.locator('.fw-seq-note');
  await expect(note.first()).toBeVisible();
  await note.first().focus();
  await page.keyboard.press('Enter');
  await expect(note.first()).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('sequence: a lost message ends in a cross, an async one has an open head, par and loop frames', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await open(page, '#w=retry-backoff&s=1&c=1');
  await expect(page.locator('.fw-seq-message[data-style="lost"] .fw-seq-cross')).toBeVisible();
  await expect(page.locator('.fw-seq-frame[data-kind="loop"]')).toBeVisible();
  await expect(page.locator('.fw-seq-frame[data-kind="par"]')).toHaveCount(0);
  await open(page, '#w=retry-backoff&s=2&c=4');
  await expect(page.locator('.fw-seq-frame[data-kind="par"]')).toBeVisible();
  await expect(
    page.locator('.fw-seq-message[data-style="async"] .fw-seq-head.is-open'),
  ).toBeVisible();
  await expect(page.locator('.fw-seq-message.is-self').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('code and sequence additions fit a phone in both views, with no sideways page scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const hash of [
    '#w=terraform-apply&s=1&c=1',
    '#w=terraform-apply&s=3&c=6',
    '#w=oauth-pkce&s=4&c=6',
    '#w=retry-backoff&s=2&c=4',
    '#w=git-commit&s=1&c=2',
  ]) {
    for (const view of ['grid', 'focus']) {
      await page.goto(`/${hash}&v=${view}`);
      await expect(page.locator('.fw-pane, .fw-stage-pane').first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${hash} ${view}`).toBeLessThanOrEqual(0);
    }
  }
});
test('table: legend tones, group headers, a meter and a marked column, with rows that keep their height', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await open(page, '#w=kafka-broker-failure&s=1&c=1');
  const table = page.locator('.fw-pane[data-panel="table"]');
  // Headers keep the case they were written in.
  await expect(table.locator('thead th').first()).toHaveText('Partition');
  // Two group headers span the table, and they are not elements.
  await expect(table.locator('tr.fw-table-group th')).toHaveText([
    'Topic orders',
    'Topic payments',
  ]);
  await expect(table.locator('tr.fw-table-group th').first()).toHaveAttribute('colspan', '6');
  // A cell whose text is a legend value has that tone, and the legend is under the table.
  await expect(table.locator('tr[data-entity="orders-0"] td[data-column="b1"]')).toHaveAttribute(
    'data-cell-tone',
    'good',
  );
  await expect(table.locator('.fw-table-legend li')).toHaveCount(4);
  // A meter shows the number and a warning past its threshold.
  const lag = (id: string) => table.locator(`tr[data-entity="${id}"] td[data-column="lag"]`);
  await expect(lag('orders-1')).toHaveAttribute('data-warn', 'true');
  await expect(lag('orders-0')).not.toHaveAttribute('data-warn', 'true');
  await expect(lag('orders-1').locator('[role="meter"]')).toHaveAttribute('aria-valuenow', '38');
  // The marked column: its header and cells, and the rows do not fade.
  await expect(table.locator('th[data-entity="col.b2"]')).toHaveAttribute('data-col-mark', 'read');
  await expect(table.locator('tr[data-entity="orders-0"] td[data-column="b2"]')).toHaveClass(
    /is-col-hit/,
  );
  await expect(table.locator('tr[data-entity="orders-0"]')).not.toHaveClass(/is-faded/);

  const heights = () =>
    table
      .locator('tbody tr')
      .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
  const before = await heights();
  for (let step = 1; step < 10; step += 1) await page.keyboard.press('ArrowRight');
  expect(await heights()).toEqual(before);
  // The column header is a selectable element: it selects across panes.
  await table.locator('th[data-entity="col.b2"]').click();
  await expect(page).toHaveURL(/sel=col\.b2/);
  expect(errors).toEqual([]);
});

test('tree: ancestors open for the call, the reader can close one, Up and Down move, and Right still steps the call', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // Sandbox is collapsed until a call touches something inside it.
  await open(page, '#w=aws-scp-inheritance&s=1&c=1');
  const tree = page.locator('.fw-pane[data-panel="tree"]');
  const row = (id: string) => tree.locator(`[role="treeitem"][data-entity="${id}"]`);
  await expect(row('ou-sandbox')).toHaveAttribute('aria-expanded', 'false');
  await expect(row('ou-sandbox').locator('.fw-tree-hidden')).toHaveText('4 hidden');
  await expect(row('acct-sandbox')).toHaveCount(0);

  await page.keyboard.press('ArrowRight');
  await expect(row('ou-sandbox')).toHaveAttribute('aria-expanded', 'true');
  await expect(row('acct-sandbox')).toHaveAttribute('data-mark', 'read');
  await expect(row('acct-sandbox')).toHaveAttribute('data-depth', '3');

  // Enter selects across panes.
  await row('acct-sandbox').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/sel=acct-sandbox/);

  // The reader closes Sandbox: it says it hides what the call touches.
  await row('ou-sandbox').locator('.fw-tree-twisty').click();
  await expect(row('ou-sandbox').locator('.fw-tree-hidden')).toContainText('1 touched');

  // Up and Down move between nodes; Left and Right are not taken by the tree.
  await row('root').focus();
  await page.keyboard.press('ArrowDown');
  await expect(row('p-root-full')).toBeFocused();
  await page.keyboard.press('End');
  await expect(row('acct-mgmt')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(row('root')).toBeFocused();
  expect(await position(page)).toBe('2.1');
  await page.keyboard.press('ArrowRight');
  expect(await position(page)).toBe('3.1');
  await page.keyboard.press('ArrowLeft');
  expect(await position(page)).toBe('2.1');
  // The move: the account is now one level up, and absent or closed nodes keep the rows they had.
  await page.goto('/#w=aws-scp-inheritance&s=5&c=1');
  await expect(row('acct-sandbox')).toHaveAttribute('data-depth', '2');
  await expect(row('ou-sandbox')).toHaveAttribute('aria-expanded', 'false');
});

// ---- the bytes panel ----

const field = (page: Page, id: string) => page.locator(`.fw-by-field[data-entity="${id}"]`);

test('bytes: a call marks fields, shows their words, and a straddling field is one field', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  // The SYN-ACK: sequence 300, acknowledgment 101, SYN and ACK set.
  await open(page, '#w=tcp-handshake&s=3&c=1');
  await expect(field(page, 'seg.seq').first()).toHaveAttribute('data-mark', 'updated');
  await expect(field(page, 'seg.seq').first().locator('.fw-by-select')).toHaveAttribute(
    'aria-label',
    /Sequence Number, bits 32–63, value 300/,
  );
  await expect(field(page, 'seg.ack')).toHaveAttribute('data-mark', 'updated');
  await expect(page.locator('.fw-by-note[data-field="seg.sport"]')).toContainText('bits 0–15');
  await expect(page.locator('.fw-by-more')).toContainText('more marked');

  // On a phone the 32-bit rows are drawn 16 to a row, so the sequence number is two pieces.
  await expect(page.locator('.fw-by-grid').first()).toHaveAttribute('data-width', '16');
  await expect(field(page, 'seg.seq')).toHaveCount(2);
  await expect(field(page, 'seg.seq').nth(1)).toHaveAttribute('data-part', '2/2');
  // Only the first piece can be reached with the keyboard.
  await expect(field(page, 'seg.seq').nth(1).locator('.fw-by-select')).toHaveAttribute(
    'tabindex',
    '-1',
  );
  // Choosing the second piece chooses the field: both pieces show it.
  await field(page, 'seg.seq').nth(1).locator('.fw-by-select').click();
  await expect(page).toHaveURL(/sel=seg\.seq/);
  await expect(field(page, 'seg.seq').first()).toHaveClass(/is-selected/);
  await expect(field(page, 'seg.seq').nth(1)).toHaveClass(/is-selected/);

  // No page-wide sideways scroll at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // A flag is reachable with the keyboard and chosen with Enter.
  await field(page, 'seg.syn').locator('.fw-by-select').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/sel=seg\.syn/);
  expect(errors).toEqual([]);
});

test('bytes: at desktop width the header keeps its 32-bit rows and nothing moves between calls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#w=tcp-handshake&s=2&c=1&v=focus');
  await expect(page.locator('.fw-by-grid').first()).toHaveAttribute('data-width', '32');
  await expect(field(page, 'seg.seq')).toHaveCount(1);

  const places = () =>
    page.locator('.fw-by-frame[data-entity="seg"] .fw-by-field').evaluateAll((nodes) => {
      const grid = nodes[0]!.closest('.fw-by-grid')!.getBoundingClientRect();
      return nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return [
          node.getAttribute('data-entity'),
          Math.round(box.left - grid.left),
          Math.round(box.top - grid.top),
        ];
      });
    });
  const before = await places();
  expect(before.length).toBeGreaterThan(10);
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('ArrowRight');
  expect(await places()).toEqual(before);
});

test('bytes: on the focus stage the panel fills its frame and scrolls inside it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#w=tcp-handshake&s=4&c=1&v=focus');
  const pane = page.locator('.fw-stage-pane[data-panel="bytes"]');
  await expect(pane).toBeVisible();
  const [root, frame] = await Promise.all([
    pane.locator('.fw-bytes').boundingBox(),
    pane.boundingBox(),
  ]);
  expect(root!.y + root!.height).toBeLessThanOrEqual(frame!.y + frame!.height + 1);
  // The frame the call adds is in view inside the scrolling root.
  const added = await pane.locator('.fw-by-frame[data-entity="last"]').boundingBox();
  expect(added!.y).toBeGreaterThanOrEqual(root!.y - 1);
  expect(added!.y).toBeLessThan(root!.y + root!.height);
});

test('bytes: a segment links to the decoded header in a payload pane', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '#w=jwe-compact&s=2&c=2');
  await expect(field(page, 'jwe.header')).toHaveAttribute('data-mark', 'updated');
  await expect(field(page, 'jwe.ekey').locator('.fw-by-value')).toHaveText(/^C39XATK/);
  // The cursor sits at the start of segment 2.
  await expect(page.locator('.fw-by-cursor[data-entity="jwe.cursor"]')).toHaveCount(1);
  await page.locator('.fw-by-link[data-ref="header"]').click();
  await expect(page).toHaveURL(/sel=header/);
  await expect(page.locator('.fw-payload[data-entity="header"]')).toHaveClass(/is-selected/);
  // And back: the payload's link selects the segment.
  await page.locator('.fw-pl-ref[data-ref="jwe.header"]').click();
  await expect(page).toHaveURL(/sel=jwe\.header/);
  await expect(field(page, 'jwe.header')).toHaveClass(/is-selected/);

  // The bytes frame appears with a gap for the long ciphertext and an ASCII gutter.
  await page.goto('/#w=jwe-compact&s=3&c=1');
  await page.reload();
  await expect(page.locator('.fw-by-frame[data-entity="raw"]')).toHaveAttribute(
    'data-mark',
    'added',
  );
  await expect(page.locator('.fw-by-field.is-gap')).toHaveCount(1);
  await expect(page.locator('.fw-by-ascii').first()).toBeVisible();
  expect(errors).toEqual([]);
});
