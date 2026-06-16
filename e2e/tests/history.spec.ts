import { test, expect, request } from '@playwright/test';
import { loginAs, uniquePath } from './_helpers';

/**
 * Version diff + Restore — GAP-002 / GAP-004 (FR-REV-011), end-to-end through
 * the UI. We seed an OPEN page with two published versions via the API (fast
 * and deterministic), then drive the browser: open Version history, expand the
 * old version to see its diff against current, and Restore it. On an open page
 * the restore republishes immediately, so the live page flips back to v1.
 */
const API = 'http://localhost:8000';

test('FR-REV-011 version history shows a diff and restores an old version', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const v1Title = `Hist v1 ${stamp}`;
  const v2Title = `Hist v2 ${stamp}`;
  const v1Token = `alphatoken${stamp}`;
  const v2Token = `betatoken${stamp}`;
  const path = uniquePath('hist');

  // --- seed: open page, v1 then v2, both auto-published ---
  const adminEmail = `e2e-admin-${stamp}@example.com`;
  const ctx = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { 'X-User-Email': adminEmail, 'X-User-Role': 'admin' },
  });
  const r1 = await ctx.post('/api/pages/draft', {
    data: { title: v1Title, body: `${v1Token} first version`, tags: [], new_page: { path, stability: 'open' } },
  });
  expect(r1.ok()).toBeTruthy();
  await ctx.post(`/api/revisions/${(await r1.json()).id}/submit`);
  const r2 = await ctx.post('/api/pages/draft', {
    data: { title: v2Title, body: `${v2Token} second version`, tags: [], page_path: path },
  });
  expect(r2.ok()).toBeTruthy();
  await ctx.post(`/api/revisions/${(await r2.json()).id}/submit`);
  await ctx.dispose();

  // --- drive the UI as admin ---
  await loginAs(page, 'admin', adminEmail);
  await page.goto('/');

  // open the page via the quick switcher (client-side filter over published pages)
  await page.getByRole('button', { name: /go to file/i }).click();
  await page.locator('input:focus').fill(v2Title);
  await page.getByText(v2Title, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: v2Title })).toBeVisible();
  await expect(page.getByText(v2Token)).toBeVisible();          // currently serving v2

  // open Version history
  await page.getByTitle('Open version history').click();
  await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();

  // expand the OLD version (v1) -> its diff against current renders
  await page.getByText(v1Title, { exact: true }).click();
  await expect(page.getByText('Changes from this version → current')).toBeVisible();

  // restore it -> open page republishes immediately
  await page.getByTestId('history-restore').click();
  await expect(page.getByText(/this version is now live/i)).toBeVisible();

  // close the modal; the page now serves v1's content again
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: v1Title })).toBeVisible();
  await expect(page.getByText(v1Token)).toBeVisible();
});
