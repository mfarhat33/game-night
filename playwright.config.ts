import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const PORT = Number(process.env.E2E_PORT ?? 8799);
// Use a pre-installed Chromium when there is one (sandboxes); CI installs its own with `playwright install`.
const LOCAL_CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
// BASE_URL points the tests at a deployed site (the live smoke); then no local server is started.
const BASE_URL = process.env.BASE_URL;

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL ?? `http://127.0.0.1:${PORT}`,
    viewport: { width: 390, height: 800 },
    trace: 'retain-on-failure',
    launchOptions: existsSync(LOCAL_CHROMIUM) ? { executablePath: LOCAL_CHROMIUM } : {},
  },
  webServer: BASE_URL
    ? undefined
    : {
        // `npm run e2e` builds first; wrangler dev runs the Worker and Durable Objects locally.
        command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --persist-to .wrangler/e2e-state`,
        url: `http://127.0.0.1:${PORT}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { WRANGLER_SEND_METRICS: 'false' },
      },
});
