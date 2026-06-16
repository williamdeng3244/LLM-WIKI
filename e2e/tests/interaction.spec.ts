import { test, expect } from '@playwright/test';

/**
 * Interaction + resilience coverage the existing specs (shell / workflow /
 * history) don't exercise. Uses only selectors already proven in smoke.spec
 * (the i18n-stable brand text + the search placeholder) so it stays robust
 * across copy/layout changes.
 */

test('FR-UI search box accepts input without breaking the shell', async ({ page }) => {
  await page.goto('/');
  const search = page.getByPlaceholder(/search/i).first();
  await expect(search).toBeVisible();
  await search.fill('philosophy being motion');
  await expect(search).toHaveValue('philosophy being motion');
  // the shell stays intact — no crash / white screen from the input
  await expect(page.getByText('Enflame Wiki').first()).toBeVisible();
});

test('FR-UI the app shell survives a reload (no white screen)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Enflame Wiki').first()).toBeVisible();
  await page.reload();
  // after a hard reload the SPA re-boots and renders the shell again
  await expect(page.getByText('Enflame Wiki').first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByPlaceholder(/search/i).first()).toBeVisible();
});
