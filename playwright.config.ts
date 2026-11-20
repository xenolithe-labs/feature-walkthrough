import { defineConfig, devices } from '@playwright/test';

// Another checkout may already be serving on the default port: set E2E_PORT to use a different one.
const port = Number(process.env.E2E_PORT ?? 4173);
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: origin },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build:all && pnpm preview --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: !process.env.CI,
  },
});
