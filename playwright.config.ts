import { defineConfig } from '@playwright/test';

// Uses the installed Google Chrome. Without it, run `npx playwright install chromium`
// and remove the `channel` line.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5199',
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
  },
});
