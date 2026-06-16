# Enflame Wiki — Software Requirements Specification (SRS) & Test Spec

**Version:** 1.0 · **Date:** 2026-06-09 · **Status:** Draft for QA automation · **Target build:** v1.1.2

This SRS specifies the platform's behavior at the granularity of **individual,
automatable functional requirements**. It is written to be consumed by a
**Testing / QA agent**: every requirement has a stable ID, a precondition, an
observable expected result, and a recommended automated test level. A QA agent
should be able to turn each `FR-*` / `NFR-*` row into one (or a few) automated
tests with no further design.

---

## 1. Purpose & scope

- **Purpose:** Provide the source-of-truth, testable feature inventory used to (a) validate the platform before deployment and (b) detect regressions.
- **In scope:** The full platform — FastAPI backend (REST + MCP server + Celery worker), the Next.js frontend (all panels, graph, editor, review workflow, settings/themes, i18n, auth UI), the artifacts/SaaS surface, and the permission model.
- **Out of scope (this revision):** Load/stress benchmarks with numeric SLAs, penetration testing beyond the documented security guarantees, and the `dsp` CLI internals (its REST contract is covered under Artifacts).

## 2. Audience & how to use

- **Primary reader:** an automated QA agent and the engineers reviewing its coverage.
- **How to read a requirement:** each is `FR-<AREA>-<NNN> — <testable statement>. (precondition / role). [test level]`.
- **Authoritative cross-refs:** [`../PERMISSIONS.md`](../PERMISSIONS.md) (roles/stability/audit) and [`../ARTIFACTS.md`](../ARTIFACTS.md) (artifact security model) remain the source of truth where cited; this SRS restates them as testable rows.

## 3. Document map

| File | Contents |
|------|----------|
| `README.md` (this) | Overview, architecture, roles & permission matrix, test strategy, conventions, traceability |
| [`backend-functional.md`](backend-functional.md) | All backend REST + MCP + worker requirements (`FR-` backend areas) |
| [`frontend-functional.md`](frontend-functional.md) | All frontend UI/UX requirements (`FR-UI-` areas) |
| [`non-functional-and-gaps.md`](non-functional-and-gaps.md) | Security/perf/i18n/a11y/persistence NFRs, **known gaps / unimplemented features**, test-id recommendations, QA runbook |

## 4. System architecture (under test)

Deployed via `docker-compose.yml` (dev) / `docker-compose.prod.yml`. Containers:

| Service | Container | Tech | Port | Role |
|---------|-----------|------|------|------|
| Frontend | `wiki-frontend-1` | Next.js (App Router) + React + SWR + Tailwind | 3000 | UI; calls backend |
| Backend | `wiki-backend-1` | FastAPI (async) + SQLAlchemy | 8000 | REST `/api/*` + MCP `/mcp` |
| Worker | `wiki-worker-1` | Celery (broker+backend = Redis) | — | Ingest plan/apply, lint passes |
| DB | `wiki-db-1` | Postgres 16 + `pgvector` | 5432 | System of record + 384-dim embeddings |
| Cache/broker | `wiki-redis-1` | Redis 7 | 6379 | Celery broker/result, caches |
| Doc processor | `wiki-mineru-1` | MinerU | — | PDF/Office → markdown (optional, `MINERU_ENABLED`) |

**Key invariants the tests rely on:**
- A page is **published/live** iff `current_revision_id IS NOT NULL`. List, graph, backlinks, search, and chat all filter on this — drafts are never indexed/searchable.
- Publishing is the **only** path that writes content to disk (vault mirror) and (re)builds `chunks` (embeddings) + outgoing `links`. Link resolution (`resolve_all_links`) runs after every publish/move/delete.
- **Auth modes:** `stub` (dev; `X-User-Email`/`X-User-Role` headers + `/api/auth/dev-login`) and `oidc` (prod; auth-code + PKCE). A static break-glass admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) works in both. App refuses to boot if `AUTH_MODE=oidc` with neither OIDC config nor a static admin.
- Session JWTs (HS256) carry **no `exp`** — sign-out is client-side only; there is no server session store/denylist.

## 5. Actors & roles

| Actor | Description |
|-------|-------------|
| Anonymous | Unauthenticated. Can only reach public artifacts and the login surface. |
| `reader` | Read published pages only. |
| `contributor` | Reader + create drafts + comment + flag + bookmark + upload sources. |
| `editor` | Contributor + review/publish proposals **within assigned categories** (or uncategorized) + move pages. |
| `admin` | Editor for all categories + lock pages + manage roles + delete pages + lint + admin artifact controls. |
| Agent user | `is_agent=True, owner_id=<human>`, defaults to `contributor`; created by the ingest pipeline; authors agent drafts. Legacy standalone agent users are deactivated at boot. |

Role ranking (`ROLE_RANK`): `reader(0) < contributor(1) < editor(2) < admin(3)`. Higher roles inherit lower abilities. `require_role(min)` compares ranks.

### 5.1 Permission matrix (restated from PERMISSIONS.md — each cell is testable)

| Capability | reader | contributor | editor | admin |
|------------|:------:|:-----------:|:------:|:-----:|
| Read published page | YES | YES | YES | YES |
| Search / graph / backlinks | YES | YES | YES | YES |
| Create draft / propose | no | YES | YES | YES |
| Comment | YES | YES | YES | YES |
| Flag a page | YES | YES | YES | YES |
| Resolve/dismiss a flag | no | no | YES | YES |
| Bookmark | YES | YES | YES | YES |
| Upload raw source | no | YES | YES | YES |
| Trigger ingest / apply / retry / dismiss | no | YES | YES | YES |
| Review proposal (accept/reject/request_changes) | no | no | YES (in-scope) | YES (all) |
| Move / rename page | no | no | YES | YES |
| Delete page | no | no | no | YES |
| Delete raw source | no | no | no | YES |
| Lock / unlock page (set stability) | no | no | no | YES |
| Change user role / deactivate / grant MCP | no | no | no | YES |
| Edit idea-file (agents.md) | no | no | no | YES |
| Run lint / dismiss-act lint issues | no | no | no | YES |
| Admin artifact list / hard-delete | no | no | no | YES |
| Create/use MCP token | YES* | YES* | YES* | YES* |

\* Any user can mint/use a personal MCP token **only if** `user.mcp_enabled=True` (admin-granted) and the global `MCP_ENABLED` switch is on; the token then acts with that user's role.

### 5.2 Page stability (publish gate)

| Stability | `submit_for_review` behavior | Who can publish a proposal |
|-----------|------------------------------|----------------------------|
| `open` | Auto-publishes immediately (HTTP path; no force-review option) | n/a (no queue) |
| `stable` (default) | Enters review queue | In-category editors + admins |
| `locked` | Enters review queue | **Admins only** |

Only admins change stability (`/lock`). Editor reviewing scope = rows in `category_editors`; an editor with zero rows can still review **uncategorized** pages. Agent/MCP drafts always `force_review=True` (never auto-publish, even on `open` pages).

## 6. Requirement ID scheme & conventions

- **`FR-<AREA>-<NNN>`** — functional requirement. Backend areas: `AUTH, USR, PAGE, REV, CMT, FLAG, BMK, SRCH, GRAPH, RAW, ING, MCP, MTOK, NOTIF, CHAT, ADMIN, LINT, ART`. Frontend areas are prefixed `UI-`: `SHELL, PAGE, PROP, REV, VER, TREE, MENU, MOVE, TABS, QS, SEARCH, KEYS, SRC, INGP, SCHEMA, LINT, MCP, NOTIF, GRAPH, GSET, CHAT, SET, THEME, I18N, AUTH, HELP, ART`.
- **`NFR-<AREA>-<NNN>`** — non-functional (SEC, PERF, I18N, A11Y, PERSIST).
- **`GAP-<NNN>`** — documented gap / unimplemented-but-referenced behavior. QA writes **negative** assertions for these (assert the absence / no-op), so they don't fail tests against a phantom feature.
- **Test levels:** `[unit]` (pure function, mock IO), `[API]` (HTTP integration against the backend, pytest + httpx/TestClient), `[component]` (React component render/interaction, RTL/jsdom), `[E2E]` (full browser, Playwright against the running stack).
- **Assertion hint:** each row ends with how to assert it (status code, response field, DOM selector/text, side-effect row). Selectors prefer existing stable anchors (`data-path`, `aria-label`, `.badge.<status>`, `.wiki-link.broken`, `.diff-add/.diff-del`); see the test-id recommendations in `non-functional-and-gaps.md`.

## 7. Test strategy & environment

### 7.1 Levels & tools
- **Backend `[unit]` + `[API]`:** `pytest` inside the backend container — `docker exec wiki-backend-1 pytest -v`. The repo already ships `backend/tests/test_artifacts.py`. API tests should use a transactional/disposable schema; the worker can be driven by calling task bodies directly (bypassing Celery `.delay`).
- **Frontend `[component]`:** React Testing Library + jsdom (Vitest/Jest).
- **`[E2E]`:** Playwright against `http://localhost:3000` with the full compose stack up. Use **stub auth mode** to set roles deterministically (the dev role `<select>` writes `wiki:role`/`wiki:email` to localStorage and reloads — the simplest E2E lever; or `POST /api/auth/dev-login` to mint a JWT of any role).

### 7.2 Test data & setup
- Boot with `SEED_EXAMPLES=true` for fixtures, or seed via the API: create users per role (dev-login), publish a small cross-linked page graph (for backlinks/graph/search), upload a raw source, and mint an MCP token.
- For role-gated UI, drive role via stub mode. For permission-gated API, set `X-User-Email` + `X-User-Role` headers (stub) or a `wt_*`/JWT bearer.
- Artifact security tests follow `ARTIFACTS.md §"Verifying the security checklist"`.

### 7.3 Coverage goals
- **100%** of `FR-*` rows have at least one automated test at the recommended level.
- Every `GAP-*` has a negative/no-op assertion so the gap is tracked, not silently "passing".
- Every role × capability cell in §5.1 has an allow test **and** a deny test.

## 8. Traceability

Each `FR-*` ID is globally unique and stable. A test should reference its ID in the test name/docstring (e.g., `test_FR_PAGE_003_draft_reader_403`). The QA agent should emit a coverage report mapping `FR-* -> test id(s) -> pass/fail`, surfaced back here as an appendix once the suite exists.

## 9. Known gaps (summary — full list with IDs in `non-functional-and-gaps.md`)

Highlights QA must encode as negative assertions rather than expected features:
- No version-diff UI and **no Restore/Revert** button (despite help text describing one).
- `mod+shift+]` / `mod+shift+[` (next/prev tab) are advertised but have **no handler** (no-op).
- Citation `[1]` markers render as **plain text in page bodies** (citations only activate in chat answers).
- **No rate limiting** anywhere; **no notifications unread-count endpoint** (derive from `?only_unread=true`).
- MCP auth **ignores `ApiToken.expires_at`** while `/api/*` enforces it.
- Several panels are **hardcoded English** (e.g. IngestPlanPreview) — i18n coverage is partial.
