# Backend Functional Requirements

Scope: FastAPI REST (`/api/*`), the MCP JSON-RPC server (`/mcp`), and the Celery
worker. Conventions and the role model are defined in [`README.md`](README.md).
Unless stated, every `/api/*` endpoint requires authentication (401 if no
principal; 403 if the resolved user is inactive).

---

## FR-AUTH — Authentication & session (`routers/auth.py`, `core/auth.py`)

- **FR-AUTH-001** — `GET /api/auth/config` returns `{mode, oidc_enabled, local_admin_enabled}` **without auth**; `oidc_enabled` true only when `mode=oidc` and issuer+client_id set; `local_admin_enabled` true only when admin email+password set. [API]
- **FR-AUTH-002** — `POST /api/auth/login` with the correct static-admin email+password returns `{token, user}` where `token` decodes (HS256) to `role=admin`; the admin `User` is upserted/promoted. [API]
- **FR-AUTH-003** — `POST /api/auth/login` with a wrong password returns **401**; uses timing-safe compare on both email and password. [API]
- **FR-AUTH-004** — `POST /api/auth/login` when no static admin is configured returns **404**. [API]
- **FR-AUTH-005** — `POST /api/auth/dev-login` is available **only when `AUTH_MODE=stub`** (else **404**); accepts `email`, optional `name`, `role` (default `contributor`); invalid role → **400**; creates the user if absent; returns `{token, user}` with the requested role. [API]
- **FR-AUTH-006** — Bearer resolution: a `wt_*` token is SHA-256-hashed and matched in `api_tokens`; a revoked or **expired** token is rejected (401) and a valid one stamps `last_used_at`. [API][unit]
- **FR-AUTH-007** — Bearer resolution: an `eyJ*` JWT is decoded with `JWT_SECRET`/HS256 to resolve the principal. [API][unit]
- **FR-AUTH-008** — Stub-mode header auth: with no Bearer and `AUTH_MODE=stub`, `X-User-Email` get-or-creates a user (role from `X-User-Role` if valid, else `contributor`). [API]
- **FR-AUTH-009** — `GET /api/auth/whoami` returns the current `UserOut` (id, email, name, role, is_agent, owner_id, mcp_enabled, is_active, preferences). [API]
- **FR-AUTH-010** — `PUT /api/auth/me/preferences` replaces `user.preferences` wholesale; a non-object body → **400**; a serialized body > 64 KB → **413**; the change is visible via whoami. [API]
- **FR-AUTH-011** — `GET /api/auth/oidc/login` (oidc mode) performs discovery (failure → **502**), sets a signed HttpOnly `wiki_oidc_state` cookie (max-age 600, SameSite=Lax, path `/api/auth`), and 302-redirects to the IdP. [API-mocked]
- **FR-AUTH-012** — `GET /api/auth/oidc/callback`: IdP `error` param → **400**; missing/expired state cookie → **400**; **state mismatch → 400 (CSRF)**; code-exchange failure → **502**; missing id_token → **502**; id_token validation failure (sig/iss/aud/exp or **nonce replay**) → **401**; no email claim → **400**. [API-mocked]
- **FR-AUTH-013** — On successful OIDC callback the user is upserted (admin if email matches `ADMIN_EMAIL`, else `DEFAULT_OIDC_ROLE`), an existing higher role is **never demoted**, the JWT is delivered to the frontend via URL **fragment** `#token=…`, and the state cookie is deleted. [API-mocked]
- **FR-AUTH-014** — `POST /api/auth/logout` clears the OIDC state cookie only (no server session store exists). [API]
- **FR-AUTH-015** — `GET/POST/DELETE /api/auth/tokens` manage general-purpose `wt_*` tokens: create supports `expires_in_days`; list includes revoked tokens; revoking a token not owned by the caller → **404**. [API]
- **FR-AUTH-016** — Boot guard: `AUTH_MODE=oidc` with neither full OIDC config nor a static admin makes the app refuse to start. [unit]

## FR-USR — Users & roles (`routers/users.py`)

- **FR-USR-001** — `GET /api/users` returns only **active** users ordered by name (deactivated/legacy agent users excluded). [API]
- **FR-USR-002** — `POST /api/users/{id}/role?role=` requires admin (else 403); invalid role string → **400**; missing user → **404**; writes `AuditLog action="user.role_change"` with `{from,to}`. [API]
- **FR-USR-003** — `POST /api/users/{id}/deactivate` requires admin; sets `is_active=False`; missing → 404; audits `user.deactivate`. [API]
- **FR-USR-004** — `POST /api/users/{id}/mcp-access?enabled=` requires admin; toggles `mcp_enabled`; audits `user.mcp_access_grant`/`…revoke`; afterwards a denied user's MCP calls return 403 (see FR-MCP-002). [API]

## FR-PAGE — Pages (`routers/pages.py`)

- **FR-PAGE-001** — `GET /api/pages` lists only **published** pages (`current_revision_id` not null), ordered by path; draft-only pages are absent; empty DB → `[]`. [API]
- **FR-PAGE-002** — `GET /api/pages/{path}` returns `PageOut` with the current revision body; a draft-only page returns `body=""` + null `current_revision_id`; missing page → **404**; no stability gate on read. [API]
- **FR-PAGE-003** — `POST /api/pages/draft` requires contributor+ (reader → **403**). [API]
- **FR-PAGE-004** — Draft create with `page_path` for a missing page → **404**; with `new_page.path` colliding with an existing page → **409**; with neither `page_path` nor `new_page` → **400**. [API]
- **FR-PAGE-005** — Draft create (new page) inserts a `Page` (status active, stability from spec, default `stable`) + audits `page.create_proposal`, then a `Revision(status=draft)` + audits `revision.create_draft`; the new page is **not** published (stays hidden from list/graph/search). [API]
- **FR-PAGE-006** — Draft create performs **no disk write, no reindex, no notification** (drafts are private). [API]
- **FR-PAGE-007** — `GET /api/pages/{path}/revisions` returns all revisions (any status) newest-first; missing page → 404. (Note: this list leaks other users' drafts — see GAP.) [API]
- **FR-PAGE-008** — `POST /api/pages/{path}/lock?locked=` requires **admin** (else 403); sets stability `locked` (true) or `stable` (false); audits `page.lock`/`page.unlock`; missing page → 404; unlock always lands on `stable` (never restores `open`). [API]
- **FR-PAGE-009** — `GET /api/pages/{path}/backlinks` returns published pages whose resolved `links.target_id` = this page, by path, de-duplicated; unresolved `[[broken]]` links and draft-only sources are excluded; missing page → 404. [API]
- **FR-PAGE-010** — `PATCH /api/pages/{path}/path` requires editor or admin (else 403); empty `new_path` → 400; `..` segment → 400 (traversal); `new_path == path` → 200 no-op (no audit/disk); collision → 409; success moves the disk file, updates `page.path`, audits `page.move{from,to}`, and re-resolves all links. [API]
- **FR-PAGE-011** — `DELETE /api/pages/{path}` requires **admin** (else 403); returns **204**; cascades to revisions/links/chunks/flags/comments/provenance/bookmarks; audits `page.delete`; re-resolves links so other pages' wikilinks to it become broken; deleting a page whose disk file is already gone still succeeds. [API]
- **FR-PAGE-012** — Path matching is **exact** for GET/revisions/backlinks/lock/comments/flags/bookmarks, but **forgiving** (`_resolve_page`, tries ±`.md`/±`/`) for move & delete. A page literally named `foo` is GET-404 while `foo.md` is delete-resolvable. [API]
- **FR-PAGE-013** — Empty `title`/`body` are accepted on draft create/update (no validation). [API]

## FR-REV — Revision / proposal lifecycle (`routers/revisions.py`, `services/workflow.py`)

State machine: `draft -> proposed -> accepted | rejected`; `request_changes` bounces `proposed -> draft`; a superseded prior accepted revision → `superseded`; `open`-stability pages skip `proposed`.

- **FR-REV-001** — `GET /api/revisions/my-drafts` returns the caller's `draft` revisions, newest-first; other statuses excluded. [API]
- **FR-REV-002** — `GET /api/revisions/review-queue` returns `proposed` revisions oldest-first; **admin** sees all; **editor** sees in-category + uncategorized; **reader/contributor** get `[]` (not 403). [API]
- **FR-REV-003** — `GET /api/revisions/{id}`: missing → 404; a `draft` not owned by the caller → **403**; proposed/accepted/rejected visible to any authenticated user. [API]
- **FR-REV-004** — `GET /api/revisions/{id}/provenance` returns the agent grounding row; a human (no-provenance) revision → **404**. [API]
- **FR-REV-005** — `POST /api/revisions/{id}/submit`: non-author → 403; non-draft → 409. On an `open` page → publishes immediately (status `accepted`, page current updated). On a `stable`/`locked` page → status `proposed`, audits `revision.propose`, notifies reviewers (one `review_requested` per in-scope editor + admin, excluding author). [API]
- **FR-REV-006** — `POST /api/revisions/{id}/review` body `{decision, comment?, reject_reason?, reject_notes?}`: invalid decision → 400; caller fails `can_review(page)` → 403 (admins always; editors not on `locked` pages; in-scope editors otherwise); non-proposed → 409. [API]
- **FR-REV-007** — `review` accept → publishes (see FR-REV-010); reject → status `rejected`, audits `revision.reject`, notifies author `revision_rejected`, and (agent revision only) persists `reject_reason`/`reject_notes` onto provenance; request_changes → status `draft`, audits `revision.request_changes`, notifies author `changes_requested`. [API]
- **FR-REV-008** — Any terminal review decision marks the matching `review_requested` notifications read (no stuck badge). [API]
- **FR-REV-009** — `PUT /api/revisions/{id}` edits a draft: non-author → 403; non-draft → 409; updates fields with **no audit/reindex**. [API]
- **FR-REV-010** — Publish (`_publish`, via accept or open-page submit) supersedes the prior current revision, sets the revision `accepted`, updates `page.current_revision_id`, syncs page title/tags, mirrors to disk (`.md`), rebuilds chunks+embeddings+outgoing links, audits `revision.publish`, notifies the author `revision_accepted` only if reviewer≠author, and re-resolves links. An embedding failure still publishes (chunks land with NULL embedding). [API]
- **FR-REV-011** — `POST /api/revisions/{id}/restore` restores a published version: it recreates the chosen revision's title/body/tags as a fresh draft (rationale `Restore of rev #N`) and runs it through `submit_for_review`, so it honours the page's trust dial — an **open** page republishes immediately (returns `accepted`, see FR-REV-010), a **stable**/**locked** page enters the review queue (returns `proposed`, see FR-REV-005). Only `accepted`/`superseded` revisions are restorable (else **400**); a reader (fails `can_propose`) → **403**; unknown revision → **404**. (Closes GAP-002 / GAP-004.) [API]

## FR-CMT / FR-FLAG — Comments & flags (`routers/comments.py`)

- **FR-CMT-001** — `GET /api/pages/{path}/comments` returns comments ASC; missing page → 404; comments are **flat** (no threading). [API]
- **FR-CMT-002** — `POST /api/pages/{path}/comments` is allowed for **any** authenticated user incl. reader; persists a `Comment`; creates **no notification**; missing page → 404; empty body accepted. [API]
- **FR-FLAG-001** — `GET /api/pages/{path}/flags` returns flags DESC; missing page → 404. [API]
- **FR-FLAG-002** — `POST /api/pages/{path}/flags` (any authenticated user) with `kind ∈ {incorrect, outdated, needs_source, duplicate, other}` creates a flag (status `open`) + audits `flag.raise{kind}`; invalid kind → **422**; missing page → 404. [API]
- **FR-FLAG-003** — `POST /api/flags/{id}/resolve?dismiss=` requires editor or admin (else 403; **no category scoping**); sets status `resolved`/`dismissed` + resolver fields; missing → 404; **writes no audit row** and **no notification** to the raiser. [API]

## FR-BMK — Bookmarks (`routers/bookmarks.py`)

- **FR-BMK-001** — `GET /api/bookmarks` returns the caller's bookmarks (page_path/title joined), newest-first. [API]
- **FR-BMK-002** — `POST /api/bookmarks/{path}` is idempotent (returns the existing bookmark if present, never duplicates); missing page → 404. [API]
- **FR-BMK-003** — `DELETE /api/bookmarks/{path}` is idempotent → **204** even when the page or bookmark doesn't exist. [API]

## FR-SRCH — Search (`routers/search.py`, `services/rag.py`)

- **FR-SRCH-001** — `GET /api/search?q=&k=10` requires `q` (min length 1; empty → **422**). [API]
- **FR-SRCH-002** — Primary ranking is **semantic** (pgvector cosine over `all-MiniLM-L6-v2` 384-dim embeddings; `score = 1 - distance`, ascending distance, limit `k`). [API]
- **FR-SRCH-003** — **Lexical fallback**: if embedding fails or the vector query returns zero rows, results come from `content ILIKE %q%` (limit `k`, constant `score=0.5`). There is **no Postgres FTS**. [API][unit]
- **FR-SRCH-004** — Results are scoped to **published pages only**; draft content never appears; `snippet` truncated to 240 chars. [API]
- **FR-SRCH-005** — No category/tag/stability filters exist; `k` is uncapped; `k=0` → `[]`; empty index → `[]`. [API]

## FR-GRAPH — Graph (`routers/graph.py`)

- **FR-GRAPH-001** — `GET /api/graph` returns `{nodes, edges}`; nodes = **published** pages with `{id=path, title, category, tags, backlinks}`; `category` falls back to the first path segment when unset. [API]
- **FR-GRAPH-002** — Edges are emitted once per unordered pair of resolved links (undirected dedupe); an edge whose endpoint isn't a published page is skipped; self-links collapse; unresolved links contribute no edge and don't raise `backlinks`. [API]
- **FR-GRAPH-003** — Empty wiki → `{nodes:[], edges:[]}`; an orphan page has `backlinks==0` and appears in no edge. [API]

## FR-RAW — Raw sources (`routers/raw_sources.py`, `services/url_fetcher.py`)

Immutable input: bytes are stored under a server-generated UUID filename (path-traversal-safe); only metadata is editable. Hard size cap **50 MB**.

- **FR-RAW-001** — `GET /api/raw` lists all sources, newest `uploaded_at` first. [API]
- **FR-RAW-002** — `POST /api/raw` (multipart `file`, optional `title`/`description`) stores the file, returns `RawSourceOut` (status `pending`), audits `raw.upload{filename,size}`; **reader → 403**. [API]
- **FR-RAW-003** — Upload streams in 1 MB chunks and aborts with **413** (+ deletes the partial file) when cumulative size > 50 MB. [API]
- **FR-RAW-004** — Upload MIME resolution: trust a specific client `Content-Type`; if blank or `application/octet-stream`, guess from the filename extension. The resolved type is then checked against an **upload-time allow-list** (`is_supported_ingest_mime`: text/*, JSON/YAML, PDF, the three MinerU Office types, image/*) — an unsupported type is rejected **415** up front (and its temp file removed), mirroring URL-import. Supported types are stored as before. (GAP-011.) [API]
- **FR-RAW-005** — `POST /api/raw/url` (body `{url, title?, description?}`): blank url → **400**; non-http(s) → 400; an IP that is private/loopback/link-local/reserved/multicast → **403 (SSRF)** unless `URL_INGEST_ALLOW_PRIVATE=true`; unresolvable host → 400; unsupported content-type → **415**; > 50 MB → 413; timeout → **504**; upstream HTTP error / 5xx → **502**. On success stores the fetched bytes, sets `source_url`, audits `raw.upload.url`. [API-mocked][unit]
- **FR-RAW-006** — URL content-type allow-list (prefix): `text/html`, `text/markdown`, `text/plain`, `application/pdf`; HTML is converted to markdown (readability + markdownify) and stored as `text/markdown`. [unit]
- **FR-RAW-007** — `PATCH /api/raw/{id}` edits title/description only; reader → 403; missing → 404; no audit row. [API]
- **FR-RAW-008** — `GET /api/raw/{id}/download` returns the original bytes; row missing → 404; file gone from disk → **410**. [API]
- **FR-RAW-009** — `GET /api/raw/{id}/pending-drafts` returns draft/proposed agent revisions linked to the source (drops off after publish/reject). [API]
- **FR-RAW-010** — `GET /api/raw/{id}/runs` returns the source's ingest-run history, newest first. [API]
- **FR-RAW-011** — `POST /api/raw/{id}/ingest`: reader → 403; missing → 404; supersedes any in-flight run for the source, creates an `IngestRun(status=planning)`, sets source `ingesting`, audits `raw.ingest.queue`, and enqueues `ingest_plan`. [API]
- **FR-RAW-012** — `DELETE /api/raw/{id}` requires **`role==admin` exactly** (editors → 403); deletes the disk file (best-effort) and the row (cascades runs), audits `raw.delete`; returns 204. [API]

## FR-ING — Ingest pipeline (`routers/ingest_runs.py`, `services/ingest.py`, `worker.py`)

Lifecycle: `planning -> pending_review -> applying -> done`; branches `dismissed`, `superseded`, `failed`, `partially_failed`.

- **FR-ING-001** — `GET /api/ingest-runs/{id}` returns the run and lazily runs the **stale-run watchdog**: a `planning`/`applying` run older than 45 min → `failed` (synthetic error), source flipped to `failed`. [API]
- **FR-ING-002** — `POST /api/ingest-runs/{id}/apply` body `{approved_indices?}`: reader → 403; missing → 404; non-`pending_review` → **409**; an out-of-range index → **400**; success sets `applying`, audits `raw.ingest.approve`, enqueues `ingest_apply`. [API]
- **FR-ING-003** — `POST /api/ingest-runs/{id}/retry`: reader → 403; allowed only for `planning|applying|failed|partially_failed` (else 409); if `plan_json is null` re-runs **plan**, else re-runs **apply** (idempotent); audits `raw.ingest.retry`. [API]
- **FR-ING-004** — `POST /api/ingest-runs/{id}/dismiss`: reader → 403; non-`pending_review` → 409; status → `dismissed`, source → `failed`, audits `raw.ingest.dismiss`; the plan is retained. [API]
- **FR-ING-005** — Plan phase reads the source into a provider-neutral block, gathers context (directory-scan retrieval, top-8 focus pages), injects ≤6 recent rejection examples (90-day window), forces the `submit_ingest_result` tool, caps at **20 edits** (overflow → `skipped_count`), stamps each edit with an `edit_id`, persists `plan_json`+`summary`, status `pending_review`, audits `raw.ingest.plan`. On error → run+source `failed`, audits `raw.ingest.failed`. [unit][API]
- **FR-ING-006** — MIME→block matrix: text/json/yaml → text; PDF → MinerU markdown or native document block; docx/pptx/xlsx → MinerU markdown, else a hard error if MinerU disabled; image → image block; anything else → "Unsupported MIME type" error; file missing on disk → error. [unit]
- **FR-ING-007** — Apply phase gets-or-creates the per-owner **ingest agent user** (`is_agent=True`, contributor), is **idempotent** (skips edits whose `edit_id` already has provenance), validates each edit (non-empty path/title/body; existing-page kinds require the page to exist), creates a draft + `submit_for_review(force_review=True)` per approved edit, persists `RevisionProvenance(is_agent_authored=True)` with sanitized `source_refs`, and never aborts the run on a per-edit error. [unit][API]
- **FR-ING-008** — Final status: `failed_count==0 → done`; `applied_count==0 → failed`; else `partially_failed`; audits `raw.ingest.done` with first 5 errors; source notes updated. [unit]
- **FR-ING-009** — Worker tasks (`ingest_plan`, `ingest_apply`, `run_lint_pass`, `ping`) each open and dispose their own engine inside `asyncio.run`, `max_retries=0`; task bodies are directly callable in tests. [unit]

## FR-MCP — MCP server & tools (`routers/mcp.py`, `POST /mcp`)

Single-POST JSON-RPC 2.0; auth = personal MCP bearer token acting as the human owner; protocol version `2024-11-05`.

- **FR-MCP-001** — Global kill switch: any `/mcp` POST with `MCP_ENABLED=false` → **503**. [API]
- **FR-MCP-002** — Auth: missing/empty bearer → 401; unknown/revoked token → 401; user missing/inactive → 401; `user.mcp_enabled=false` → **403**; valid token stamps `last_used_at`. (Note: MCP **ignores `expires_at`** — see GAP.) [API]
- **FR-MCP-003** — JSON-RPC dispatch: parse error → `-32700`; non-dict body → `-32600`; unknown method/tool → `-32601`; `initialize` returns protocol/capabilities/serverInfo; `tools/list` returns the 10-tool catalogue; `resources/list`+`prompts/list` → empty arrays; uncaught error → `-32603`. [API]
- **FR-MCP-004** — Tool-level `ValueError`/`PermissionError` are returned as a **successful** RPC result with `{isError:true, content:[…"Error: …"]}` (not a JSON-RPC error). [API]
- **FR-MCP-005** — `search_wiki(query, limit 1–50)` returns published-page hits (draft content absent). [API]
- **FR-MCP-006** — `list_pages(category?)`, `get_page(path)` (missing → isError), `list_backlinks(path)`, `list_my_drafts`, `list_review_queue` (filtered by `can_review`). [API]
- **FR-MCP-007** — `create_draft(title, body, page_path XOR new_page_path, …)` requires `can_propose` (reader token → isError); creates a draft + `submit_for_review(force_review=True)` + agent provenance + audits `mcp.create_draft`; both/neither page target → isError. [API]
- **FR-MCP-008** — `publish_artifact(name, body, mime_type=text/html, visibility=wiki, expires_in_days?)` creates an artifact owned by the caller; bad MIME → error; `visibility=public` while `ARTIFACTS_ALLOW_PUBLIC=false` → error/403; body > cap → 413/error. [API]
- **FR-MCP-009** — `update_artifact(short_id, body, mime_type?)` requires owner or admin (else PermissionError); adds a new version. `list_my_artifacts(limit 1–100)` is owner-scoped and excludes soft-deleted. [API]

## FR-MTOK — MCP tokens (`routers/mcp_tokens.py`)

- **FR-MTOK-001** — `GET /api/mcp-tokens` lists the caller's **active** tokens (revoked hidden). [API]
- **FR-MTOK-002** — `POST /api/mcp-tokens` (`{name}`): `MCP_ENABLED=false` → 503; `user.mcp_enabled=false` → 403; returns a one-time `raw_token` (`wt_…`), stores only the SHA-256 hash, sets **no expiry**, audits `mcp_token.create`. [API]
- **FR-MTOK-003** — `DELETE /api/mcp-tokens/{id}`: not owned/missing → 404; already revoked → `{ok:true, already_revoked:true}`; else sets `revoked_at`, audits `mcp_token.revoke`. [API]

## FR-NOTIF — Notifications (`routers/notifications.py`)

- **FR-NOTIF-001** — `GET /api/notifications?only_unread=` returns the caller's notifications newest-first (limit 100). The unread badge count comes from the dedicated FR-NOTIF-005 endpoint. [API]
- **FR-NOTIF-002** — `POST /api/notifications/{id}/read`: not owned/missing → 404; else `{ok:true}`. [API]
- **FR-NOTIF-003** — `POST /api/notifications/read-all` marks all the caller's unread as read. [API]
- **FR-NOTIF-004** — Event-driven creation: `review_requested` (on submit, to reviewers), `revision_accepted` (on publish, to author if reviewer≠author), `revision_rejected`, `changes_requested`; a terminal decision auto-marks the matching `review_requested` read. [API]
- **FR-NOTIF-005** — `GET /api/notifications/unread-count` returns `{"unread": <int>}` — the caller's exact unread count straight from the DB (not capped at the 100-row list limit). Scoped to the caller (never leaks other users' counts); agrees with the `only_unread=true` list length; drops to 0 after `read-all`; anon → 401. (Closes GAP-005.) [API]

## FR-CHAT — Chat / RAG (`routers/chat.py`)

- **FR-CHAT-001** — `POST /api/chat` (`{message, history, mode}`) requires authentication (401 otherwise); works for both JWT and `wt_*` bearer. [API]
- **FR-CHAT-002** — `mode="wiki"` → page-level synthesis (seed pages + 1-hop wikilink expansion, page-granular citations); any other mode → chunk-level RAG (k=8). Returns `{answer, citations[]}` as a **single JSON body** (not SSE/streamed). [API]
- **FR-CHAT-003** — Grounding is restricted to published pages; only citation markers `[n]` the model emits within `1..len(sources)` are mapped to citations; out-of-range markers are dropped; an empty index returns a "no indexed content" answer with `citations=[]`. [API-mocked]

## FR-ADMIN — Admin (`routers/admin.py`)

All require `role==admin` (403 otherwise) except FR-ADMIN-001.

- **FR-ADMIN-001** — `GET /api/admin/idea-file` returns the agents.md playbook + `can_edit` (true only for admin); auto-creates the file with a default if absent; readable by any authenticated user. [API]
- **FR-ADMIN-002** — `PUT /api/admin/idea-file` (admin) overwrites the playbook and audits `schema.update{size}`; non-admin → 403. [API]
- **FR-ADMIN-003** — `POST /api/admin/lint/run` (admin): a report already in `planning` → **409**; else creates `LintReport(planning)`, audits `lint.start`, enqueues `run_lint_pass`. [API]
- **FR-ADMIN-004** — `GET /api/admin/lint/reports`, `…/{id}`, `…/{id}/issues` (severity desc) return lint data (admin). [API]
- **FR-ADMIN-005** — `POST /api/admin/lint/issues/{id}/dismiss` (`{note?}`) → status `dismissed` + dismiss fields, audits `lint.dismiss_issue`; `…/act` transitions only `open → acted` (no-op otherwise, no audit). [API]
- **FR-ADMIN-006** — `GET /api/admin/artifacts` (admin) lists ALL artifacts incl. soft-deleted (limit clamp 1–500); `DELETE /api/admin/artifacts/{sid}` hard-deletes rows + blobs idempotently, audits `artifact.hard_delete`. [API]

## FR-LINT — Lint engine (`services/lint.py`, model `models/lint.py`)

- **FR-LINT-001** — A lint pass reads the whole wiki snapshot + the playbook and returns ≤100 findings via a forced tool; the agent **never auto-edits**. Report lifecycle `planning -> done | failed`; done audits `lint.done`, failure audits `lint.failed`. [unit]
- **FR-LINT-002** — Issue kinds: `orphan, broken_link, conflict, stale, source_drift, other` (unknown coerced to `other`); severity `low|medium|high` (unknown → medium); status `open -> dismissed | acted`. [unit]

## FR-ART — Artifacts REST + security (`routers/artifacts.py`, `artifact_viewer.py`; see `../ARTIFACTS.md`)

Visibility: `private` (owner/admin only), `wiki` (any signed-in user, default), `public` (anyone, gated by `ARTIFACTS_ALLOW_PUBLIC`). Body cap `ARTIFACTS_MAX_BODY_BYTES` (10 MiB default).

- **FR-ART-001** — `POST /api/artifacts` (multipart) and `POST /api/artifacts/from-page/{path}` create an artifact owned by the caller; body > cap → **413**; bad MIME (not html/markdown/plain) → 415; `visibility=public` while the flag is off → **403**. [API]
- **FR-ART-002** — `POST /api/artifacts/{sid}/versions` adds a version (owner or admin); `GET /api/artifacts` lists the caller's own; `GET /api/artifacts/{sid}` returns metadata; `PATCH` renames / changes visibility / expiry; `DELETE` soft-deletes. [API]
- **FR-ART-003** — `GET /api/artifacts/{sid}/access-log` returns viewer rows (owner-readable). Every successful viewer shell render records a row with the **viewer's** `user_id`. [API]
- **FR-ART-004** — `POST /api/artifacts/bundle` accepts a zipped directory (entry `index.html`), served at `/a/<sid>/<path>`, path-traversal-safe (only exact archive members). [API]
- **FR-ART-005 (SEC)** — The viewer `/a/<sid>` returns a **generic 404** for missing/deleted/expired/over-private artifacts (existence not leaked); an unauthenticated request for a non-public artifact → **302 → /login?next=/a/<sid>**. [API]
- **FR-ART-006 (SEC)** — HTML artifacts load in an iframe with **exactly** `sandbox="allow-scripts allow-popups allow-forms"` (no `allow-same-origin`); the `/a/<sid>/raw` response carries the documented CSP; the shell sets `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`, `Cache-Control: private, no-store`. [API]
- **FR-ART-007 (SEC)** — `visibility=private` is owner-only — a different signed-in user gets the generic 404, not the body. [API]
