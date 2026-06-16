import { test, expect } from '@playwright/test';
import { loginAs } from './_helpers';

/**
 * Shell-level flows: role gating, theme + language toggles, and tabs. These use
 * only stable existing selectors (aria-label, role+text) — no app changes. Maps
 * to docs/srs/frontend-functional.md.
 */

test('FR-UI-SHELL-006 role gating: reader has no Suggest button; contributor does', async ({ page }) => {
  // reader
  await loginAs(page, 'reader');
  await page.goto('/');
  await expect(page.getByText('Enflame Wiki').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^suggest$/i })).toHaveCount(0);

  // contributor (fresh identity)
  await page.context().clearCookies();
  await loginAs(page, 'contributor');
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^suggest$/i }).first()).toBeVisible();
});

test('FR-UI-SHELL-002 theme toggle flips <html data-theme>', async ({ page }) => {
  await page.goto('/');
  // Hydration gate: the default stub session is admin, so Suggest renders once
  // the client user-fetch resolves = React has hydrated and onClick is attached.
  // Without this the toggle click can land before hydration and be a no-op (flaky).
  await expect(page.getByRole('button', { name: /^suggest$/i }).first()).toBeVisible();
  const html = page.locator('html');
  const before = await html.getAttribute('data-theme');
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(async () => {
    expect(await html.getAttribute('data-theme')).not.toBe(before);
  }).toPass();
  const after = await html.getAttribute('data-theme');
  expect([before, after].sort()).toEqual(['dark', 'light']);
});

test('FR-UI-SHELL-003 / FR-UI-I18N-001 language toggle flips <html lang>', async ({ page }) => {
  await page.goto('/');
  // Hydration gate (see FR-UI-SHELL-002): wait for Suggest so the toggle's
  // onClick is attached before we click — otherwise the click is a no-op (flaky).
  await expect(page.getByRole('button', { name: /^suggest$/i }).first()).toBeVisible();
  const html = page.locator('html');
  const before = await html.getAttribute('lang');
  await page.getByRole('button', { name: 'Toggle language' }).click();
  await expect(async () => {
    expect(await html.getAttribute('lang')).not.toBe(before);
  }).toPass();
  const after = await html.getAttribute('lang');
  // en <-> zh-Hans
  expect(new Set([before, after])).toEqual(new Set(['en', 'zh-Hans']));
});

test('FR-UI-TABS-001 + FR-UI-TABS-005 new tab opens the New-tab page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New tab' }).click();
  // The New-tab page shows its action list.
  await expect(page.getByText('Create new note')).toBeVisible();
  await expect(page.getByText('Go to file')).toBeVisible();
});

test('FR-UI-KEYS-001 next/prev tab shortcuts switch tabs (GAP-001 fixed)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Create new note')).toBeVisible();          // tab1 = new tab (active)
  // turn tab1 into a graph tab so the two tabs are distinguishable by content
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.getByText('Create new note')).toHaveCount(0);          // now showing the graph
  // open tab2 (a fresh new tab) -> active; NewTab content returns
  await page.getByRole('button', { name: 'New tab' }).click();
  await expect(page.getByText('Create new note')).toBeVisible();
  // prev tab -> back to the graph tab -> NewTab content gone
  await page.keyboard.press('Control+Shift+BracketLeft');
  await expect(page.getByText('Create new note')).toHaveCount(0);
  // next tab -> back to the new tab -> NewTab content visible again
  await page.keyboard.press('Control+Shift+BracketRight');
  await expect(page.getByText('Create new note')).toBeVisible();
});
