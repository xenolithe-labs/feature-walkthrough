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
    const places = () =>
      page
        .locator(
          '.react-flow__node, .fw-array-cell, .fw-array-index, .fw-bus-event, .fw-bus-offset, .fw-tl-instant, .fw-tl-tick',
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            if (node.classList.contains('react-flow__node')) {
              return [node.getAttribute('data-id'), (node as HTMLElement).style.transform];
            }
            const box = node.getBoundingClientRect();
            const pane = (
              node.closest('.fw-bus-grid, .fw-tl-inner') ?? node.closest('.fw-pane')!
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
    '#w=aws-vpc-request&s=2&c=1',
    '#w=aws-vpc-request&s=4&c=2',
    '#w=aws-vpc-request&s=5&c=2',
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

// Groups, boundaries, icons, moves and traffic in the diagram panels.
const awsHash = (step: number, call: number) => `#w=aws-vpc-request&s=${step}&c=${call}`;

/** Where each node is on the page (its transform), by id, for the nodes that are drawn. */
async function nodeBoxes(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.fw-pane[data-panel="graph"] .react-flow__node')].map(
        (element) => [
          element.getAttribute('data-id') ?? '',
          `${(element as HTMLElement).style.transform} ${(element as HTMLElement).style.width}`,
        ],
      ),
    ),
  );
}

test('aws-vpc-request: groups are containers, a boundary is drawn as one, icons are drawn', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await open(page, awsHash(2, 1));
  const graph = page.locator('.fw-pane[data-panel="graph"]');
  await expect(graph.locator('.fw-group')).toHaveCount(8);
  await expect(graph.locator('.fw-group[data-boundary]')).toHaveCount(1);
  await expect(graph.locator('.fw-group-tag')).toHaveText('boundary');
  expect(await graph.locator('svg.fw-icon').count()).toBeGreaterThan(10);
  // Every icon is one path and nothing else.
  expect(await graph.locator('svg.fw-icon > *:not(path)').count()).toBe(0);
  // A child is drawn inside its group: the group's box holds the node's box.
  const inside = await page.evaluate(() => {
    const box = (id: string) =>
      document
        .querySelector(`.fw-pane[data-panel="graph"] [data-id="${id}"]`)!
        .getBoundingClientRect();
    const [group, child] = [box('priv-a'), box('i-a1')];
    return (
      child.left >= group.left &&
      child.right <= group.right &&
      child.top >= group.top &&
      child.bottom <= group.bottom
    );
  });
  expect(inside).toBe(true);
  expect(errors).toEqual([]);
});

test('aws-vpc-request: no element moves from one call to the next', async ({ page }) => {
  await open(page, awsHash(1, 1));
  const first = await nodeBoxes(page);
  expect(Object.keys(first).length).toBe(20);
  // 14 calls: 13 steps forward.
  for (let i = 0; i < 13; i += 1) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(60);
    expect(await nodeBoxes(page)).toEqual(first);
  }
});

test('aws-vpc-request: an edge that crosses a boundary shows a gate and says so', async ({
  page,
}) => {
  await open(page, awsHash(1, 1));
  const graph = page.locator('.fw-pane[data-panel="graph"]');
  // The gate belongs to the edge, not to the call: it is there whenever the edge is.
  await expect(graph.locator('.fw-edge-gate')).toHaveCount(1);
  await expect(page.getByText('Crosses a boundary')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.fw-card-title')).toHaveText(/Open an HTTPS connection/);
  await expect(graph.locator('.fw-edge-gate[data-gate="vpc"]')).toHaveCount(1);
  await expect(graph.locator('.fw-edge-line[data-crosses="vpc"]')).toHaveCount(1);
  await expect(page.getByText('Crosses a boundary')).toBeVisible();
  await expect(page.getByText('HTTPS 443 crosses app-vpc')).toBeVisible();
});

test('aws-vpc-request: a group with something touched inside does not fade', async ({ page }) => {
  await open(page, awsHash(2, 1));
  const node = (id: string) =>
    page.locator(`.fw-pane[data-panel="graph"] .react-flow__node[data-id="${id}"]`);
  await expect(node('az-a')).not.toHaveClass(/is-faded/);
  await expect(node('pub-a')).not.toHaveClass(/is-faded/);
  await expect(node('vpc')).not.toHaveClass(/is-faded/);
  await expect(node('az-b')).toHaveClass(/is-faded/);
  await expect(node('data-a')).toHaveClass(/is-faded/);
});

test('aws-vpc-request: a read edge shows one dot, reversed for a reply, and none when still', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/${awsHash(1, 1)}`);
  await page.waitForSelector('.react-flow__node');
  const dot = page.locator('.fw-pane[data-panel="graph"] .fw-edge-dot');
  await expect(dot).toHaveCount(1);
  const path = async () => (await dot.locator('animateMotion').getAttribute('path')) ?? '';
  const ends = (d: string) => d.replace(/[ML]/g, ' ').trim().split(/\s+/);
  const forward = ends(await path());
  await page.keyboard.press('ArrowRight');
  await expect(dot).toHaveCount(1);
  expect(ends(await path())).toEqual([forward[1], forward[0]]);
  // The next call reads two edges: two dots, and the first one is gone.
  await page.keyboard.press('ArrowRight');
  await expect(dot).toHaveCount(2);
  // Going back to the reply plays it again.
  await page.keyboard.press('ArrowLeft');
  await expect(dot).toHaveCount(1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/${awsHash(1, 1)}`);
  await page.reload();
  await page.waitForSelector('.react-flow__node');
  await expect(page.locator('.fw-pane[data-panel="graph"] .react-flow__edge.is-read')).toHaveCount(
    1,
  );
  await expect(page.locator('.fw-edge-dot')).toHaveCount(0);
});

test('aws-vpc-request: a weight is the stroke width and an update changes it', async ({ page }) => {
  const weight = async (id: string) => {
    await page.waitForSelector(`[data-testid="rf__edge-${id}"] .fw-edge-line`);
    return page.evaluate(
      (edge) =>
        document
          .querySelector(`[data-testid="rf__edge-${edge}"] .fw-edge-line`)!
          .getAttribute('data-weight'),
      id,
    );
  };

  await open(page, awsHash(4, 1));
  expect(await weight('t-a1')).toBe('4');
  await page.goto(`/${awsHash(4, 2)}`);
  await page.reload();
  await page.waitForSelector('.react-flow__node');
  expect(await weight('t-a1')).toBe('2.5');
  const stroke = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector('[data-testid="rf__edge-t-a1"] .fw-edge-line')!)
        .strokeWidth,
  );
  // 2.5, and a pixel more while the call marks the edge.
  expect(parseFloat(stroke)).toBeCloseTo(3.5, 1);
});

test('a node that moves between parents leaves everything else where it is', async ({ page }) => {
  const config = {
    id: 'mover',
    title: 'Mover',
    layout: {
      panes: [
        {
          id: 'g',
          panel: 'graph',
          content: {
            initial: true,
            direction: 'RIGHT',
            nodes: [
              { id: 'a', label: 'Zone A' },
              { id: 'b', label: 'Zone B' },
              { id: 'other', label: 'Other', parent: 'b' },
              { id: 'pod', label: 'Pod', parent: 'a', parents: ['a', 'b'] },
            ],
            edges: [{ from: 'pod', to: 'other' }],
          },
        },
      ],
    },
    steps: [
      {
        id: 's',
        title: 'S',
        calls: [
          { id: 'one', label: 'Start', effects: { g: [{ read: 'pod' }] } },
          {
            id: 'two',
            label: 'Move',
            effects: { g: [{ update: 'pod', fields: { parent: 'b' } }] },
          },
          {
            id: 'three',
            label: 'Move back',
            effects: { g: [{ update: 'pod', fields: { parent: 'a' } }] },
          },
        ],
      },
    ],
  };
  await openConfig(page, 'mover', config);
  await page.waitForSelector('.react-flow__node');
  await page.waitForTimeout(300);
  const absolute = () =>
    page.evaluate(() =>
      Object.fromEntries(
        ['a', 'b', 'other', 'pod'].map((id) => {
          const r = document
            .querySelector(`.react-flow__node[data-id="${id}"]`)!
            .getBoundingClientRect();
          return [
            id,
            [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          ];
        }),
      ),
    );
  const start = await absolute();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const moved = await absolute();
  // The groups and the other node are exactly where they were; the pod is now inside b.
  for (const id of ['a', 'b', 'other']) expect(moved[id], id).toEqual(start[id]);
  expect(moved.pod).not.toEqual(start.pod);
  const pod = moved.pod!;
  const b = moved.b!;
  expect(pod[0]).toBeGreaterThanOrEqual(b[0]!);
  expect(pod[0]! + pod[2]!).toBeLessThanOrEqual(b[0]! + b[2]!);
  expect(pod[1]).toBeGreaterThanOrEqual(b[1]!);
  expect(pod[1]! + pod[3]!).toBeLessThanOrEqual(b[1]! + b[3]!);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  expect(await absolute()).toEqual(start);
});

test('aws-vpc-request: an edge inside a group and an empty group can be selected by clicking', async ({
  page,
}) => {
  await open(page, awsHash(3, 2));
  // Show the whole diagram, so that everything we click is in view.
  await page.locator('.fw-pane[data-panel="graph"] .react-flow__controls-fitview').click();
  await page.waitForTimeout(400);
  // The middle of the edge i-a1 to db, which runs inside the VPC and over two groups.
  const middle = await page.evaluate(() => {
    const line = document.querySelector(
      '[data-testid="rf__edge-q-a1"] .fw-edge-line',
    ) as SVGLineElement;
    const matrix = line.getScreenCTM()!;
    const [x, y] = [
      (line.x1.baseVal.value + line.x2.baseVal.value) / 2,
      (line.y1.baseVal.value + line.y2.baseVal.value) / 2,
    ];
    return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
  });
  await page.mouse.click(middle.x, middle.y);
  await expect(page).toHaveURL(/sel=q-a1/);
  // The empty inside of a group: the app subnet in us-east-1b holds nothing yet. Playwright
  // checks that the group itself receives the click, so a child or an edge over it would fail.
  const subnet = page.locator('.react-flow__node[data-id="priv-b"]');
  const size = (await subnet.boundingBox())!;
  await subnet.click({ position: { x: size.width / 2, y: size.height - 8 } });
  await expect(page).toHaveURL(/sel=priv-b/);
  // A node inside a group is still the thing clicked when it is clicked.
  await page.locator('.react-flow__node[data-id="i-a1"]').click();
  await expect(page).toHaveURL(/sel=i-a1/);
});
