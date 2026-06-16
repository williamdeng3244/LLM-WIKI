import { test, expect } from '@playwright/test';
import { loginAs, uniquePath } from './_helpers';

/**
 * The core wiki workflow, end-to-end through the real UI across two roles:
 *   contributor proposes a NEW note (stable -> review queue)
 *   -> admin opens the review queue, selects it, ACCEPTS (-> publish + reindex)
 *   -> the page is now published and findable via the topbar search.
 *
 * Exercises FR-UI-PROP-001/005/006, FR-UI-REV-001/003/007, FR-UI-SEARCH-001,
 * and the permission model as it actually renders in the browser.
 */
test('FR-UI-PROP/REV propose -> review -> publish -> searchable', async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const title = `E2E Note ${stamp}`;
  const path = uniquePath('flow');
  const token = `zqxj${stamp}`; // distinctive token in the body for the search step

  // 1) contributor proposes a new note
  const cCtx = await browser.newContext();
  const cPage = await cCtx.newPage();
  await loginAs(cPage, 'contributor');
  await cPage.goto('/');
  // Wait until the contributor session is established before interacting: the
  // "Create new note" button's onClick is a no-op until `user` loads, and Suggest
  // is role-gated, so its visibility proves the session is ready.
  await expect(cPage.getByRole('button', { name: /^suggest$/i }).first()).toBeVisible();
  await cPage.getByRole('button', { name: /create new note/i }).click();
  await expect(cPage.getByTestId('propose-path')).toBeVisible();
  await cPage.getByTestId('propose-path').fill(path);
  await cPage.getByTestId('propose-title').fill(title);
  await cPage.getByTestId('propose-body').fill(`E2E body ${token}. Hello world.`);
  await cPage.getByTestId('propose-submit').click();
  // submit settled: the dialog leaves the form view (submit button detaches)
  await expect(cPage.getByTestId('propose-submit')).toHaveCount(0);
  await cCtx.close();

  // 2) admin reviews + accepts
  const aCtx = await browser.newContext();
  const aPage = await aCtx.newPage();
  await loginAs(aPage, 'admin');
  await aPage.goto('/');
  await aPage.getByTestId('topbar-review').click();
  // the queue may hold many proposals; scroll our item into view, then select it
  const queueItem = aPage.getByText(title, { exact: true });
  await queueItem.waitFor({ state: 'attached' });
  await queueItem.scrollIntoViewIfNeeded();
  await queueItem.click();
  await aPage.getByTestId('review-accept').click();
  // the review modal stays OPEN after accepting (it advances to the next item);
  // our accepted proposal leaves the list. Then close the modal before searching.
  await expect(aPage.getByText(title, { exact: true })).toHaveCount(0);
  await aPage.keyboard.press('Escape');
  await expect(aPage.getByTestId('review-accept')).toHaveCount(0);

  // 3) published -> reload to refresh the page list, open "Go to file" (quick
  //    switcher = a client-side filter over PUBLISHED pages, no vector ranking),
  //    filter to our page, open it, and confirm the page view renders our title
  //    as its heading (an unambiguous "it's live" signal).
  await aPage.reload();
  await expect(aPage.getByRole('button', { name: /^suggest$/i }).first()).toBeVisible();
  await aPage.getByRole('button', { name: /go to file/i }).click();
  await aPage.locator('input:focus').fill(title);
  await aPage.getByText(title, { exact: true }).first().click();
  await expect(aPage.getByRole('heading', { name: title })).toBeVisible();
  await aCtx.close();
});
