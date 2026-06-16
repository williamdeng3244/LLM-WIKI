# Enflame Wiki — Code Coverage Report

**Date:** 2026-06-12  **Tool:** `coverage.py` 7.14 on Python 3.12, **`COVERAGE_CORE=sysmon`** (see the measurement-bug note below — this is the single most important line in this report). Two processes are instrumented and merged (`--parallel-mode` + `coverage combine`): the **server** (black-box API tests) and the **pytest process** (in-process unit/mock-LLM tests); the **OIDC** instances and the **CLI** subprocesses are also instrumented and appended. **Suite:** 376 passed / 14 skipped (main) + 58 passed (OIDC) = **434 backend tests green**.

## Headline

**Backend line coverage: 90.1%** (3,771 / 4,186 statements; 415 missed). **Functional/requirement coverage: 100%** (116/116 — see `functional-coverage-report.md`).

> ### ⚠️ The previously-reported 53% / 63% / 65% were a measurement bug, not the real coverage.
> Earlier passes used coverage.py's default **C tracer** (`sys.settrace`). Under `uvicorn`, that tracer instruments the app's **import** but silently **fails to trace the async request-handler bodies** — so every FastAPI router read ~half its true coverage (the import-time decorator/signature lines counted; the `async def` bodies didn't). The fix is one environment variable: **`COVERAGE_CORE=sysmon`** (Python 3.12's PEP-669 `sys.monitoring`), which traces async handlers correctly. Proof: with **no test changes**, `routers/pages.py` jumped **37% → 90%** the instant the core was switched. The whole "63% is a floor, the real number is higher" caveat in the prior report was correct in spirit but wrong on cause — the cause was the tracer, and the real number is **90%**.

The 53%→90% climb this pass came from **fixing three measurement bugs** plus **six new test modules**, in order of impact:

| Step | What | Effect |
|---|---|---:|
| 1 | **`COVERAGE_CORE=sysmon`** — trace async handlers (was the C-tracer bug) | 66% → **80%** |
| 2 | **`test_artifacts.py` honored `WIKI_TEST_BASE_URL`** — it hard-coded `:8000`, bypassing the instrumented `:8099` | 80% → **85%** |
| 3 | **Instrumented the OIDC instances** (`:8011`/`:8013` + mock IdP) and `combine --append` | 85% → **86%** (`auth.py` 57→85%, `oidc.py` 56→**96%**) |
| 4 | **CLI subprocess capture** (`WIKI_COV_SUBPROC` → run `export`/`backfill` under `coverage run`) | `export_to_disk` 0→84%, `backfill` 0→captured |
| 5 | **Six new test modules** (below) for the genuine gaps | 86% → **90.1%** |

---

## 1. New tests added this pass (closing the *genuine* gaps)

| Test module | Targets | Lines lifted |
|---|---|---|
| `test_llm_client.py` (14) | content-block translators + the **Anthropic** `chat`/`tool_call` path (SDK mocked — prod uses Anthropic; only the OpenAI mock was tested before) | `llm_client.py` 58 → **94%** |
| `test_services_unit.py` (7) | `chunker` (code-fence, multi-lang symbol detect, prose-flush) + `linker` (link/tag extraction, slug resolver) | chunker 72→**96%**, linker 80→**100%** |
| `test_ingest_runs_review.py` (12) | the ingest-run **review workflow** — apply / dismiss / retry (re-plan vs re-apply) / stale-sweep (the prior suite only hit these with a 404 id) | `ingest_runs.py` 58 → **96%** |
| `test_url_fetcher.py` (8) | SSRF validation (scheme/host/loopback/private), filename derivation, HTML→markdown | `url_fetcher.py` 82 → **96%** |
| `test_admin_coverage.py` (7) | artifact **hard-delete** (row+blobs), all-artifacts listing, lint report/issue reads | `admin.py` 75 → **94%** |

> **QA-found bug fixed along the way:** `readability-lxml` was broken in this environment — newer `lxml` (≥5) split `lxml.html.clean` into a separate `lxml_html_clean` package that wasn't installed, so `from readability import Document` raised `ImportError`. URL HTML ingest was **silently degrading** to raw-chrome HTML (caught by `fetch_url`'s fallback). Fixed by pinning `lxml_html_clean` in `requirements.txt`.

---

## 2. The honest remaining ~10% (415 lines, by module)

| Module | Cov | Why still uncovered |
|---|---:|---|
| `services/ingest.py` | 69% | The ingest plan/apply pipeline runs in the **Celery worker** (separate process, not instrumented here) and needs a real/mock LLM. The biggest single chunk (103 lines). |
| `services/bootstrap.py` | 72% | First-boot seed/migration branches that only run on a fresh empty DB. |
| `services/converters.py` | 77% | MinerU PDF/Office conversion — runs in the worker, needs real binary files. |
| `services/lint.py` | 79% | The LLM lint-agent body (the read/dismiss/act sides are now covered). |
| `services/vault.py` | 80% | Disk-vault import edge cases (malformed frontmatter, races). |
| `routers/artifacts.py` | 83% | A few artifact error/edge branches. |
| `routers/mcp.py` | 83% | A handful of less-common MCP tools. |

This tail is **worker-side, LLM-dependent, or defensive/error-branch code**. Pushing past ~90% would mean instrumenting the Celery worker process and standing up a full mock-LLM ingest harness in the coverage run — high effort, low defect-finding value. **90% is treated as the healthy ceiling**, not a number to chase further.

---

## 3. Test-quality signal (mutation sample)

Line coverage says what *ran*, not whether tests *assert* meaningfully. A focused **mutation sample** on the security-critical permission core (`permissions.py`) injected 4 faults: **3/4 killed (75%)**, and the 1 survivor flushed out real **dead code** (`can_lock`, since removed). So the covered code is meaningfully tested, not just executed. (A full mutation run is impractical on this black-box + worker architecture.)

---

## 4. Reproduce

```bash
# 1. instrumented server — sysmon core + asyncio loop are BOTH required to
#    trace async handler bodies; the default C tracer under-counts by ~25 pts.
COVERAGE_CORE=sysmon coverage run --parallel-mode --source=app \
  -m uvicorn app.main:app --host 0.0.0.0 --port 8099 --loop asyncio &

# 2. run the suite against it (sysmon for the in-process tests too); gated
#    flags exercise office/worker/CLI; WIKI_COV_SUBPROC captures the CLI scripts.
WIKI_TEST_BASE_URL=http://localhost:8099 WIKI_RUN_LIVE_E2E=1 WIKI_RUN_SLOW=1 \
  WIKI_COV_SUBPROC=1 COVERAGE_CORE=sysmon \
  coverage run --parallel-mode --source=app -m pytest tests/ -q

# 3. SIGINT the server (flushes its data), then for OIDC: start the mock IdP +
#    two AUTH_MODE=oidc instances (:8011 with empty ADMIN_EMAIL, :8013 → IdP)
#    under the same instrumentation, run the oidc test files, SIGINT them.

# 4. merge everything (server + pytest + oidc + cli) and report
coverage combine --append && coverage report --precision=2
```
