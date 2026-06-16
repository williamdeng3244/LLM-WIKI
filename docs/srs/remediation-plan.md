# Remediation & Test-Sequencing Plan

**Version:** 1.0 · **Date:** 2026-06-10 · Companion to the [SRS](README.md).

Defines **when** each NFR and known gap is addressed relative to the QA test
build, and records the default decisions on the open product questions (each is
**overridable** — flag any you disagree with).

## Guiding principle

1. **Test-first baseline before any fix.** The QA suite is both the regression
   safety net and the definition-of-done for each fix. We lock current behavior
   first (gaps as **negative** assertions, NFRs **verified**).
2. **NFRs are verified, not a separate fix step.** A green NFR test = the
   guarantee holds. A **red** NFR test = a real bug → fix immediately (folds into
   Wave 1).
3. **Each gap fix flips its assertion.** When a `GAP-*` is fixed, its negative
   assertion becomes a positive `FR-*` test. Clean traceability, no phantom
   features.

## Sequence

| Step | What | Output |
|------|------|--------|
| 0 | This plan (triage + decisions) | sign-off |
| 1 | **Baseline test suite** (this is the QA work) — `[API]` first, then `[component]`, then `[E2E]`. Gaps as negatives; NFRs verified. | green baseline; any red NFR-SEC surfaces as a Wave-1 bug |
| 2 | **Wave 1 — Bucket A** (pre-deploy blockers: security/privacy/integrity), TDD each | fixes + flipped FR tests |
| 3 | **Wave 2 — Bucket B** (functional/UX gaps), by product priority | fixes/features |
| 4 | **Wave 3 — Bucket C** (accept/document/cleanup) | docs + dead-code removal |
| 5 | Full suite re-run -> green = the README §7.3 pre-deploy gate is met | release sign-off |

## Triage

### Bucket A — must fix before production (Wave 1)

| Gap | Why | Default decision | Flips to |
|-----|-----|------------------|----------|
| **GAP-008** draft leak in `GET …/revisions` | **Privacy** — user A sees user B's draft bodies | Filter the list to the author's own drafts + non-draft statuses (mirror the single-revision guard). **Fix first.** | FR-PAGE-007 (guarded) |
| **GAP-009** flag-resolve no audit + ignores scoping | Audit completeness + permission consistency | Add `flag.resolve` audit row; enforce editor category-scoping (or consciously keep global — see note) | FR-FLAG-003 |
| **GAP-010** page-move ignores editor scoping | Permission consistency | Enforce `is_editor_for_page` on the source (admins exempt) | FR-PAGE-010 |
| **GAP-007** MCP ignores `expires_at` | Token lifecycle parity with `/api/*` | Honor `expires_at` in `authenticate_mcp` | FR-MCP-002 |
| **GAP-012** JWT has no `exp`; no server logout | Session security | **Add a bounded `exp` (30d)** to session JWTs; keep client-side logout. Full refresh-token rotation = follow-up. (UX caveat: users re-auth after 30d.) | FR-AUTH (new exp test) |
| **GAP-006** no rate limiting | Abuse/DoS | **Internal-only -> defer to Wave 2.** **HARD GATE: promote to Wave 1 before any public/external exposure** (publish, chat, login, MCP, artifact viewer). | NFR (new) |
| any **NFR-SEC-*** that tests red | Broken security guarantee | fix on sight | — |

### Bucket B — should fix, product-priority (Wave 2)

| Gap | Default decision | Notes |
|-----|------------------|-------|
| **GAP-002 + GAP-004** version diff + Restore | **Build it** (frontend diff view reusing `<Diff>` + a backend revert = new-draft-from-old-body + publish). Medium effort; brainstorm first. | help text already promises it |
| **GAP-003** citation `[1]` in page bodies | **Default = trim the help text to match reality** (cheap, removes the misleading doc). Building real page-body citations is an optional follow-up feature. | decision overridable |
| **GAP-001** next/prev tab shortcuts | Wire the missing `mod+shift+]`/`[` handlers (registry already lists them) | small |
| **GAP-005** notifications unread-count | Optional: add `GET /api/notifications/unread-count` or keep deriving | minor |
| **GAP-011** upload MIME allow-list | Add an upfront allow-list to `POST /api/raw` (parity with URL import) | hardening |
| **GAP-015** "open in new tab" in page More-menu | Wire the item (file-tree menu already has it) | tiny; see project memory |
| **NFR-I18N-002** un-localized panels | Localize `IngestPlanPreview` (+ fold the `/artifacts` STR table into i18n) | parity |

### Bucket C — accept / document / cleanup (Wave 3)

| Gap | Default decision |
|-----|------------------|
| **GAP-013** open-page auto-publish can't force review | **Accept as designed** — PERMISSIONS.md explicitly defines `open` as "auto-publishes immediately… low-stakes brainstorming". Document as intentional; add an explicit test asserting the intended behavior. |
| **GAP-014** dead components `Backlinks.tsx` / `PageMeta.tsx` | **Remove** (not mounted; PageView uses an inline strip). Pure cleanup. |

## Open product decisions (my defaults applied above — override any)

1. **Rate limiting (GAP-006):** default = internal-first (Wave 2); **must** move to Wave 1 before public exposure. -> If this wiki will be exposed externally, tell me and it becomes a Wave-1 blocker.
2. **JWT expiry (GAP-012):** default = add 30-day `exp` now, refresh-token rotation later. -> Or keep no-exp for an internal-only tool?
3. **Open-page auto-publish (GAP-013):** default = keep (intentional). -> Or require review for all pages?
4. **Page-body citations (GAP-003):** default = trim the help text. -> Or build real `[1]` rendering on pages?
5. **Flag/move scoping (GAP-009/010):** default = enforce editor category-scoping. -> Or keep "any editor" intentionally?

## Test build order (Step 1 detail)

1. **Harness** — `backend/tests/conftest.py`: client-by-role factory (stub `X-User-Email`+`X-User-Role`), unique-id helpers, seed helpers (publish page, create+submit draft, mint MCP token). Black-box vs the live backend on :8000 (same style as `test_artifacts.py`); each test uses fresh unique users/paths so it never collides.
2. **`[API]` modules**, each test named for its FR id (`test_FR_PAGE_003_*`): start with a thin vertical (auth -> pages -> revisions) to prove the harness, then fan out (comments/flags, bookmarks, search, graph, raw/ingest, mcp, tokens, notifications, chat, admin, lint, artifacts). Include every `GAP-*` (negative) and `NFR-SEC-*` (verify) in the relevant module.
3. **`[component]`** (RTL/jsdom) and **`[E2E]`** (Playwright) follow; add the recommended `data-testid`s first to de-flake E2E.
