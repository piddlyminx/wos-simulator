import { defineConfig, devices } from '@playwright/test';

// Use a non-standard port so the smoke harness never collides with other
// local Next.js / Node apps (e.g. Hermes Workspace on :3000).
const PORT = process.env.PORT ?? '3947';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  outputDir: './tmp/playwright',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Skip managed webServer when PLAYWRIGHT_BASE_URL is set (dev server already running).
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {}
    : {
        webServer: {
          // Keep Playwright's generated files independent from both the normal
          // developer server and production builds.
          command: `npm run dev:playwright -- -p ${PORT}`,
          wait: {
            stdout: /Local:\s+http:\/\/localhost:\d+/,
          },
          // Never reuse: a stale process on this port is more likely to be a
          // different app than a clean dashboard build.
          reuseExistingServer: false,
          timeout: 60_000,
        },
      }),
});
