import { test, expect } from '@playwright/test';

/**
 * Harness smoke: proves the dockerized Playwright setup end-to-end — chromium
 * launches in the container, reaches the live app on :3000 (--network host),
 * and the app shell renders for a fresh context (stub mode auto-resolves the
 * seeded admin, so no explicit login is needed here).
 */
test('FR-UI-SHELL-001 app shell renders for a fresh stub session', async ({ page }) => {
  await page.goto('/');
  // Brand text is identical in EN and 中 (i18n topbar.brand = "Enflame Wiki").
  await expect(page.getByText('Enflame Wiki').first()).toBeVisible();
  // The topbar search box is present.
  await expect(page.getByPlaceholder(/search/i).first()).toBeVisible();
});
