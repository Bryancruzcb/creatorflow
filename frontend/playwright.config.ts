import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    // Build before serving. `vite preview` only serves whatever dist/ already holds, so without
    // this the suite silently grades a stale bundle. The specific trap: a dist/ built with
    // VITE_BASE_PATH=/creatorflow/ (the Pages shape, which is what CI and any local Pages-style
    // build produce) makes index.html request /creatorflow/assets/*, which 404s against this
    // root-based baseURL. The page renders blank and every test fails inside its first locator,
    // which reads as a selector regression rather than a stale build.
    command: 'npm run build && npm run preview -- --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
