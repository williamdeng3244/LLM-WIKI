"""Raw-source ingest vertical — covers FR-RAW-* (upload / URL import / patch /
download / runs / ingest trigger / delete) and FR-ING-* (apply / retry /
dismiss permission + state-guard codes).

Black-box integration against the live backend on :8000 in stub auth mode,
using the shared conftest fixtures. Every test maps to an SRS requirement id
(docs/srs/backend-functional.md).

NOTE on the ingest worker: triggering ingest creates an IngestRun in
``planning`` and enqueues a Celery ``ingest_plan`` task. We never wait for the
LLM/worker to complete — we assert only the synchronous contract (run created,
status ``planning``) and the state-guard codes that hold while the run is still
``planning`` (e.g. apply/dismiss on a non-``pending_review`` run → 409).
Anything that needs a *completed* plan is skipped-with-reason, never faked.
"""
from __future__ import annotations

import pytest

from tests.conftest import unique_path


# ── small local helpers ─────────────────────────────────────────────────────

def _upload(client, *, title: str = "", description: str = "",
            filename: str = "note.txt", content: bytes = b"hello raw world",
            content_type: str = "text/plain"):
    """POST /api/raw as multipart. Returns the raw httpx.Response."""
    files = {"file": (filename, content, content_type)}
    data = {}
    if title:
        data["title"] = title
    if description:
        data["description"] = description
    return client.post("/api/raw", files=files, data=data)


def _upload_ok(client, **kw) -> dict:
    """Upload and assert a 2xx, returning the RawSourceOut json."""
    r = _upload(client, **kw)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _trigger_ingest(client, source_id: int):
    return client.post(f"/api/raw/{source_id}/ingest")


# ── FR-ING-005/006/007/008/009 + FR-RAW-006: in-process pipeline tests ───────
#
# The black-box tests below stop at the synchronous contract (run created in
# `planning`) because there is no live LLM/worker. These complete the actual
# plan→apply pipeline by driving the real Celery task bodies in-process against
# tests/mock_llm (OpenAI-compatible), and cover the deterministic no-LLM bits
# (MIME→block matrix, URL content-type allow-list, task callability) directly.
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

from sqlalchemy import select

import app.services.ingest as ingest
import app.services.url_fetcher as url_fetcher
import app.worker as worker
from app.core.config import settings
from app.models import IngestRun, IngestRunStatus, RawSource, RevisionProvenance
from tests import mock_llm
from tests._inproc import mock_llm_server, run, session_scope  # noqa: F401
from tests.conftest import uid


def _make_run(source_id: int, trig_uid: int) -> int:
    async def _go():
        async with session_scope() as s:
            ir = IngestRun(
                raw_source_id=source_id, triggered_by_id=trig_uid,
                status=IngestRunStatus.planning,
            )
            s.add(ir)
            await s.commit()
            return ir.id
    return run(_go())


def _valid_edit(path: str, ref: dict) -> dict:
    return {
        "kind": "create_new", "path": path, "title": f"T {path}",
        "body": f"Body for {path}.", "rationale": "mock", "source_refs": [ref],
    }


def test_FR_ING_009_worker_tasks_are_directly_callable():
    """FR-ING-009 — the Celery task bodies are directly callable in tests, set
    max_retries=0, and carry their documented names. ping() round-trips."""
    assert worker.ping() == "pong"
    for task, name in [
        (worker.ingest_plan, "app.worker.ingest_plan"),
        (worker.ingest_apply, "app.worker.ingest_apply"),
        (worker.run_lint_pass, "app.worker.run_lint_pass"),
    ]:
        assert task.name == name
        assert task.max_retries == 0


def test_FR_ING_006_mime_to_block_matrix(monkeypatch):
    """FR-ING-006 — the MIME→content-block dispatch: text/json→text, image→image,
    pdf→native document block (MinerU off), office→hard error, anything
    else→unsupported, missing file→error."""
    async def _no_mineru(*a, **k):
        return None
    monkeypatch.setattr(ingest, "convert_via_mineru", _no_mineru)

    created: list = []

    def _rs(mime: str, content: bytes) -> RawSource:
        disk = f"ingest-mime-{uuid.uuid4().hex}.bin"
        p = settings.raw_path / disk
        p.write_bytes(content)
        created.append(p)
        return RawSource(
            title="m", original_filename="src.bin", disk_filename=disk,
            mime_type=mime, size_bytes=len(content),
        )

    try:
        for mime, content, expect in [
            ("text/plain", b"plain text", "text"),
            ("application/json", b'{"k": 1}', "text"),
            ("image/png", b"\x89PNG\r\n\x1a\n", "image"),
            ("application/pdf", b"%PDF-1.4 minimal", "document"),
        ]:
            block, err = run(ingest._read_raw_source_block(_rs(mime, content)))
            assert err is None and block and block["type"] == expect, (mime, block, err)

        # Office formats need MinerU; with it off → a hard, explanatory error.
        block, err = run(ingest._read_raw_source_block(_rs(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            b"PK\x03\x04")))
        assert block is None and err and "MinerU" in err

        # An unknown type → unsupported.
        block, err = run(ingest._read_raw_source_block(_rs("application/zip", b"PK\x03\x04")))
        assert block is None and err and "Unsupported MIME" in err

        # Missing file on disk → error (not a crash).
        missing = RawSource(
            title="m", original_filename="gone.txt",
            disk_filename=f"missing-{uuid.uuid4().hex}.txt",
            mime_type="text/plain", size_bytes=0,
        )
        block, err = run(ingest._read_raw_source_block(missing))
        assert block is None and err and "missing" in err.lower()
    finally:
        for p in created:
            p.unlink(missing_ok=True)


def test_FR_ING_005_plan_caps_edits_and_stamps_edit_ids(contributor, mock_llm_server):
    """FR-ING-005 — the plan phase forces the submit_ingest_result tool, caps at
    MAX_EDITS=20 (overflow → skipped_count), stamps a stable edit_id on each
    edit, persists plan_json + summary, and lands status=pending_review."""
    src = _upload_ok(contributor, title="plan-src",
                     content=b"Source text for the plan phase.")
    run_id = _make_run(src["id"], uid(contributor))

    # 22 edits → exercises the 20-cap (skipped_count == 2).
    mock_llm.STATE["tool_args"] = {
        "summary": "Mock plan summary.",
        "edits": [_valid_edit(f"mock/plan/{i}", {"quote_or_excerpt": "q"}) for i in range(22)],
    }
    worker.ingest_plan(run_id)

    async def _check():
        async with session_scope() as s:
            r = await s.get(IngestRun, run_id)
            return r.status, r.edits_count, r.skipped_count, r.plan_json, r.summary
    status, edits_count, skipped, plan, summary = run(_check())

    assert status == IngestRunStatus.pending_review, status
    assert edits_count == 22 and skipped == 2, (edits_count, skipped)
    assert len(plan["edits"]) == 20, "capped to MAX_EDITS"
    assert all(e.get("edit_id") for e in plan["edits"]), "every edit gets a stable edit_id"
    assert summary == "Mock plan summary."


def test_FR_ING_007_apply_creates_drafts_idempotently(
    contributor, mock_llm_server,
):
    """FR-ING-007 — apply creates a draft + agent-authored provenance per
    approved edit, is idempotent on re-run (skips edits that already have
    provenance), and (all edits ok) finalizes status → done."""
    src = _upload_ok(contributor, title="apply-src", content=b"Source text for apply.")
    run_id = _make_run(src["id"], uid(contributor))

    base = f"mock/apply/{uuid.uuid4().hex}"
    mock_llm.STATE["tool_args"] = {
        "summary": "Mock apply plan.",
        "edits": [
            _valid_edit(f"{base}/a", {"quote_or_excerpt": "q1"}),
            _valid_edit(f"{base}/b", {"location": "§2"}),
        ],
    }
    worker.ingest_plan(run_id)
    worker.ingest_apply(run_id)

    async def _state():
        async with session_scope() as s:
            r = await s.get(IngestRun, run_id)
            provs = (await s.execute(
                select(RevisionProvenance).where(RevisionProvenance.ingest_run_id == run_id)
            )).scalars().all()
            return (r.status, r.applied_count, r.failed_count,
                    len(provs), all(p.is_agent_authored for p in provs))
    status, applied, failed, nprov, all_agent = run(_state())

    assert status == IngestRunStatus.done, status
    assert applied == 2 and failed == 0, (applied, failed)
    assert nprov == 2 and all_agent, "each applied edit gets agent-authored provenance"

    # Idempotency: a second apply must not create duplicate drafts.
    worker.ingest_apply(run_id)

    async def _recount():
        async with session_scope() as s:
            return len((await s.execute(
                select(RevisionProvenance).where(RevisionProvenance.ingest_run_id == run_id)
            )).scalars().all())
    assert run(_recount()) == 2, "re-apply is idempotent — no duplicate provenance/drafts"


def test_FR_ING_008_final_status_partially_failed_on_mixed_edits(
    contributor, mock_llm_server,
):
    """FR-ING-008 — the final status reflects per-edit outcomes: one applicable
    edit + one invalid edit (empty body) → applied_count>0 AND failed_count>0,
    so the run finalizes as partially_failed (not done, not failed)."""
    src = _upload_ok(contributor, title="mixed-src", content=b"Mixed source.")
    run_id = _make_run(src["id"], uid(contributor))

    base = f"mock/mixed/{uuid.uuid4().hex}"
    mock_llm.STATE["tool_args"] = {
        "summary": "Mixed plan.",
        "edits": [
            _valid_edit(f"{base}/ok", {"quote_or_excerpt": "q"}),
            {"kind": "create_new", "path": f"{base}/bad", "title": "Bad",
             "body": "", "rationale": "r", "source_refs": [{"quote_or_excerpt": "q"}]},
        ],
    }
    worker.ingest_plan(run_id)
    worker.ingest_apply(run_id)

    async def _state():
        async with session_scope() as s:
            r = await s.get(IngestRun, run_id)
            return r.status, r.applied_count, r.failed_count
    status, applied, failed = run(_state())

    assert status == IngestRunStatus.partially_failed, status
    assert applied == 1 and failed == 1, (applied, failed)


# -- FR-RAW-006: URL content-type allow-list (needs a fetchable host) ----------

class _CTHandler(BaseHTTPRequestHandler):
    """Serves a body with a content-type chosen by the request path."""
    ROUTES = {
        "/html": ("text/html; charset=utf-8",
                  b"<html><body><h1>Hi</h1><p>Body text here.</p></body></html>"),
        "/txt": ("text/plain", b"just text"),
        "/pdf": ("application/pdf", b"%PDF-1.4 minimal"),
        "/evil": ("application/zip", b"PK\x03\x04"),
    }

    def log_message(self, *a):
        return

    def do_GET(self):  # noqa: N802
        ct, body = self.ROUTES.get(self.path, ("application/octet-stream", b""))
        self.send_response(200)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def test_FR_RAW_006_url_content_type_allow_list():
    """FR-RAW-006 — fetch_url accepts only text/html, text/markdown, text/plain,
    application/pdf (prefix match); HTML is converted to markdown; an
    unsupported content type is rejected with 415."""
    from fastapi import HTTPException

    srv = ThreadingHTTPServer(("127.0.0.1", 0), _CTHandler)
    Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    saved = settings.url_ingest_allow_private
    settings.url_ingest_allow_private = True  # let 127.0.0.1 past the SSRF guard
    try:
        # HTML → converted to markdown.
        res = run(url_fetcher.fetch_url(f"http://127.0.0.1:{port}/html"))
        assert res.mime_type == "text/markdown", res.mime_type
        assert b"Hi" in res.content or b"Body" in res.content

        # text/plain and application/pdf pass through unchanged.
        assert run(url_fetcher.fetch_url(f"http://127.0.0.1:{port}/txt")).mime_type == "text/plain"
        assert run(url_fetcher.fetch_url(f"http://127.0.0.1:{port}/pdf")).mime_type == "application/pdf"

        # A disallowed content type → 415.
        with pytest.raises(HTTPException) as ei:
            run(url_fetcher.fetch_url(f"http://127.0.0.1:{port}/evil"))
        assert ei.value.status_code == 415
    finally:
        settings.url_ingest_allow_private = saved
        srv.shutdown()


# ── FR-RAW-001: list ────────────────────────────────────────────────────────

def test_FR_RAW_001_list_newest_first(contributor):
    a = _upload_ok(contributor, title="raw-A")
    b = _upload_ok(contributor, title="raw-B")
    r = contributor.get("/api/raw")
    assert r.status_code == 200, r.text
    rows = r.json()
    ids = [row["id"] for row in rows]
    # Both just-uploaded sources are present...
    assert a["id"] in ids and b["id"] in ids
    # ...and the newer one (b) sorts before the older one (a): newest-first.
    assert ids.index(b["id"]) < ids.index(a["id"])


# ── FR-RAW-002: upload multipart + reader 403 ───────────────────────────────

def test_FR_RAW_002_upload_returns_pending(contributor):
    rs = _upload_ok(contributor, title="My Source", content=b"abc123")
    assert rs["title"] == "My Source"
    assert rs["ingest_status"] == "pending"
    assert rs["size_bytes"] == len(b"abc123")
    assert rs["original_filename"] == "note.txt"


def test_FR_RAW_002_upload_title_defaults_to_filename(contributor):
    # blank title → falls back to the original filename
    rs = _upload_ok(contributor, filename="report.txt")
    assert rs["title"] == "report.txt"


def test_FR_RAW_002_reader_upload_403(reader):
    r = _upload(reader)
    assert r.status_code == 403, r.text


# ── FR-RAW-003: 413 over the 50MB cap ───────────────────────────────────────

@pytest.mark.skip(reason="50MB body impractical to push over HTTP in CI; the "
                         "cap (MAX_BYTES=50MB, streamed 1MB-chunk 413) cannot "
                         "be lowered via the public API without patching app/.")
def test_FR_RAW_003_oversize_413():
    ...


# ── FR-RAW-004: MIME resolution (no upload-time allow-list) ─────────────────

def test_FR_RAW_004_specific_content_type_trusted(contributor):
    rs = _upload_ok(contributor, filename="x.bin", content=b"\x00\x01",
                    content_type="text/markdown")
    # A specific client content-type is trusted as-is.
    assert rs["mime_type"] == "text/markdown"


def test_FR_RAW_004_octet_stream_guessed_from_extension(contributor):
    # octet-stream → guessed from the .txt extension → text/plain.
    rs = _upload_ok(contributor, filename="readme.txt", content=b"hi",
                    content_type="application/octet-stream")
    assert rs["mime_type"] == "text/plain", rs


def test_FR_RAW_004_unsupported_type_rejected_at_upload(contributor):
    # GAP-011: an unsupported type is now rejected up front (415) instead of
    # being stored and only failing later at ingest. Mirrors URL-import.
    r = _upload(contributor, filename="data.weird", content=b"zzz",
                content_type="application/x-totally-made-up")
    assert r.status_code == 415, r.text


def test_FR_RAW_004_octet_stream_unguessable_rejected(contributor):
    # octet-stream whose extension can't be sniffed → unsupported → 415.
    r = _upload(contributor, filename="mystery.zzz", content=b"\x00\x01",
                content_type="application/octet-stream")
    assert r.status_code == 415, r.text


def test_FR_RAW_004_supported_types_accepted(contributor):
    # Representative supported types still upload fine (text/markdown/pdf/image).
    assert _upload_ok(contributor, filename="a.md", content=b"# hi",
                      content_type="text/markdown")["mime_type"] == "text/markdown"
    assert _upload_ok(contributor, filename="a.pdf", content=b"%PDF-1.4",
                      content_type="application/pdf")["mime_type"] == "application/pdf"
    assert _upload_ok(contributor, filename="a.png", content=b"\x89PNG",
                      content_type="image/png")["mime_type"] == "image/png"


# ── FR-RAW-005: URL import guards (blank 400, SSRF 403) ─────────────────────

def test_FR_RAW_005_blank_url_400(contributor):
    r = contributor.post("/api/raw/url", json={"url": "   "})
    assert r.status_code == 400, r.text


def test_FR_RAW_005_non_http_scheme_400(contributor):
    r = contributor.post("/api/raw/url", json={"url": "ftp://example.com/x"})
    assert r.status_code == 400, r.text


def test_FR_RAW_005_loopback_allowed_for_intranet(contributor):
    # Intranet imports: private/loopback hosts pass the SSRF guard (only the
    # link-local/cloud-metadata range stays blocked). 127.0.0.1 has nothing
    # listening in CI, so the fetch fails downstream — but NOT with the 403
    # SSRF rejection.
    r = contributor.post("/api/raw/url", json={"url": "http://127.0.0.1/"})
    assert r.status_code != 403, r.text


def test_FR_RAW_005_ssrf_link_local_metadata_403(contributor):
    # AWS metadata endpoint — classic SSRF target, link-local 169.254/16.
    r = contributor.post("/api/raw/url", json={"url": "http://169.254.169.254/"})
    assert r.status_code == 403, r.text


def test_FR_RAW_005_reader_url_import_403(reader):
    # Reader is blocked before any fetch happens.
    r = reader.post("/api/raw/url", json={"url": "http://127.0.0.1/"})
    assert r.status_code == 403, r.text


# ── FR-RAW-007: PATCH title/description; reader 403; missing 404 ────────────

def test_FR_RAW_007_patch_updates_title(contributor):
    rs = _upload_ok(contributor, title="before")
    r = contributor.patch(f"/api/raw/{rs['id']}", json={"title": "after"})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "after"


def test_FR_RAW_007_reader_patch_403(contributor, reader):
    rs = _upload_ok(contributor)
    r = reader.patch(f"/api/raw/{rs['id']}", json={"title": "nope"})
    assert r.status_code == 403, r.text


def test_FR_RAW_007_patch_missing_404(contributor):
    r = contributor.patch("/api/raw/99999999", json={"title": "x"})
    assert r.status_code == 404, r.text


# ── FR-RAW-008: download original bytes; missing 404; gone-from-disk 410 ────

def test_FR_RAW_008_download_returns_bytes(contributor):
    payload = b"download-me-exactly"
    rs = _upload_ok(contributor, filename="d.txt", content=payload)
    r = contributor.get(f"/api/raw/{rs['id']}/download")
    assert r.status_code == 200, r.text
    assert r.content == payload


def test_FR_RAW_008_download_missing_404(contributor):
    r = contributor.get("/api/raw/99999999/download")
    assert r.status_code == 404, r.text


@pytest.mark.skip(reason="410 'file gone from disk' requires deleting the raw "
                         "file out-of-band (no API to remove disk bytes while "
                         "keeping the row); cannot trigger via the public API.")
def test_FR_RAW_008_download_gone_410():
    ...


# ── FR-RAW-010: runs history (newest first) ─────────────────────────────────

def test_FR_RAW_010_runs_history(contributor):
    rs = _upload_ok(contributor)
    # No runs before any ingest.
    r0 = contributor.get(f"/api/raw/{rs['id']}/runs")
    assert r0.status_code == 200, r0.text
    assert r0.json() == []
    # Trigger one ingest -> one run appears.
    ing = _trigger_ingest(contributor, rs["id"])
    assert ing.status_code in (200, 201), ing.text
    run_id = ing.json()["id"]
    r1 = contributor.get(f"/api/raw/{rs['id']}/runs")
    assert r1.status_code == 200, r1.text
    run_ids = [row["id"] for row in r1.json()]
    assert run_id in run_ids


# ── FR-RAW-011: ingest trigger — reader 403; missing 404; creates planning run

def test_FR_RAW_011_reader_ingest_403(contributor, reader):
    rs = _upload_ok(contributor)
    r = _trigger_ingest(reader, rs["id"])
    assert r.status_code == 403, r.text


def test_FR_RAW_011_ingest_missing_404(contributor):
    r = _trigger_ingest(contributor, 99999999)
    assert r.status_code == 404, r.text


def test_FR_RAW_011_ingest_creates_planning_run(contributor):
    rs = _upload_ok(contributor)
    r = _trigger_ingest(contributor, rs["id"])
    assert r.status_code in (200, 201), r.text
    run = r.json()
    # Synchronous contract only: run created, references this source, status
    # planning. We do NOT wait for the LLM/worker to advance it.
    assert run["raw_source_id"] == rs["id"]
    assert run["status"] == "planning", run
    # Source is flipped to 'ingesting' synchronously.
    src = contributor.get(f"/api/raw/{rs['id']}").json()
    assert src["ingest_status"] == "ingesting", src


# ── FR-RAW-012: DELETE requires role==admin exactly ─────────────────────────

def test_FR_RAW_012_editor_delete_403(contributor, editor):
    # Editor is NOT admin → 403 even though editor outranks contributor.
    rs = _upload_ok(contributor)
    r = editor.delete(f"/api/raw/{rs['id']}")
    assert r.status_code == 403, r.text


def test_FR_RAW_012_contributor_delete_403(contributor):
    rs = _upload_ok(contributor)
    r = contributor.delete(f"/api/raw/{rs['id']}")
    assert r.status_code == 403, r.text


def test_FR_RAW_012_admin_delete_204(contributor, admin):
    rs = _upload_ok(contributor)
    r = admin.delete(f"/api/raw/{rs['id']}")
    assert r.status_code == 204, r.text
    # Gone afterwards.
    assert admin.get(f"/api/raw/{rs['id']}").status_code == 404


def test_FR_RAW_012_delete_missing_404(admin):
    r = admin.delete("/api/raw/99999999")
    assert r.status_code == 404, r.text


# ── FR-ING-002 / 003 / 004: apply / retry / dismiss guards ──────────────────
#
# We create a run via raw ingest; it sits in `planning` (we never let the
# worker finish). That lets us exercise every guard that does NOT need a
# completed plan: reader→403, and the state-guard 409s that fire because the
# run is `planning`, not `pending_review`.

def _planning_run(contributor) -> int:
    rs = _upload_ok(contributor)
    r = _trigger_ingest(contributor, rs["id"])
    assert r.status_code in (200, 201), r.text
    run = r.json()
    assert run["status"] == "planning", run
    return run["id"]


# FR-ING-002 apply
def test_FR_ING_002_reader_apply_403(contributor, reader):
    run_id = _planning_run(contributor)
    r = reader.post(f"/api/ingest-runs/{run_id}/apply", json={})
    assert r.status_code == 403, r.text


def test_FR_ING_002_apply_missing_404(contributor):
    r = contributor.post("/api/ingest-runs/99999999/apply", json={})
    assert r.status_code == 404, r.text


def test_FR_ING_002_apply_non_pending_review_409(contributor):
    # Run is `planning`, not `pending_review` → 409 state guard.
    run_id = _planning_run(contributor)
    r = contributor.post(f"/api/ingest-runs/{run_id}/apply", json={})
    assert r.status_code == 409, r.text
    assert "pending_review" in r.text


@pytest.mark.skip(reason="Out-of-range approved_indices 400 requires a run in "
                         "pending_review with a cached plan_json; reaching that "
                         "state needs the LLM plan worker to complete.")
def test_FR_ING_002_apply_bad_index_400():
    ...


# FR-ING-003 retry
def test_FR_ING_003_reader_retry_403(contributor, reader):
    run_id = _planning_run(contributor)
    r = reader.post(f"/api/ingest-runs/{run_id}/retry")
    assert r.status_code == 403, r.text


def test_FR_ING_003_retry_missing_404(contributor):
    r = contributor.post("/api/ingest-runs/99999999/retry")
    assert r.status_code == 404, r.text


def test_FR_ING_003_retry_planning_allowed(contributor):
    # `planning` is in the allowed set; with plan_json still null retry re-runs
    # the PLAN phase and the run stays/returns to `planning` (no 409).
    run_id = _planning_run(contributor)
    r = contributor.post(f"/api/ingest-runs/{run_id}/retry")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "planning", r.text


# FR-ING-004 dismiss
def test_FR_ING_004_reader_dismiss_403(contributor, reader):
    run_id = _planning_run(contributor)
    r = reader.post(f"/api/ingest-runs/{run_id}/dismiss")
    assert r.status_code == 403, r.text


def test_FR_ING_004_dismiss_missing_404(contributor):
    r = contributor.post("/api/ingest-runs/99999999/dismiss")
    assert r.status_code == 404, r.text


def test_FR_ING_004_dismiss_non_pending_review_409(contributor):
    # `planning` is not `pending_review` → 409 state guard.
    run_id = _planning_run(contributor)
    r = contributor.post(f"/api/ingest-runs/{run_id}/dismiss")
    assert r.status_code == 409, r.text
    assert "pending_review" in r.text


# FR-ING-001 watchdog: getting a fresh run returns it (200) without sweeping it
# (it's well under the 45-min stale cutoff).
def test_FR_ING_001_get_fresh_run_ok(contributor):
    run_id = _planning_run(contributor)
    r = contributor.get(f"/api/ingest-runs/{run_id}")
    assert r.status_code == 200, r.text
    # Still planning — too young for the stale watchdog to mark it failed.
    assert r.json()["status"] == "planning", r.text
