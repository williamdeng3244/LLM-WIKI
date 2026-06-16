import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. The app is ALREADY running (docker compose) at :3000, so there is
 * no `webServer` block — tests run against the live stack. Run via the official
 * Playwright docker image with --network host (the WSL2 host is missing chromium
 * system libs); see e2e/README.md.
 *
 * The backend is in stub auth mode, so a fresh browser auto-resolves the seeded
 * admin. Role-specific flows set localStorage (wiki:email / wiki:role) before
 * navigation via the loginAs helper (tests/_helpers.ts).
 *
 * workers=1 + fullyParallel=false on purpose: every test shares one live backend
 * DB, so we serialize to keep assertions deterministic (tests still use unique
 * page paths / users to avoid collisions).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    locale: 'en-US',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
