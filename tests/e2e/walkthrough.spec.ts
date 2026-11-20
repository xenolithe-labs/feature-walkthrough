import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { demos } from '../../src/walkthroughs';

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
  await expect(page.locator('.react-flow__node').first()).toBeAttached();
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
    const places = () =>
      page
        .locator('.react-flow__node')
        .evaluateAll((nodes) =>
          nodes.map((node) => [
            node.getAttribute('data-id'),
            (node as HTMLElement).style.transform,
          ]),
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
