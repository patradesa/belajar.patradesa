import { defineConfig, devices } from '@playwright/test';

/**
 * E2E terhadap runtime Workers asli (`wrangler dev` + D1 lokal).
 * Lokal di Windows tanpa unduh browser: PW_CHANNEL=msedge. CI: `npx playwright install chromium`.
 */
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:8787',
    trace: 'retain-on-failure',
    locale: 'id-ID',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], channel, viewport: { width: 360, height: 780 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel }, testMatch: /a11y\.spec\.ts/ },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://localhost:8787/api/v1/health',
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
