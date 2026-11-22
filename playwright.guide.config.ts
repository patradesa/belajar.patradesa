import { defineConfig, devices } from '@playwright/test';

/**
 * Pembuatan aset panduan: tangkapan layar aplikasi (data FIKTIF, server lokal `wrangler dev`) lalu PDF A4.
 * Jalankan: `npm run guides` (Windows tanpa unduh browser: PW_CHANNEL=msedge).
 * Hasil: apps/web/public/panduan/img/*.jpg dan apps/web/public/panduan/*.pdf (di-commit).
 */
export default defineConfig({
  testDir: 'tests/guide',
  timeout: 300_000,
  workers: 1,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.PW_CHANNEL || undefined,
    baseURL: 'http://localhost:8787',
    locale: 'id-ID',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://localhost:8787/api/v1/health',
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
