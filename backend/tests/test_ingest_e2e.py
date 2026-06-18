"""[live-e2e] Real ingest pipeline — Celery worker + real model.

These hit LIVE external services (the Celery worker via Redis and the
configured LLM) and cost real model tokens, so they only run when
``WIKI_RUN_LIVE_E2E=1`` is set; otherwise they skip-with-reason. They lock
the full async dispatch path that the mock / in-process ``test_sources_ingest``
tests can't reach.

Validated 2026-06-12: worker completed the plan in ~11 s (1 edit, no error).

Run them with:
    docker exec -e WIKI_RUN_LIVE_E2E=1 wiki-backend-1 python -m pytest tests/test_ingest_e2e.py -q
"""
from __future__ import annotations

import os
import time

import httpx
import pytest

LIVE = os.environ.get("WIKI_RUN_LIVE_E2E") == "1"
needs_live = pytest.mark.skipif(
    not LIVE,
    reason="live-e2e (worker + real model, costs tokens) — set WIKI_RUN_LIVE_E2E=1",
)
BASE = os.environ.get("WIKI_TEST_BASE_URL", "http://localhost:8000")
ADMIN = {"X-User-Email": "live-e2e@example.com", "X-User-Role": "admin"}


@needs_live
def test_ingest_worker_e2e_real_dispatch():
    """API -> Redis -> real Celery worker -> real model -> pending_review plan.

    The whole point is the *async dispatch*: we never touch the task body, we
    enqueue via the HTTP endpoint and poll until the live worker finishes."""
    src = (b"Hypatia of Alexandria (c. 350-415 CE) was a Neoplatonist philosopher, "
           b"astronomer, and mathematician, head of the Platonist school at Alexandria.")
    sid = None
    try:
        r = httpx.post(f"{BASE}/api/raw", headers=ADMIN,
                       files={"file": ("hypatia.txt", src, "text/plain")},
                       data={"title": "live-e2e Hypatia"}, timeout=30)
        assert r.status_code in (200, 201), r.text
        sid = r.json()["id"]

        t = httpx.post(f"{BASE}/api/raw/{sid}/ingest", headers=ADMIN, timeout=30)
        assert t.status_code in (200, 201), t.text
        rid = t.json()["id"]
        assert t.json()["status"] == "planning", "ingest should start in planning"

        run, status = None, "planning"
        deadline = time.time() + 180
        while time.time() < deadline:
            runs = httpx.get(f"{BASE}/api/raw/{sid}/runs", headers=ADMIN, timeout=15).json()
            run = next((x for x in runs if x["id"] == rid), None)
            status = run["status"] if run else "?"
            if status != "planning":
                break
            time.sleep(5)

        err = (run or {}).get("error") or ""
        if status == "failed" and ("rate_limit" in err.lower() or "429" in err):
            pytest.skip(f"model rate-limited (env tier too low): {err[:100]}")
        assert status == "pending_review", f"worker did not finish the plan: {status} err={err[:120]}"
        assert (run or {}).get("edits_count", 0) >= 1, "plan should propose at least one edit"
    finally:
        if sid is not None:
            httpx.request("DELETE", f"{BASE}/api/raw/{sid}", headers=ADMIN, timeout=20)
