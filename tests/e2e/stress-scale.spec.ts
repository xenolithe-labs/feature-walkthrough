/**
 * Heavy configs in the real viewer. Timings are measured in a production build in headless
 * Chromium; the budgets are several times what a laptop needs, so they catch a regression
 * (a layout that stops finishing, a render that goes quadratic) without flaking.
 */
import { expect, test } from '@playwright/test';
import { longWalkthrough } from '../stress/gen';
import { openConfig, position, report, shell, stepTimes, watchErrors } from './stress-helpers';

// Tests in a file run one after another; the budgets leave room for other files running beside them.
test.describe.configure({ mode: 'default' });
test.setTimeout(180_000);

test('a walkthrough of 300 steps and 2,400 calls loads, steps and jumps', async ({
  page,
}, testInfo) => {
  const errors = watchErrors(page);
  const { ms } = await openConfig(page, 'long', longWalkthrough(300, 8));
  report(testInfo, 'load 300 steps / 2,400 calls', ms);
  expect(ms).toBeLessThan(30_000);
  await expect(page.locator('.fw-steps li')).toHaveCount(300);
  await expect(page.locator('.fw-seq-message')).toHaveCount(1);

  const forward = await stepTimes(page, 'ArrowRight', 40);
  report(testInfo, 'mean per call, 2,400-message sequence', forward.mean);
  report(testInfo, 'worst per call, 2,400-message sequence', forward.worst);
  expect(forward.mean).toBeLessThan(1500);

  // Jump to the end: every message of the walkthrough is on the page at once.
  const jumpStarted = Date.now();
  await page.goto('/?src=long.json#w=long&s=300&c=8');
  await expect(shell(page)).toHaveAttribute('data-step', '300');
  await expect(page.locator('.fw-seq-message')).toHaveCount(2400);
  report(testInfo, 'jump to the last call, 2,400 messages drawn', Date.now() - jumpStarted);
  expect(Date.now() - jumpStarted).toBeLessThan(30_000);

  const backward = await stepTimes(page, 'ArrowLeft', 20);
  report(testInfo, 'mean per call going back, 2,400 messages drawn', backward.mean);
  expect(backward.mean).toBeLessThan(2500);
  expect(await position(page)).toBe('298.4');
  expect(errors).toEqual([]);
});
