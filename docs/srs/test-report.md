# Enflame Wiki — Test Report & Release-Readiness

**Date:** 2026-06-11 (line coverage re-baselined to **90%** on 2026-06-12)  **Build:** internal deployment candidate  **Verdict:** ✅ **Functional verification complete — clear for internal release pending the pre-deploy checklist (§8).**

This is the sign-off evidence for the Enflame Wiki platform. It summarizes what was tested, the results, what was deliberately *not* tested, the defects found and fixed, and the gates remaining before production.

---

## 1. Executive summary

The platform was verified against the Software Requirements Specification (`docs/srs/`) by an automated suite whose tests are named 1:1 after the requirement IDs they cover. All functional tests pass:

| Suite | Result | How to reproduce |
|---|---|---|
| Backend API + in-process (live stack) | **376 passed · 14 skipped · 0 failed** (+58 OIDC tests pass with the mock-IdP harness up) | `docker exec wiki-backend-1 python -m pytest tests/ -q` |
| Frontend unit (vitest + testing-library) | **56 passed** (new — was 0; lib 11/11 + 4 components) | `docker exec wiki-frontend-1 npm test` |
| End-to-end (Playwright, real browser) | **8 specs · 0 failed**, run on **chromium + firefox + webkit** | see §3 |
| Frontend type-check | **clean (0 errors)** | `docker exec wiki-frontend-1 npx tsc --noEmit` |

**Measured coverage & test-quality metrics:**

| Metric | Value | Notes |
|---|---|---|
| Requirements coverage | **100%** (116/116 FR-*) | tests mapped 1:1 to SRS requirement IDs; LLM/worker features covered via a mock LLM + mock IdP (plumbing, not model quality) |
| Line coverage (backend) | **90.1%** (3,771/4,186 stmts) | the earlier "63% floor" was a coverage.py **C-tracer bug** (it doesn't trace async handler bodies under uvicorn); `COVERAGE_CORE=sysmon` + 6 new test modules give the real **90%** — full story in `code-coverage-report.md`. 100% line is not a goal |
| Mutation score (sample) | **75%** (3/4, permission core) | full run impractical (black-box + separate worker); the 4-mutation sample flushed out a dead-code finding |

The 8 skips are intentional environment/precondition skips (§5), **not failures**. **22 defects/gaps** were found and fixed (§6): 15 across two remediation waves, plus **7 more found by an adversarial QA pass** — a login `500`, an artifact private-metadata info-leak, two negative-`limit` crashes (REST search + MCP `search_wiki`, the latter aborting the DB transaction), a whole class of malformed-input `500`s (int4-overflow ids + null bytes in text) fixed by one global handler, and the same null-byte class in the **MCP tool dispatch** — which also lifted requirements coverage from 69% → 86%. The remaining open items are deferred *by decision* and safe for an internal deployment (§7); the one production gate automated tests cannot cover — switching authentication from the dev stub to real SSO — is the first item on the pre-deploy checklist (§8).

---

## 2. Backend API coverage (285 tests)

Black-box HTTP tests against the running backend (`:8000`), exercising the real database, workflow, search, and permission model. Coverage by area:

| Test file | Tests | Area (SRS) |
|---|---:|---|
| `test_pages_revisions.py` | 55 | Pages & revision lifecycle (FR-PAGE, FR-REV) |
| `test_sources_ingest.py` | 40 | Raw sources, upload, URL import, ingest (FR-RAW, FR-ING) |
| `test_auth_users.py` | 40 | Auth, sessions, login, API tokens, users (FR-AUTH, FR-USER) |
| `test_admin_lint.py` | 27 | Admin operations & wiki lint (FR-ADMIN, FR-LINT) |
| `test_collab.py` | 19 | Comments, flags, bookmarks (FR-COLLAB) |
| `test_baseline_api.py` | 16 | Health, config, cross-cutting contracts |
| `test_mcp.py` | 14 | MCP server tools & gating (FR-MCP) |
| `test_artifacts.py` | 16 | Artifact publish/versioning + viewer SEC + private-metadata scope (FR-ART) |
| `test_search_graph.py` | 12 | Search & knowledge graph (FR-SRCH, FR-GRAPH) |
| `test_notifications.py` | 11 | Notifications + unread count (FR-NOTIF) |
| `test_mcp_tokens.py` | 8 | MCP token issuance (FR-MCP) |
| `test_restore.py` | 5 | Version restore (FR-REV-011) |
| `test_chat.py` | 5 | RAG chat (FR-CHAT) |
| `test_wave1_gaps.py` | 3 | Wave-1 regression guards |
| **Total** | **285** | **277 pass / 8 skip / 0 fail** |

---

## 3. End-to-end coverage (8 journeys)

Dockerized Playwright against the running app (`:3000`) in a real Chromium browser.

Run: `docker run --rm --network host -e NODE_OPTIONS=--no-network-family-autoselection -e CI=1 -v "$PWD/e2e":/e2e -w /e2e mcr.microsoft.com/playwright:v1.49.0-noble bash -lc "npx playwright test"`

| # | Journey | SRS |
|---|---|---|
| 1 | App shell renders for a fresh session | FR-UI-SHELL-001 |
| 2 | Propose → review → publish → searchable (2 roles) | FR-UI-PROP/REV, FR-UI-SEARCH |
| 3 | Version history: view diff + restore an old version | FR-REV-011 |
| 4 | Role gating: reader vs contributor capabilities | FR-UI-SHELL-006 |
| 5 | Theme toggle | FR-UI-SHELL-002 |
| 6 | Language toggle (EN ↔ 中文) | FR-UI-SHELL-003 / I18N-001 |
| 7 | New-tab opens the New-tab page | FR-UI-TABS-001/005 |
| 8 | Next/prev tab keyboard shortcuts | FR-UI-KEYS-001 |

---

## 4. Traceability

Every backend test is named `test_FR_<AREA>_<NNN>_<short>` and every E2E test is titled with its `FR-…` id, so the suites map **1:1 to the requirements** in `backend-functional.md` and `frontend-functional.md`. Reading a test name tells you exactly which spec clause it verifies. This is the "we verified the spec" evidence.

---

## 5. Intentionally skipped (14) — not failures

Per suite policy these **skip-with-reason, never fake a result**. Two groups:

**OIDC integration (9)** — `test_oidc_callback.py`. They drive the real OIDC callback/login against a **mock IdP** and only run with that harness up (oidc-mode instances on :8011/:8013; see the module docstring). With it running they pass (FR-AUTH-011/012/013 + login-disabled 004).

**Environment-preconditions (5)** — states the public API can't set up:

| Test | Why it skips |
|---|---|
| `test_mcp.py:97` | MCP is globally enabled here; the `503` kill-switch path needs `MCP_ENABLED=false` |
| `test_pages_revisions.py:318` | Needs a `category_editors` seed + a categorized page (no public endpoint to set up) |
| `test_sources_ingest.py` (file-gone) | The `410 file-gone-from-disk` path needs out-of-band file deletion |
| `test_sources_ingest.py` (50 MB) | The 50 MB upload-cap path is impractical to push over HTTP in CI |
| `test_sources_ingest.py` (approved-indices) | The out-of-range `approved_indices` 400 needs a black-box run in `pending_review` with a cached plan |

> The ingest/lint/chat **requirements** are now fully covered in-process via the mock LLM (`tests/mock_llm.py`) — the 5 remaining ingest/MCP skips above are black-box edge-cases, not requirement gaps. Separately, 3 black-box `test_chat.py` tests skip **only when the env has no live LLM** (they passed in the latest run); they never fail.

---

## 6. Defects found & fixed (this verification effort)

**Wave 1 — found by the API baseline, fixed test-first:**
- Token creation 500 (`/api/auth/tokens` & `/api/mcp-tokens`) — Pydantic validated the ORM row before `raw_token` was set. **Fixed.**
- Comments/flags `GET` 404 — a greedy page route shadowed the cross-router GETs. **Fixed** (router order).
- Draft leak (GAP-008) — `/revisions` exposed other users' drafts. **Fixed** (author-only filter).
- Editor category-scope bypass on flag-resolve (GAP-009) and page-move (GAP-010). **Fixed.**
- Search snippet off-by-one (241→≤240); graph self-edge; preferences `422→400`. **Fixed.**

**Wave 2 — feature gaps closed:**
- GAP-001 tab shortcuts · GAP-002/004 version diff + Restore (`FR-REV-011`) · GAP-003 citations (verified, no change) · GAP-005 notifications unread-count (`FR-NOTIF-005`) · GAP-011 upload MIME allow-list (415) · GAP-014 dead-code removal · GAP-015 page-menu "open in new tab" · NFR-I18N-002 (localized the ingest preview).

**Test-hygiene fixes during sign-off:**
- Hardened a flaky search test (`FR-SRCH-004`) — root-caused to **vector recall** (not NULL embeddings); now deterministic at `k=100`.
- Removed a **stale skip** that hid `FR-AUTH-006` (Bearer `wt_` token resolution + revocation) — the cited bug was already fixed; the test now runs and passes.

**Adversarial QA pass (2026-06-11) — probing untested code for bugs:**
- 🐛 **Login `500` on non-ASCII credential** (`auth.py`, FR-AUTH-003) — `secrets.compare_digest` raises `TypeError` on non-ASCII `str`, surfacing as a 500 instead of a 401. **Fixed** (compare bytes → clean 401), locked by a regression test. *Severity: low-medium — unhandled exception in security-critical code; an attacker can 500 the login endpoint with a Unicode password.*
- 🐛 **Artifact private-metadata info-leak** (`artifacts.py`, FR-ART-007) — `GET /api/artifacts/{sid}` returned a **private** artifact's metadata (name/owner/existence) to any authenticated user, while the viewer correctly 404'd. **Fixed** (private metadata now owner/admin-only; wiki/public unchanged), locked by a regression test. *Severity: low-medium info-disclosure.*
- 🐛 **Search `500` on negative `k`** (`search.py`, FR-SRCH-005) — `GET /api/search?k=-1` became a negative SQL `LIMIT`, which Postgres rejects → unhandled 500. **Fixed** (validate `0 ≤ k ≤ 100` → 422), regression-tested.
- 🐛 **MCP `search_wiki` crash + transaction abort** (`mcp.py`, FR-MCP-005) — the MCP layer does **not** enforce the tool `inputSchema`, so `limit=-1` reached the SQL `LIMIT` and **aborted the DB transaction** (`InFailedSQLTransactionError`). **Fixed** (coerce + clamp to 1–50, matching the sibling artifact-list tool), regression-tested.
- 🐛 **Unhandled DB data-errors → `500`** (global, `main.py`) — input that slipped past schema validation into the DB layer leaked a 500 on **many** endpoints: an **id beyond int4 range** (`/api/revisions/9999999999`) and a **null byte `0x00` in a text field** (comment body/anchor). **Fixed** with one global exception handler mapping SQLSTATE-22 (data exception) → 400; a genuinely-missing in-range id still 404s. Regression-tested.
- 🐛 **MCP tool null-byte → `-32603` crash + transaction abort** (`mcp.py`) — the HTTP handler above doesn't cover JSON-RPC, so `list_pages` / `get_page` / `create_draft` with a null byte aborted the transaction and returned a `-32603` internal error. **Fixed** — the MCP dispatch now catches SQLSTATE-22, rolls back, and returns a clean tool `isError`. Regression-tested. *(Found in the deeper-coverage pass that also closed FR-MCP-006/007/008/009, FR-ART-002–006, and the scattered PAGE/RAW/REV/ADMIN requirements — lifting requirements coverage to 86%.)*
- 🧹 **Dead code** — removed `can_lock()` (imported but never called; the lock route enforces admin via `require_role`). Surfaced by a mutation-testing sample.
- Closed **untested AUTH/SRCH/MCP requirements** (FR-AUTH-002/003/007/008/014, FR-SRCH-005, FR-MCP-005) + added the FR-ART-007 scope test → requirements coverage 69% → **75%**.

**Coverage-completion pass (2026-06-11) — closing the last infra-blocked requirements to 100%:**
- **OIDC 0 → 100%** (`FR-AUTH-011/012/013/016` + login-disabled `004`) via a signed-id_token **mock IdP** (`tests/mock_idp.py`): CSRF `state` validation, PKCE, the full success path, and the boot guard. **0 OIDC bugs.** → requirements coverage **91%**.
- **Ingest / lint / RAG-chat + the last unit gaps** via an OpenAI-compatible **mock LLM** (`tests/mock_llm.py`, in-process on 127.0.0.1) plus direct unit tests: `FR-CHAT-003`, `FR-ING-005/006/007/008/009`, `FR-LINT-001/002`, `FR-SRCH-003`, `FR-RAW-006`, `FR-MCP-009`. → requirements coverage **100% (116/116)**. No new bugs found — the implementations were already correct. These mocks prove the pipeline/contract, **not** a live model's output quality (see the functional-coverage report's caveat).

Full remediation log: `non-functional-and-gaps.md`.

---

## 6b. Pre-deploy hardening pass (2026-06-12 — Tier 1 + Tier 2)

A deliberate "what's missing before deploy" pass beyond the functional suite.

**Tier 1 — real-risk closure (all validated):**
- **Stored-XSS lock** — `test_security_xss.py` (5) + `frontend Markdown.test.tsx` (2): the markdown/artifact render path is safe by construction (markdown-it `html=False`; react-markdown without rehype-raw; sandboxed iframe for HTML artifacts; escaped name; neutralized `javascript:` links) — now locked so a future change can't silently re-open it.
- **Real ingest pipeline** — `test_ingest_e2e.py` (gated `WIKI_RUN_LIVE_E2E=1`): the actual Celery worker (via Redis) completed a plan in ~11 s, and the real MinerU sidecar parsed a PDF to markdown. Previously only mock / in-process.
- **Vault↔DB consistency** — `test_vault_consistency.py`: locks the "boot re-imports the vault" behavior (a DB-only cleanup is undone on restart — the bug that re-bloated the graph). **Backup/restore drill**: `pg_dump` → scratch DB → restore reproduced 47 pages / 53 revisions cleanly.
- **Frontend tests from zero** — vitest + testing-library + jsdom set up; **12 unit tests** (version, hotkeys, Markdown-XSS); E2E expanded 4 → 6 specs.

**Tier 2 — production hygiene:**
- **Dependency vuln scan** (`pip-audit` + `npm audit`) — **found real CVEs (GAP-017):** frontend **Next.js 14.2.18** (SSRF / cache-poisoning / i18n-middleware-bypass / image DoS), backend **authlib / pyjwt / starlette / python-multipart** (auth + upload path). **Update before production.**
- **AuthZ matrix** — `test_authz_matrix.py` (15): every mutation endpoint rejects anon (401) and every admin-only endpoint rejects a non-admin (403). No holes.
- **Test CI** — `.github/workflows/test.yml`: backend suite + frontend vitest + lint on push/PR (previously only `release.yml`).
- **DB migrations** — adopted **alembic** (`backend/alembic/`): a validated baseline migration recreates all 21 tables + the pgvector column on a fresh DB; the live DB is stamped at the baseline — a versioned upgrade path replacing boot-time `create_all`.

**Two deployment findings surfaced:**
1. **Anthropic tier is rate-limited** (30 k input tokens/min — the worker hit 429s). Large lint/ingest prompts will throttle; raise the tier or add backoff/retry before relying on the AI features under load.
2. **Dependency CVEs** (above) — a prioritized upgrade (auth libs first) is needed before production.

---

## 6c. Coverage-deepening pass (2026-06-12)

A deliberate sweep of the previously-untested surfaces beyond the functional + Tier-1/2 work:

- **Frontend logic — now fully covered.** vitest + testing-library (0 → **56 unit tests**): all **11/11 `lib` modules** (the `api` fetch client; the `i18n` table with an en/zh key-parity guard; the `tabs`/`theme`/`folderOrder`/`customFolders`/`useLanguage` state hooks; the pure helpers `version`/`hotkeys`/`graphSettings`/`themes`/`help`) + **4 components** (Markdown XSS, Diff, ContextMenu, ShortcutSheet). SWR-driven panels + purely-presentational components remain a lower-value tail.
- **Dimensions.** **Cross-browser** — the E2E suite now runs on **chromium + firefox + webkit**. **a11y** — an axe-core scan (`e2e/tests/a11y.spec.ts`) gates the shell at "no critical" (passes; surfaced GAP-019). **Graceful degradation** — the LLM client fails fast, no hang, when the provider is down (`test_degradation.py`); search→lexical fallback / ingest-planning / rate-limit were already covered.
- **Backend gaps.** **AuthZ matrix** (`test_authz_matrix.py`, 15) — every mutation rejects anon, every admin route rejects non-admins. **CLI scripts** (`test_cli_scripts.py`) — `export_to_disk` (was 0%). **Office ingest** — real MinerU converts **xlsx → markdown table** + **docx → text** (`test_ingest_e2e.py`, gated).
- **Findings:** GAP-019 (a11y color-contrast), GAP-020 (chat has no graceful 503 on LLM failure) — both in the gap log.

---

## 7. Known / deferred items (by decision — safe for internal)

| Item | Status |
|---|---|
| **GAP-006** rate limiting | Deferred — **MUST be added before any external/public exposure.** Not required for internal-only. |
| **GAP-007** MCP ignores token `expires_at` | Accepted as-designed (internal). |
| **GAP-012** session JWT has no `exp` | Accepted (sign-out is client-side; internal). |
| **GAP-013** open-page auto-publish | Intentional (trust dial). |
| **GAP-016** no last-admin guard | **Accepted for internal (by decision).** `POST /users/{id}/deactivate` and `/role` have no last-active-admin protection, so an admin can deactivate themselves or demote the last admin → admin lockout; there is no `reactivate` endpoint (deactivation is one-way via the API), so recovery is via the **static-admin break-glass login** or DB. Found by the adversarial probe; SRS `FR-USR-002/003` don't mandate a guard. **Hardening before any external exposure:** refuse to remove the last active admin (409) + add a reactivate path. |
| **Search recall** | Keyword/exact-string lookups are only as reliable as vector recall (lexical fallback fires only on zero vector hits). A true hybrid search is a possible future enhancement, not a blocker. |

---

## 8. Pre-deployment checklist (release-readiness gates)

Automated tests ran in **stub auth mode** against the **dev stack**. Before production, complete:

- [ ] **Auth → SSO.** Set `auth_mode=oidc` and configure `oidc_issuer` / `client_id` / `client_secret` / `redirect_uri`; verify the login flow end-to-end. *(Stub mode = no real access control; do not ship it.)*
- [ ] **Secrets.** Set a real `jwt_secret` (currently the `dev-secret-change-in-prod` default); supply OIDC creds and DB credentials via environment, not committed files; **rotate the GitHub token** currently in `~/.claude/settings.json`.
- [x] **Backend dependency CVEs (GAP-017) — DONE (2026-06-12).** `pyjwt`/`authlib`/`python-multipart`/`starlette`(+`fastapi`)/`markdownify` upgraded to patched versions; validated by the full suite (0 failures) + the OIDC mock-IdP flow; `requirements.txt` pinned; `pip-audit` clean for these.
- [ ] **Frontend Next.js → 16 + React 19 migration (GAP-017).** Bumped to `14.2.35` (latest safe 14.2.x); the residual Next CVEs need Next 15/16 (breaking, forces React 19) — **accepted for internal**, plan as a separate migration with the new frontend test suite as the safety net.
- [ ] **LLM rate-limit tier (GAP-018).** The Anthropic account is on a 30 k-tokens/min tier (the worker hit 429s); raise the tier and/or add backoff/retry before relying on ingest/lint/chat under load.
- [ ] **Database.** **Alembic is now adopted** (`backend/alembic/`; baseline migration validated to recreate all 21 tables + the pgvector column; live dev DB stamped). On the prod DB run `alembic stamp head` once, then `alembic upgrade head` for future schema changes (and switch boot off `create_all`). Confirm a **persistent Postgres volume** + a backup routine (the `pg_dump`→restore drill passed).
- [ ] **Persistence.** Persistent volumes for Postgres, the raw-uploads dir, and the embedding-model cache (`all-MiniLM-L6-v2`, ~90 MB).
- [ ] **Embedding warmup.** The local model loads ~8–10 s on first use; pre-warm on deploy so the first publish/search isn't slow.
- [ ] **Prod compose.** Review `docker-compose.prod.yml`: image tags, health checks, restart policies, resource limits, exposed ports behind the corporate network.
- [ ] **Staging smoke test.** Deploy `docker-compose.prod.yml` to a staging host and run the 8 E2E journeys (§3) against it.
- [ ] **Post-deploy verification.** Re-run the E2E journeys against production once, and confirm OIDC login + a real publish + search.

---

## 9. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| QA / Verification | | ☐ Approve  ☐ Reject | |
| Engineering | | ☐ Approve  ☐ Reject | |
| Product / Owner | | ☐ Approve  ☐ Reject | |

**Recommendation:** functional quality is verified and green; approve for internal release once §8 (especially the auth-mode switch) is complete.
