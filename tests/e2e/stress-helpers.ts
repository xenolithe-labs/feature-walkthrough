import { expect, type Page, type TestInfo } from '@playwright/test';

/** Collects page errors and console errors from the moment it is called. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

export const shell = (page: Page) => page.locator('.fw[data-walkthrough]');

export async function position(page: Page): Promise<string> {
  const root = shell(page);
  return `${await root.getAttribute('data-step')}.${await root.getAttribute('data-call')}`;
}

/** Serves `config` as /<name>.json and opens the viewer on it. Resolves when the shell is up. */
export async function openConfig(
  page: Page,
  name: string,
  config: unknown,
  hash = '',
): Promise<{ ms: number }> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(`**/${name}.json`, (route) => route.fulfill({ json: config as object }));
  const started = Date.now();
  await page.goto(`/?src=${name}.json${hash}`);
  await expect(shell(page)).toBeVisible({ timeout: 60_000 });
  return { ms: Date.now() - started };
}

/** Serves `config` as /<name>.json and navigates to it without waiting for anything to show. */
export async function openRaw(page: Page, name: string, config: unknown): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(`**/${name}.json`, (route) => route.fulfill({ json: config as object }));
  await page.goto(`/?src=${name}.json`);
}

/** Records a measured number in the test report and on the console. */
export function report(testInfo: TestInfo, label: string, value: number, unit = 'ms'): void {
  testInfo.annotations.push({
    type: 'perf',
    description: `${label}: ${Math.round(value)} ${unit}`,
  });
  console.info(`[stress] ${label}: ${Math.round(value)} ${unit}`);
}

export async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/**
 * Presses a key `count` times, waiting each time for the cursor to move and the next frame to
 * paint, and returns the mean and the worst time per press in milliseconds.
 */
export async function stepTimes(
  page: Page,
  key: 'ArrowRight' | 'ArrowLeft',
  count: number,
): Promise<{ mean: number; worst: number }> {
  let total = 0;
  let worst = 0;
  for (let i = 0; i < count; i += 1) {
    const before = await position(page);
    const started = Date.now();
    await page.keyboard.press(key);
    await page.waitForFunction(
      (prev) => {
        const root = document.querySelector('.fw[data-walkthrough]') as HTMLElement | null;
        return root !== null && `${root.dataset.step}.${root.dataset.call}` !== prev;
      },
      before,
      { timeout: 30_000 },
    );
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
    const took = Date.now() - started;
    total += took;
    worst = Math.max(worst, took);
  }
  return { mean: total / count, worst };
}
