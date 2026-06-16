"""[API] Ingest-run review workflow — apply / dismiss / retry / stale-sweep.

The existing suite only hits these endpoints with a non-existent run id (→404),
so the handler BODIES (approval + index validation, dismissal, retry's
re-plan-vs-re-apply dispatch, and the lazy stale-run watchdog) were uncovered.
Here we seed a real run directly in the DB via the ORM — no worker/LLM is
needed to reach `pending_review` — and drive the endpoints over the API.

Note: a successful `apply`/`retry` enqueues a Celery task (`.delay(...)`). With
a synthetic source that task will no-op/fail in the worker and mark the run
failed; that's after the API has already returned, so it doesn't affect these
assertions (the worker's bad-input handling is covered by test_degradation).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.models import IngestRun, IngestRunStatus, RawSource
from tests._inproc import run, session_scope


def _seed_run(status, *, plan_json=None, edits_count=0, started_minutes_ago=None) -> int:
    """Insert a RawSource + an IngestRun in the given status; return run id."""
    async def _do():
        async with session_scope() as s:
            rs = RawSource(
                title="qa-ingest-src",
                original_filename="src.txt",
                disk_filename=f"qa-{uuid.uuid4().hex}.txt",
                mime_type="text/plain",
                size_bytes=12,
            )
            s.add(rs)
            await s.flush()
            r = IngestRun(
                raw_source_id=rs.id, status=status,
                plan_json=plan_json, edits_count=edits_count,
            )
            if started_minutes_ago is not None:
                r.started_at = datetime.now(timezone.utc) - timedelta(minutes=started_minutes_ago)
            s.add(r)
            await s.commit()
            return r.id
    return run(_do())


# ── get / 404 ───────────────────────────────────────────────────────────


def test_get_run_404_for_unknown(editor):
    assert editor.get("/api/ingest-runs/99999999").status_code == 404


# ── apply ───────────────────────────────────────────────────────────────


def test_apply_pending_review_dispatches(editor):
    rid = _seed_run(
        IngestRunStatus.pending_review,
        plan_json={"edits": [{"id": "a"}, {"id": "b"}]}, edits_count=2,
    )
    r = editor.post(f"/api/ingest-runs/{rid}/apply", json={"approved_indices": [0]})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "applying"


def test_apply_rejects_out_of_range_index(editor):
    rid = _seed_run(
        IngestRunStatus.pending_review,
        plan_json={"edits": [{"id": "a"}]}, edits_count=1,
    )
    r = editor.post(f"/api/ingest-runs/{rid}/apply", json={"approved_indices": [5]})
    assert r.status_code == 400, r.text


def test_apply_wrong_status_409(editor):
    rid = _seed_run(IngestRunStatus.done)
    assert editor.post(f"/api/ingest-runs/{rid}/apply", json={}).status_code == 409


def test_apply_forbidden_for_reader(reader):
    rid = _seed_run(IngestRunStatus.pending_review, plan_json={"edits": []})
    assert reader.post(f"/api/ingest-runs/{rid}/apply", json={}).status_code == 403


# ── dismiss ─────────────────────────────────────────────────────────────


def test_dismiss_pending_review(editor):
    rid = _seed_run(IngestRunStatus.pending_review, plan_json={"edits": [{"id": "a"}]})
    r = editor.post(f"/api/ingest-runs/{rid}/dismiss")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "dismissed"


def test_dismiss_wrong_status_409(editor):
    rid = _seed_run(IngestRunStatus.applying)
    assert editor.post(f"/api/ingest-runs/{rid}/dismiss").status_code == 409


def test_dismiss_forbidden_for_reader(reader):
    rid = _seed_run(IngestRunStatus.pending_review)
    assert reader.post(f"/api/ingest-runs/{rid}/dismiss").status_code == 403


# ── retry (re-plan vs re-apply) ─────────────────────────────────────────


def test_retry_replans_when_no_plan(editor):
    rid = _seed_run(IngestRunStatus.failed, plan_json=None)
    r = editor.post(f"/api/ingest-runs/{rid}/retry")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "planning"  # no cached plan → re-run plan phase


def test_retry_reapplies_when_plan_exists(editor):
    rid = _seed_run(IngestRunStatus.partially_failed, plan_json={"edits": [{"id": "a"}]})
    r = editor.post(f"/api/ingest-runs/{rid}/retry")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "applying"  # plan present → re-run apply phase


def test_retry_wrong_status_409(editor):
    rid = _seed_run(IngestRunStatus.pending_review)
    assert editor.post(f"/api/ingest-runs/{rid}/retry").status_code == 409


# ── lazy stale-run watchdog ─────────────────────────────────────────────


def test_get_run_sweeps_stale_applying_to_failed(editor):
    # A run stuck 'applying' for > STALE_RUN_TIMEOUT_MIN (45) min is swept to
    # failed on the next GET (the lazy watchdog in _sweep_stale_runs).
    rid = _seed_run(IngestRunStatus.applying, started_minutes_ago=60)
    r = editor.get(f"/api/ingest-runs/{rid}")
    assert r.status_code == 200
    assert r.json()["status"] == "failed"
