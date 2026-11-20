import { expect, test, type Page } from '@playwright/test';
import { demos } from '../../src/walkthroughs';
import { position, shell, watchErrors } from './stress-helpers';

const walkthroughs = 'walkthroughs' in demos ? demos.walkthroughs : [demos];
const byId = (id: string) => walkthroughs.find((item) => item.id === id)!;

// Steps further apart than this are each animated; closer ones snap (see CALM_MS in the shell).
const CALM = 380;

async function open(
  page: Page,
  hash: string,
  media: 'no-preference' | 'reduce' = 'no-preference',
): Promise<void> {
  await page.emulateMedia({ reducedMotion: media });
  await page.goto(`/${hash}`);
  await expect(shell(page)).toBeVisible();
  await expect(page.locator('.fw-pane').first()).toBeVisible();
  await page.waitForFunction(
    () =>
      document.querySelector('.fw-pane[data-panel="graph"], .fw-pane[data-panel="flow"]') ===
        null || document.querySelector('.react-flow__node') !== null,
  );
}

/** Nothing the motion layer started is still running. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          !(
            animation.id === 'fw-slide' ||
            (animation as CSSAnimation).animationName?.startsWith('fw-') ||
            ['left', 'width'].includes((animation as CSSTransition).transitionProperty ?? '')
          ),
      ),
  );
}

/** How many animations or transitions the motion layer has running. */
async function activeMotion(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (a) =>
            a.id === 'fw-slide' ||
            /^fw-(a|b|fill)$/.test((a as CSSAnimation).animationName ?? '') ||
            ['left', 'width'].includes((a as CSSTransition).transitionProperty ?? ''),
        ).length,
  );
}

const moving = (page: Page) =>
  page.evaluate(() => document.querySelector('.fw')!.getAttribute('data-moving'));

/** Where everything with an identity sits, to the pixel, relative to the shell. */
async function layout(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const origin = document.querySelector('.fw')!.getBoundingClientRect();
    const nodes = document.querySelectorAll(
      '.fw-pane:not([data-panel="graph"]):not([data-panel="flow"]) :is([data-entity], .fw-meter-fill, .fw-tl-nowline)',
    );
    return [...nodes].map((node) => {
      const rect = node.getBoundingClientRect();
      const pane = node.closest('[data-pane]')?.getAttribute('data-pane');
      const id = node.getAttribute('data-entity') ?? node.className;
      return `${pane}/${id} ${Math.round(rect.left - origin.left)},${Math.round(rect.top - origin.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
    });
  });
}

async function leftovers(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.fw *')]
      .filter((node) => !node.closest('.react-flow'))
      .filter(
        (node) =>
          node.style.transform !== '' || node.style.translate !== '' || node.style.scale !== '',
      )
      .map((node) => node.className.toString()),
  );
}

const DEMOS = [
  'binary-search',
  'kafka-consumer-group',
  'temporal-heartbeat',
  'git-commit',
  'jwe-compact',
];

for (const id of DEMOS) {
  test(`${id}: with motion on, every call rests where it rests with motion off`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    const on = await (await browser.newContext()).newPage();
    const off = await (await browser.newContext()).newPage();
    for (const page of [on, off]) errors.push(...watchErrors(page));
    await Promise.all([open(on, `#w=${id}&m=1`), open(off, `#w=${id}`)]);
    expect(await on.locator('.fw').getAttribute('data-motion')).toBe('on');
    expect(await off.locator('.fw').getAttribute('data-motion')).toBe('off');

    const calls = byId(id).steps.flatMap((step) => step.calls).length;
    for (let index = 0; index < calls; index += 1) {
      if (index > 0) {
        await Promise.all([on.keyboard.press('ArrowRight'), off.keyboard.press('ArrowRight')]);
      }
      await settled(on);
      expect(await position(on)).toBe(await position(off));
      expect(await layout(on), `call ${await position(on)}`).toEqual(await layout(off));
      expect(await leftovers(on)).toEqual([]);
      await on.waitForTimeout(CALM);
    }
    // And back again, step for step with the page that has motion off.
    for (let index = calls - 2; index >= 0; index -= 1) {
      await Promise.all([on.keyboard.press('ArrowLeft'), off.keyboard.press('ArrowLeft')]);
      await settled(on);
      expect(await layout(on), `back to ${await position(on)}`).toEqual(await layout(off));
      expect(await leftovers(on)).toEqual([]);
      await on.waitForTimeout(CALM);
    }
    expect(errors).toEqual([]);
    await on.context().close();
    await off.context().close();
  });
}

test('pressing next five times quickly lands on the right call, with no transform left behind', async ({
  page,
}) => {
  await open(page, '#w=binary-search&m=1&s=2&c=1');
  expect(await position(page)).toBe('2.1');
  const flat = byId('binary-search').steps.flatMap((step, si) =>
    step.calls.map((call, ci) => ({ at: `${si + 1}.${ci + 1}`, label: call.label })),
  );
  const expected = flat[flat.findIndex((item) => item.at === '2.1') + 5]!;
  for (let press = 0; press < 5; press += 1) await page.keyboard.press('ArrowRight');
  expect(await position(page)).toBe(expected.at);
  await expect(page.locator('.fw-card-title')).toHaveText(expected.label);
  // Steps in a hurry snap: nothing was queued and nothing is still moving.
  expect(
    await page.evaluate(() => document.querySelector('.fw')!.hasAttribute('data-moving')),
  ).toBe(false);
  await settled(page);
  expect(
    await page.evaluate(() => document.getAnimations().filter((a) => a.id === 'fw-slide').length),
  ).toBe(0);
  expect(await leftovers(page)).toEqual([]);

  // The state is the state of that call: the same as a page that went straight there.
  const direct = await page.context().newPage();
  await direct.emulateMedia({ reducedMotion: 'no-preference' });
  const [step, call] = expected.at.split('.');
  await direct.goto(`/#w=binary-search&s=${step}&c=${call}`);
  await expect(shell(direct)).toBeVisible();
  expect(await layout(page)).toEqual(await layout(direct));
});

test('a step taken calmly starts a transition, and one taken in a hurry does not', async ({
  page,
}) => {
  await open(page, '#w=binary-search&m=1&s=2&c=1');
  await page.waitForTimeout(CALM);
  await page.keyboard.press('ArrowRight');
  expect(await moving(page)).toMatch(/^[ab]$/);
  await page.keyboard.press('ArrowRight');
  expect(await moving(page)).toBeNull();
  // Jumping to a call far away is not "what changed", so it just appears.
  await page.waitForTimeout(CALM);
  await page.getByRole('button', { name: /^Call 1:/ }).click();
  expect(await moving(page)).toBeNull();
});

test('the address, then the reader, then the author decide whether motion is on', async ({
  page,
}) => {
  const motion = () => page.locator('.fw').getAttribute('data-motion');
  await open(page, '#w=binary-search');
  expect(await motion()).toBe('off');
  const toggle = page.getByRole('button', { name: /^Motion/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  // The reader turns it on: it is remembered, and the address stays out of it.
  await toggle.click();
  expect(await motion()).toBe('on');
  expect(page.url()).not.toContain('m=');
  await page.reload();
  expect(await motion()).toBe('on');

  // The address wins over what the reader chose, and m=0 also takes Play away.
  await open(page, '#w=binary-search&m=0');
  expect(await motion()).toBe('off');
  await expect(toggle).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);

  // A reader who turns off what a link turned on is believed, and the link stops saying so.
  await open(page, '#w=binary-search&m=1');
  expect(await motion()).toBe('on');
  await toggle.click();
  expect(await motion()).toBe('off');
  expect(page.url()).not.toContain('m=');

  // The address is kept while stepping.
  await open(page, '#w=binary-search&m=1');
  await page.keyboard.press('ArrowRight');
  expect(page.url()).toContain('m=1');
});

test('reduced motion turns every transition off, and Play still steps', async ({ page }) => {
  await open(page, '#w=binary-search&m=1&s=2&c=1', 'reduce');
  expect(await page.locator('.fw').getAttribute('data-motion')).toBe('off');
  await expect(page.getByRole('button', { name: /^Motion/ })).toBeDisabled();
  // A calm step, which with motion on would start a transition.
  await page.waitForTimeout(CALM);
  await page.keyboard.press('ArrowRight');
  expect(await activeMotion(page)).toBe(0);
  expect(await moving(page)).toBeNull();
  await page.getByLabel('Play speed').selectOption('faster');
  const before = await position(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  expect(await activeMotion(page)).toBe(0);
  await expect.poll(() => position(page), { timeout: 12_000 }).not.toBe(before);
  expect(await activeMotion(page)).toBe(0);
  expect(await moving(page)).toBeNull();
});

/** The first call, or the one a few before the end. */
function near(id: string, fromEnd: number): { hash: string; last: string } {
  const steps = byId(id).steps;
  const flat = steps.flatMap((step, s) => step.calls.map((_, c) => `${s + 1}.${c + 1}`));
  const at = flat[Math.max(flat.length - 1 - fromEnd, 0)]!.split('.');
  return { hash: `#w=${id}&s=${at[0]}&c=${at[1]}`, last: flat.at(-1)! };
}

test('Play steps on its own, stops at the last call, and says only that it started and stopped', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { hash, last } = near('binary-search', 2);
  await open(page, hash);
  await page.getByLabel('Play speed').selectOption('faster');
  const play = page.getByRole('button', { name: /^(Play|Pause)$/ });
  const status = page.locator('.fw-play [role="status"]');
  const before = await position(page);
  await play.click();
  await expect(play).toHaveText('Pause');
  await expect(status).toHaveText('Playback started');
  await expect.poll(() => position(page), { timeout: 12_000 }).not.toBe(before);
  await expect.poll(() => position(page), { timeout: 20_000 }).toBe(last);
  await expect(play).toHaveText('Play');
  await expect(status).toHaveText('Playback stopped');
  await page.mouse.move(1, 1);
  await page.waitForTimeout(2500);
  expect(await position(page)).toBe(last);
  // Pressed again at the end, it starts from the top.
  await play.click();
  await expect.poll(() => position(page), { timeout: 12_000 }).not.toBe(last);
});

test('any key stops Play, Space starts and stops it, and a hidden tab stops it', async ({
  page,
}) => {
  await open(page, '#w=binary-search');
  await page.getByLabel('Play speed').selectOption('faster');
  const play = page.getByRole('button', { name: /^(Play|Pause)$/ });
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('Space');
  await expect(play).toHaveText('Pause');
  await page.keyboard.press('x');
  await expect(play).toHaveText('Play');
  const held = await position(page);
  await page.waitForTimeout(2300);
  expect(await position(page)).toBe(held);

  await page.keyboard.press('Space');
  await expect(play).toHaveText('Pause');
  await page.keyboard.press('Space');
  await expect(play).toHaveText('Play');

  // In a control, Space does what the control does and Play does not start.
  await page.getByRole('button', { name: 'Next call' }).focus();
  await page.keyboard.press('Space');
  await expect(play).toHaveText('Play');

  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('Space');
  await expect(play).toHaveText('Pause');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(play).toHaveText('Play');
});

test('a key pressed after clicking Play stops it, and choosing a speed does not', async ({
  page,
}) => {
  await open(page, '#w=binary-search');
  const play = page.getByRole('button', { name: /^(Play|Pause)$/ });
  await play.click();
  await expect(play).toHaveText('Pause');
  // Focus is now on the button, as it is in a browser after a click.
  await page.getByLabel('Play speed').selectOption('slower');
  await expect(play).toHaveText('Pause');
  await play.focus();
  await page.keyboard.press('ArrowRight');
  await expect(play).toHaveText('Play');
  expect(await position(page)).toBe('1.2');
  // The arrow keys that step the walkthrough stop it from anywhere on the page.
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('Space');
  await expect(play).toHaveText('Pause');
  await page.keyboard.press('ArrowLeft');
  await expect(play).toHaveText('Play');
});

test('Play waits while the pointer is in the card or the panes', async ({ page }) => {
  await open(page, '#w=binary-search');
  await page.getByLabel('Play speed').selectOption('faster');
  const before = await position(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.locator('.fw-card').hover();
  await page.waitForTimeout(5000);
  expect(await position(page)).toBe(before);
  await page.mouse.move(1, 1);
  await expect.poll(() => position(page), { timeout: 12_000 }).not.toBe(before);
});

test('with motion off the diagram panels do not glide, fade or send dots; with it on they may', async ({
  page,
}) => {
  const dot = page.locator('.fw-pane[data-panel="graph"] .fw-edge-dot');
  await open(page, '#w=aws-vpc-request&s=1&c=1&m=0');
  await expect(dot.first()).toBeAttached();
  expect(await dot.first().evaluate((node) => getComputedStyle(node).display)).toBe('none');
  await open(page, '#w=aws-vpc-request&s=1&c=1&m=1');
  await expect(dot.first()).toBeAttached();
  expect(await dot.first().evaluate((node) => getComputedStyle(node).display)).not.toBe('none');
});
