# Enflame Wiki — Functional Coverage Report

**Date:** 2026-06-11  **Basis:** the SRS (`docs/srs/backend-functional.md`, `frontend-functional.md`). Every automated test is named after the requirement id it verifies, so coverage maps **1:1** to the spec.

## Headline

**Functional (requirements) coverage: 116 / 116 = 100%** — every documented `FR-*` requirement now has at least one automated test named after it. Backend: **301 passing / 14 skipped / 0 failing** (315 collected; most recent run) + **8 E2E** passing. The 14 skips are 9 OIDC-integration tests (run only with the mock-IdP harness up) + 5 environment-preconditions. *(3 black-box chat tests additionally skip-with-reason when the env has no live LLM, so the pass/skip split varies by ±3 between runs; they never fail.)*

> **What "100%" means here — read this.** This is *requirements* coverage: every spec'd behavior has a test. The LLM-dependent features (ingest, lint, RAG chat) are exercised against an **OpenAI-compatible mock LLM** (`tests/mock_llm.py`) and the OIDC path against a **mock IdP** (`tests/mock_idp.py`). Those mocks prove the **plumbing/contract** deterministically — request translation, forced-tool-call parsing, the orchestration around the call (citation range-mapping, the 20-edit cap + `edit_id` stamping, apply idempotency, status finalization, kind/severity coercion, audit events). They deliberately say **nothing about a real model's output quality** — that requires an eval with a live model in staging. So "100% requirements" ≠ "the AI features are proven good"; it means every code path the spec describes is now tested.
>
> (Line/code coverage is a separate, lower number — see the **code-coverage report**. These mock-harness tests newly exercise previously-uncovered modules — `ingest`, `lint`, `rag`, `llm_client`, `url_fetcher` — so line coverage should rise meaningfully above the prior **53%**, but the exact figure needs a fresh combined measurement (the in-process tests run in the pytest process, the black-box ones against the server, so the two must be merged). 100% *line* coverage is explicitly **not** a goal — chasing it tests defensive/unreachable branches for little value.)

---

## 1. Coverage by functional area

| Area | Covered | % | Notes |
|---|---|---|---|
| FR-PAGE (pages) | 13 / 13 | 100% | ✅ |
| FR-REV (revisions) | 11 / 11 | 100% | ✅ restore, bearer-token, badge-clear |
| FR-ART (artifacts) | 7 / 7 | 100% | ✅ versions, access-log, bundle, viewer SEC, private-scope |
| FR-ADMIN | 6 / 6 | 100% | ✅ lint dismiss/act guards |
| FR-GRAPH / NOTIF / CMT / FLAG / USR | all | 100% | ✅ |
| FR-RAW (raw sources) | 12 / 12 | 100% | ✅ URL content-type allow-list (006) via a local fetch server |
| FR-MCP | 9 / 9 | 100% | ✅ all tools incl. update_artifact versioning + owner-scoped list (009) |
| FR-SRCH (search) | 5 / 5 | 100% | ✅ lexical ILIKE fallback (003) via a forced embedding failure |
| FR-AUTH (auth) | 16 / 16 | 100% | ✅ stub + login + full OIDC (PKCE, CSRF, success path, boot guard) + login-disabled 404 |
| FR-CHAT | 3 / 3 | 100% | ✅ citation range-mapping + empty-index (003, mock LLM) |
| FR-ING (ingest) | 9 / 9 | 100% | ✅ plan cap/edit_id, apply idempotency, status, MIME matrix, task callability (mock LLM) |
| FR-LINT | 2 / 2 | 100% | ✅ forced-tool pass + kind/severity coercion (mock LLM) |
| **Total** | **116 / 116** | **100%** | |

---

## 2. How the last 11 requirements were closed

These were previously "infra-blocked" (needed an LLM, the Celery worker, or a fetchable URL). They were closed with two in-process mock harnesses — the same playbook that took OIDC from 0→100% — plus a couple of direct unit tests:

**Mock LLM (`tests/mock_llm.py`) — an OpenAI-compatible server on 127.0.0.1 that the real `llm_client` calls; responses are canned per test.** Closes the 5 LLM-dependent requirements end-to-end:
- **RAG chat** `FR-CHAT-003` — citation markers `[n]` mapped only within `1..len(sources)`, out-of-range dropped; empty index → "no indexed content" + `citations=[]`.
- **Ingest plan** `FR-ING-005` — forced `submit_ingest_result` tool, 20-edit cap (overflow → `skipped_count`), stable `edit_id` stamping, `pending_review`.
- **Ingest apply** `FR-ING-007` — draft + agent-authored provenance per edit; **idempotent** re-apply (skips edits that already have provenance).
- **Ingest status** `FR-ING-008` — `done` / `partially_failed` / `failed` finalization (the mixed-edit case asserts `partially_failed`).
- **Lint pass** `FR-LINT-001` — forced `submit_lint_findings` tool, findings persisted read-only (never auto-edits), `planning → done`.

**Direct unit tests (no LLM/IdP needed):**
- `FR-ING-006` — the MIME→content-block matrix (text/json→text, image→image, pdf→document, office→hard error, unknown→unsupported, missing file→error), via `convert_via_mineru` monkeypatched off.
- `FR-ING-009` — the Celery task bodies are directly callable (`ping()→"pong"`), `max_retries=0`, documented names.
- `FR-LINT-002` — issue kind/severity coercion (unknown kind→`other`, unknown/absent severity→`medium`).
- `FR-SRCH-003` — the lexical `ILIKE` fallback (`score=0.5`) is forced by monkeypatching the query embedding to raise.
- `FR-RAW-006` — the URL content-type allow-list (html→markdown; `application/zip`→415), via a local content-type HTTP server with the SSRF guard relaxed for `127.0.0.1`.
- `FR-MCP-009` — `update_artifact` versioning + owner/admin gate + owner-scoped `list_my_artifacts` (now its own `test_FR_MCP_009_*`, no longer folded into the 008 name).

**OIDC** (`FR-AUTH-004/011/012/013/016`) remains covered by the mock-IdP harness (`tests/mock_idp.py`); its 9 integration tests skip in the default run unless that harness is up.

---

## 3. What this means for deployment

- **Every functional area is now at 100% requirements coverage** — pages, revisions, artifacts, admin, graph/notif/comment/flag/user, raw sources, MCP, search, auth (incl. OIDC), chat, ingest, lint — and the data/permission/workflow core is additionally locked by mutation-killing tests (see the code-coverage / mutation note).
- **The one thing automation here does *not* prove is AI output quality.** The ingest/lint/chat tests use a mock LLM, so they verify the pipeline is wired correctly, not that a real model produces good edits/answers/findings. That is a *model-evaluation* problem, not a coverage gap.
- **Before production:** the remaining real-world validation is a **staging eval of the AI features against a live model** (ingest edit quality, lint finding precision/recall, chat answer faithfulness) — judged, not asserted. Everything mechanical is covered.

---

## 4. Test inventory

- **Backend:** 301 passing / 14 skipped / 0 failing (315 collected) — across 18 test files, plus two in-process harness modules (`tests/mock_llm.py` OpenAI-compatible mock + `tests/_inproc.py` session/fixture helpers). Skips: 9 OIDC-callback integration tests (need an oidc-mode instance / mock-IdP harness) + 5 env-preconditions (out-of-band file delete, 50 MB upload, category-editor seed, MCP kill-switch, out-of-range approved-indices). The 3 black-box chat tests skip only when no live LLM is configured.
- **E2E:** 8 passing (app shell, propose→review→publish→search, version diff+restore, role gating, theme/language toggles, tabs, keyboard shortcuts).
- **Reproduce:** `docker exec wiki-backend-1 python -m pytest tests/ -q` · the LLM-dependent tests self-host the mock on `127.0.0.1` (no external services) · E2E via the dockerized Playwright command in `e2e/README.md`.
