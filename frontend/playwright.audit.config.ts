import { defineConfig } from '@playwright/test';

/**
 * Standing audits: type floor and accessible names.
 *
 * Separate from playwright.config.ts because these need two servers — the product build AND the
 * harness, which is the only way to reach the bridge-gated `.local-*` surfaces. Keeping them
 * apart also means `npm run test:e2e` stays a behaviour suite; these are quality gates and fail
 * for different reasons.
 */
export default defineConfig({
  testDir: './audit',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  use: { channel: 'chrome', headless: true, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'npm run build && npm run preview -- --port 4177 --strictPort',
      url: 'http://127.0.0.1:4177',
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'npm run harness',
      url: 'http://127.0.0.1:4176',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
