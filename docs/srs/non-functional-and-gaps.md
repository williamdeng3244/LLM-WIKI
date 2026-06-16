# Non-Functional Requirements, Known Gaps & QA Runbook

Conventions in [`README.md`](README.md). This file holds testable NFRs, the
**known gaps** QA must assert as no-ops (so the suite tracks them instead of
failing against phantom features), test-id recommendations, and the runbook.

---

## NFR-SEC — Security (testable guarantees)

- **NFR-SEC-001** — Every `/api/*` endpoint rejects an unauthenticated request with **401** and an inactive user with **403**. [API]
- **NFR-SEC-002** — Role gates are enforced **server-side**, not only hidden in the UI: e.g. a `reader` calling `POST /api/pages/draft`, a `contributor` calling `PATCH …/path`, a non-admin calling `DELETE /api/pages/{path}` / `/lock` / `/api/users/{id}/role` / `/api/admin/*` all get **403** regardless of any client state. [API]
- **NFR-SEC-003** — Artifact viewer leaks nothing: missing/deleted/expired/over-private all return the **same generic 404**; unauthenticated non-public → 302 to login (FR-ART-005). [API]
- **NFR-SEC-004** — HTML artifact iframe sandbox is **exactly** `allow-scripts allow-popups allow-forms` (no `allow-same-origin`), with the documented CSP + `X-Frame-Options`/`Referrer-Policy`/`Cache-Control` headers (FR-ART-006). [API]
- **NFR-SEC-005** — URL ingest blocks SSRF: private/loopback/link-local/reserved/multicast resolved IPs → **403** (unless `URL_INGEST_ALLOW_PRIVATE=true`); only http/https; only the 4 allowed content types. NOTE the documented limitation: the check is one-shot (no DNS-rebinding protection). [API-mocked][unit]
- **NFR-SEC-006** — Raw-source storage is path-traversal-safe (server-generated UUID filename; `original_filename` never used as a path). Artifact bundles serve only exact archive members. [unit][API]
- **NFR-SEC-007** — Secrets are never echoed: MCP/API tokens are stored only as SHA-256 hashes; the raw token is shown exactly once on create. OIDC delivers the JWT via URL fragment (kept out of logs/referer). [API]
- **NFR-SEC-008** — Body-size caps enforced server-side: artifacts **413** over `ARTIFACTS_MAX_BODY_BYTES` (10 MiB); raw upload/URL **413** over 50 MB; preferences **413** over 64 KB. [API]
- **NFR-SEC-009** — OIDC callback enforces state (CSRF) + nonce (replay) checks (FR-AUTH-012). [API-mocked]

## NFR-PERF — Performance / responsiveness (observable, not load-tested here)

- **NFR-PERF-001** — Topbar search input is debounced ~220ms before hitting `/api/search`. [E2E]
- **NFR-PERF-002** — Polling intervals are bounded and only active when relevant: sources 2500ms (while ingesting), source history 4000ms, ingest preview 1500ms (planning/applying), lint 2500ms (while planning), review/notifications 30s. [E2E-mock]
- **NFR-PERF-003** — The ingest stale-run watchdog auto-fails runs idle > 45 min on next read (no orphan "planning" runs). [API]
- **NFR-PERF-004** — Graph physics reheat is throttled (<=1 per 150ms) and visual-only changes don't trigger relayout. [component]
- **NFR-PERF-005** — Pre-paint theme script prevents a flash of the wrong theme on load. [E2E]

## NFR-PERSIST — Client persistence (state survives reload)

- **NFR-PERSIST-001** — These localStorage keys persist and rehydrate correctly across reload: `wiki:tabs`, `wiki:tree-width`, `wiki:tree-sort`, `wiki:chat-collapsed`, `wiki:chat-mode`, `wiki:recent-paths`, `wiki:releases:v1`, `wiki:graph-settings:v2`, `wiki:theme`, `wiki:theme-id`, `wiki:lang`, custom folders + folder order, and auth keys `wiki:jwt`/`wiki:email`/`wiki:role`/`wiki:signed-out`. Corrupt `wiki:tabs` recovers to a single new tab. [component][E2E]
- **NFR-PERSIST-002** — Account-synced (server) preferences: appearance (theme id + mode) and hotkeys ride `user.preferences` and restore on login from a different device. Graph settings are **localStorage-only** (not synced) — assert this distinction. [E2E]

## NFR-I18N — Internationalization

- **NFR-I18N-001** — Toggling EN/中 flips every string on the main app, /help, and /artifacts, sharing `wiki:lang`. [E2E]
- **NFR-I18N-002** — Known partial coverage (assert as documented, not as a bug-to-fail): `IngestPlanPreview` copy is hardcoded English; the `/artifacts` page uses its own STR table (still keyed off lang). A "every string flips" sweep must whitelist these. [component]

## NFR-A11Y — Accessibility (baseline, testable)

- **NFR-A11Y-001** — Interactive chrome exposes accessible names where present: `[aria-label]` on theme/language toggles, tree resize separator (`role=separator` + `aria-valuenow/min/max`), close-tab, new-tab, more-menu. [component]
- **NFR-A11Y-002** — All modals close on `Esc`; the context menu is keyboard-dismissible. [E2E]
- **NFR-A11Y-003 (recommendation)** — Run an automated axe-core pass per major view (page, review, settings, artifacts) and treat new serious/critical violations as failures. [E2E]

---

## Known gaps / unimplemented-but-referenced (assert as no-ops)

> These exist in help text, the hotkey registry, or older specs but are **not
> wired** in the shipped build. QA writes a **negative** assertion for each so a
> future accidental implementation (or removal) is caught, and so the suite
> doesn't fail expecting a feature that isn't there.

- **GAP-001** — ✅ **RESOLVED (2026-06-10, Wave 2).** next/prev tab (`mod+shift+]` / `mod+shift+[`) now have a keydown handler in `app/page.tsx`. Locked by `e2e/tests/shell.spec.ts::FR-UI-KEYS-001`. [E2E]
- **GAP-002** — ✅ **RESOLVED (2026-06-10, Wave 2).** `VersionHistory.tsx` now expands each revision to an inline diff against the current version (reusing `<Diff>`; bodies arrive with the revisions list, so it's client-side, no `/diff` endpoint) and shows a **Restore** control on published versions. Covered by `e2e/tests/history.spec.ts` and (backend) `tests/test_restore.py`. [E2E]
- **GAP-003** — ✅ **RESOLVED (2026-06-10, Wave 2) — verified, no code change.** Page-body `[1]` markers are intentionally literal; citation superscripts/anchors are a chat-answer feature and behave correctly there. No help text or UI claims page-body citations, so there is nothing misleading to trim. Closed as working-as-intended. [component]
- **GAP-004** — ✅ **RESOLVED (2026-06-10, Wave 2).** `POST /api/revisions/{id}/restore` now exists — it recreates a published revision as a fresh edit and runs it through the normal workflow (open→republish, stable→review). Positive guarantee **FR-REV-011**, locked by `tests/test_restore.py` (open→`accepted`, stable→`proposed`, reader→403, draft→400, missing→404). (No `/diff` endpoint — diffing is client-side.) [API]
- **GAP-005** — ✅ **RESOLVED (2026-06-11, Wave 2).** `GET /api/notifications/unread-count` now returns the caller's exact unread count (**FR-NOTIF-005**), and the bell badge reads it instead of the list-derived (100-capped) count. Locked by `tests/test_notifications.py::test_FR_NOTIF_005_*`. [API]
- **GAP-006** — **No rate limiting** on any endpoint (publish, chat, login, etc.). *Assert:* rapid repeated calls are not 429'd (documents the gap; revisit before public exposure). [API]
- **GAP-007** — MCP auth **ignores `ApiToken.expires_at`** while `/api/*` enforces it: an expired `wt_*` token still works over `/mcp` but not over `/api/*`. *Assert:* both behaviors. [API]
- **GAP-008** — ✅ **RESOLVED (2026-06-10, Wave 1).** Previously `GET /api/pages/{path}/revisions` returned **other users' drafts**; now filtered so a `draft` is returned only to its author (`pages.py::list_revisions`). The SRS guarantee is now positive (FR-PAGE-007) and locked by `tests/test_wave1_gaps.py::test_FR_PAGE_007_revisions_hide_other_users_drafts`. [API]
- **GAP-009** — **Flag resolve writes no audit row** (raise does) and **ignores editor category-scoping** (any editor resolves any flag). *Assert:* both. [API]
- **GAP-010** — **Page move ignores editor category-scoping** (any editor moves any page) and does not rewrite `[[old]]` link text in other page bodies (relies on fuzzy re-resolution). *Assert:* both. [API]
- **GAP-011** — ✅ **RESOLVED (2026-06-11, Wave 2).** `upload_source` now gates on `is_supported_ingest_mime` (the same supported set the ingest dispatcher uses) and rejects unsupported types **415** up front, removing the temp file — mirroring URL-import's up-front rejection. FR-RAW-004 updated; locked by `tests/test_sources_ingest.py::test_FR_RAW_004_unsupported_type_rejected_at_upload` + `_supported_types_accepted`. [API]
- **GAP-012** — Session JWTs have **no `exp`**; sign-out is client-only (no server denylist). *Assert (backend):* logout only deletes the OIDC state cookie; a captured JWT still validates server-side. [API]
- **GAP-013** — Open-page **auto-publish cannot be forced to review over HTTP** (the `force_review` flag exists only for internal/agent callers). *Assert:* a human submit on an `open` page is `accepted`, never `proposed`. [API]
- **GAP-014** — ✅ **RESOLVED (2026-06-10, Wave 2).** The dead `components/Backlinks.tsx` and `components/PageMeta.tsx` (no importers; PageView uses an inline strip) were removed. [component]
- **GAP-015** — ✅ **RESOLVED (2026-06-10, Wave 2).** The page More-menu now has a working **"Open in new tab"** (`PageView.tsx`), matching the file-tree menu; the Tabs integration is fully shipped (project memory closed). [component]
- **GAP-016** — **No last-admin guard** (found 2026-06-11 by the adversarial probe; **accepted for internal by decision**). `POST /users/{id}/deactivate` and `/role` (`users.py`) have no last-active-admin protection — an admin can deactivate themselves or demote the last admin → admin lockout. There is **no `reactivate` endpoint** (deactivation is one-way via the API), so recovery is via the **static-admin break-glass login** or DB. SRS `FR-USR-002/003` don't mandate a guard, so this is a hardening gap, not a defect. *Assert (current behavior):* self-deactivate / last-admin-demote returns 200, no 5xx. **Hardening before external exposure:** refuse to remove the last active admin (409) + add a `reactivate` path. [API]
- **GAP-017** — **Dependency CVEs** (found 2026-06-12 by `pip-audit` + `npm audit`; partly remediated same day).
  - **Backend — ✅ RESOLVED + validated.** Upgraded the auth/upload hot path to patched versions: `authlib 1.3.2 → 1.7.2`, `PyJWT 2.9.0 → 2.13.0`, `python-multipart 0.0.12 → 0.0.32`, `starlette 0.38.6 → 1.3.0` (via `fastapi 0.115.0 → 0.136.3`), `markdownify 0.13.1 → 1.2.2`. `pip-audit` re-scan is clean for these; the full backend suite (0 failures) + the **OIDC mock-IdP flow end-to-end** (authlib 1.7) validate it. `requirements.txt` pinned. *(pyjwt 2.13 now warns on HMAC keys <32 bytes — a reminder to set a real ≥32-byte `jwt_secret` in prod, already on the §8 checklist.)* Remaining backend audit items are tooling (`pip`/`setuptools`/`pytest`) + `transformers` (breaking major) — lower priority.
  - **Frontend — 🟡 PARTIAL (accepted for internal by decision).** Bumped Next.js `14.2.18 → 14.2.35` (latest 14.2.x; validated via vitest + E2E) — this dropped the critical to high but **did not clear the Next advisories** (DoS / SSRF / cache-poisoning / i18n middleware-bypass / CSP-nonce XSS): their patched versions are **Next 15/16, not backported to 14.2.x**, and Next 16 forces **React 18 → 19** — a breaking migration. For the internal deployment (corporate network, trusted users) the residual risk is accepted; **plan a Next 16 + React 19 migration as a separate project** (the new frontend test suite is the safety net). Dev-only `esbuild` (pulled by vitest) + `diff` advisories are not in the production bundle / breaking to fix — low priority. [dependency]
- **GAP-018** — **LLM provider rate-limit tier is low** (found 2026-06-12). The Anthropic account is on a **30,000 input-tokens/min** tier; the worker hit `429 rate_limit_error` on large prompts. Lint over the full wiki + large ingests will throttle. **Action before relying on AI features under load:** raise the tier and/or add exponential-backoff retry around `llm_client` calls. [non-functional]
- **GAP-019** — **a11y: color-contrast** (found 2026-06-12 by the axe-core E2E scan, `e2e/tests/a11y.spec.ts`). The app shell has **0 critical** WCAG 2 A/AA violations but **1 serious: `color-contrast` on 5 elements** (text below the AA 4.5:1 ratio). Low-severity for an internal tool; bump those foreground/background pairs and then tighten the a11y gate from "no critical" to "no serious". [a11y]
- **GAP-020** — **chat endpoint has no graceful LLM-failure path** (found 2026-06-12). `routers/chat.py` calls `wiki_synthesize`/`answer` with no try/except, so an LLM error becomes a bare **500** (FastAPI keeps the server up, but the client gets a generic 500 instead of a clean `503 "AI temporarily unavailable"`). The LLM client *does* fail fast (no hang — `test_degradation.py`). **Polish:** wrap the chat call and map provider errors to a 503 with a friendly message. [non-functional]
- **GAP-021** — **`readability-lxml` broken → URL HTML ingest silently degraded** (found 2026-06-12 by the new `test_url_fetcher.py`; **fixed same day ✅**). Newer `lxml` (≥5) split `lxml.html.clean` into a separate `lxml_html_clean` package that wasn't installed, so `from readability import Document` raised `ImportError`. `services/url_fetcher.py:_html_to_markdown` therefore always hit its `except` fallback and stored **raw HTML chrome** instead of clean markdown for every ingested web page — invisible because the fallback caught it (no crash, just worse ingest quality). **Fix:** pinned `lxml_html_clean>=0.1` in `backend/requirements.txt`; readability now strips nav/chrome as intended. Note: a container rebuild (or `pip install -r requirements.txt`) is needed to bake the dep into the image. [non-functional]

---

## Recommended `data-testid` additions (stabilize E2E before automating)

The app leans on text/`title`/`aria-label`. Stable anchors that already exist:
`data-path` (file rows), `data-idx` (switcher rows), `[aria-label]` on the
toggles/separator/tabs, `.wiki-link`/`.wiki-link.broken`, `.badge.{stability|status}`,
`.diff-add`/`.diff-del`/`.diff-ctx`, `data-rainbow` (tags/tree). **Add `data-testid`** to:
modal roots (propose/review/move/settings/publish/version-history), each topbar action
button, the review Accept/Reject/Request-changes buttons, the sources Ingest/Retry
buttons, the ingest Approve/Dismiss buttons, the lint Run/Dismiss buttons, the MCP
Create/Revoke buttons, and the artifact card actions (rename/visibility/copy/open/version/log/delete).
Adding these is a small, low-risk frontend change that materially de-flakes the E2E suite.

## QA agent runbook

1. **Bring up the stack:** `docker compose up -d`; wait for `wiki-frontend-1` healthy + `/api/auth/config` reachable. Seed with `SEED_EXAMPLES=true` or via the API (below).
2. **Provision actors (stub mode):** `POST /api/auth/dev-login` for `reader`/`contributor`/`editor`/`admin`; for editor scoping, add `category_editors` rows or seed a categorized page. Keep each role's JWT for `[API]`; for `[E2E]`, drive role via the dev `<select>`.
3. **Seed content:** publish ~5 cross-linked pages (covers list/graph/backlinks/search), one `open`/one `stable`/one `locked` page, a raw source, and an MCP token (admin grants `mcp_enabled` first).
4. **Run levels:**
   - `[unit]`+`[API]`: `docker exec wiki-backend-1 pytest -v` (extend `backend/tests/`; `test_artifacts.py` is the reference style).
   - `[component]`: RTL/jsdom (Vitest/Jest) in `frontend/`.
   - `[E2E]`: Playwright against `http://localhost:3000`.
5. **Per requirement:** name the test after its ID (e.g. `test_FR_REV_006_review_locked_editor_403`); for `GAP-*` write the no-op/negative assertion.
6. **Coverage report:** emit `FR-* / NFR-* / GAP-* -> test id(s) -> pass/fail`; flag any `FR-*` with zero tests. Append the matrix back into `README.md §8` once the suite exists.
7. **Pre-deploy gate (suggested):** all `FR-*` covered & green; every `NFR-SEC-*` green; every role x capability cell has allow+deny; no new axe serious/critical; all `GAP-*` no-op assertions hold (so none silently changed).

---

## Wave-1 resolution log (2026-06-10)

`[API]` baseline: **242 passed, 9 skipped** (`backend/tests/`, run `docker exec wiki-backend-1 python -m pytest tests/ -q`). Deployment context: **company-internal only** (not public-facing).

**Fixed — TDD, locked by tests (these SRS rows are now positive guarantees):**
- **GAP-008** — `revisions` draft leak → author-only filter (`pages.py`).
- **(QA-found) token-create 500** — `POST /api/auth/tokens` *and* `/api/mcp-tokens` validated the ORM row before `raw_token` was set → fixed validate order (`auth.py`, `mcp_tokens.py`). Token + MCP integration were fully broken; now work.
- **(QA-found) comments/flags GET 404** — greedy `GET /{page_path:path}` shadowed the cross-router GETs → registered `comments.router` before `pages.router` (`main.py`).
- **(QA-found) preferences 422→400** — `body: Any` so the isinstance 400 guard runs (`auth.py`).
- **(QA-found) search snippet 241→≤240** — off-by-one (`search.py`).
- **(QA-found) graph self-edge** — now skipped (`graph.py`).
- **GAP-010** — page move now enforces editor category scope via `is_editor_for_page` (`pages.py`).
- **GAP-009** — flag resolve now enforces editor category scope **and** writes a `flag.resolve` audit row (`comments.py`).

**Accepted by product decision (no code change):**
- **GAP-006** rate limiting — **deferred to Wave 2** (internal-only). **MUST be added before any external exposure.**
- **GAP-012** JWT no `exp` — **accepted** (internal tool; sign-out is client-side).
- **GAP-013** open-page auto-publish — **kept** (intentional per PERMISSIONS.md).
- `User.mcp_enabled` **default `True`** — **kept**: every user may use MCP; admins can revoke per-user. (§5.1 matrix asterisk should read "default-on; admin-revocable," not "admin-granted".)
- Editor category-scoping for flag-resolve/move — **enforced** (decision #4).

## Wave-2 resolution log (2026-06-10)

All Wave-2 quick wins **and** the diff/restore feature are done and locked by tests.

- **GAP-001** tab shortcuts — keydown handler added (`app/page.tsx`); `shell.spec.ts::FR-UI-KEYS-001`. ✅ [E2E]
- **GAP-002 / GAP-004** version diff + Restore — `VersionHistory.tsx` inline diff (reusing `<Diff>`, client-side) + Restore control; backend `POST /api/revisions/{id}/restore` (**FR-REV-011**, honours the trust dial). Locked by `tests/test_restore.py` (5) + `e2e/tests/history.spec.ts` (1). ✅ [API+E2E]
- **GAP-003** page-body citations — verified working-as-intended (chat-only by design); closed, no code change. ✅
- **GAP-014** dead components removed (`Backlinks.tsx`, `PageMeta.tsx`; no importers). ✅
- **GAP-015** page More-menu "Open in new tab" wired (`PageView.tsx`); Tabs integration fully shipped. ✅
- **NFR-I18N-002** `IngestPlanPreview.tsx` localized (46 `ingp.*` keys, en+zh parity) + 2 latent TS bugs fixed. ✅

**Still open (deferred, by decision):**
- **GAP-006** rate limiting — **MUST be added before any external exposure** (internal-only today).
- **GAP-007 / GAP-012 / GAP-013** — accepted as-designed for the internal deployment (see decisions above).

(GAP-005 and GAP-011 were resolved 2026-06-11 — see the per-gap entries above and the FR-NOTIF-005 / FR-RAW-004 requirements.)

**Search-recall note (not a code bug):** `test_FR_SRCH_004_snippet_max_240` searches for a rare token and asserts the ≤240 snippet bound on the hit. Pages are indexed **synchronously at publish** (`reindex_page`; the chunks table holds **zero** NULL embeddings), so findability is not a freshness/timing issue. The flake was **vector recall**: `/api/search` returns only the top-k chunks by similarity across the whole corpus, and the lexical (substring) fallback in `rag.retrieve` fires **only when the vector search returns zero rows** — so a rare token can rank below a small k even though the page is fully indexed. The test now uses `k=100` (recall-robust; 8/8 green) with a skip backstop. **Product implication:** keyword/exact-string lookups are only as reliable as vector recall; a true hybrid (always union lexical + vector, instead of lexical-only-on-zero) would make literal lookups dependable. Tracked as a possible enhancement, not a Wave-2 blocker.

`[API]` + `[E2E]` layers are green; the `[component]`/jsdom layer remains optional.
