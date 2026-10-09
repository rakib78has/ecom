import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against the *built* extension in a real Chromium.
 *
 * A Chrome extension cannot be loaded by an ordinary Playwright `page` test:
 * it needs a persistent context launched with --load-extension, which the
 * fixtures in tests/e2e/fixtures.ts set up. Tests here therefore import from
 * those fixtures rather than from '@playwright/test' directly.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // The extension is shared process-wide per worker, and several specs assert
  // on downloads landing in a single directory, so parallelism is off.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
