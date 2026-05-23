import { defineConfig, devices } from '@playwright/test';

/**
 * iter-012 Pass #6 — Playwright config for the onboarding wizard e2e.
 *
 * Mirrors `tests/e2e/daily-flows/playwright.config.ts` shape. Dev server
 * is assumed already running on http://localhost:3000.
 *
 * Run:
 *   HOLON_OAUTH_TEST_MODE=true pnpm -F web dev    # shell 1
 *   pnpm playwright test \                        # shell 2
 *     --config=tests/e2e/onboarding/playwright.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../test-results/onboarding-html', open: 'never' }],
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
});
