import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the V1 daily-flow E2E suite.
 * Source-of-truth for the 5 flows: `docs/product/vision-v2-product-shape.md`.
 *
 * Dev server is assumed already running on http://localhost:3000.
 * If you want Playwright to start the server itself, uncomment the
 * `webServer` block below.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // serial — describe-mode LLM calls contend on the same DeepSeek key
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../test-results/daily-flows-html', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // webServer: {
  //   command: 'pnpm -F web dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: true,
  //   timeout: 120_000,
  // },
});
