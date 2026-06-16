"""[unit] Graceful-degradation: a downed dependency fails *fast*, it does not
hang the request thread (which would exhaust the event loop / worker under an
outage).

Already covered elsewhere (cross-referenced so the degradation story is one place):
  - embeddings down  -> search falls back to lexical ILIKE  (FR-SRCH-003, test_chat.py)
  - worker/LLM absent -> ingest run stays `planning`, no crash (test_sources_ingest.py)
  - LLM rate-limited  -> 429 surfaced, run fails cleanly     (test_ingest_e2e.py)
  - malformed DB input -> 400 not 500                        (test_baseline_api.py)
"""
from __future__ import annotations

import asyncio
import socket
import time

import pytest

from app.core.config import settings
from app.services import llm_client


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()  # nothing listens here now -> connections are refused immediately
    return port


def test_llm_client_fails_fast_when_provider_unreachable(monkeypatch):
    """Point the LLM client at a dead port and assert chat() raises promptly
    (connection refused + max_retries=0) instead of hanging on the 300 s SDK
    timeout — so an LLM outage frees the request thread quickly."""
    monkeypatch.setattr(settings, "llm_provider", "openai")
    monkeypatch.setattr(settings, "openai_base_url", f"http://127.0.0.1:{_free_port()}/v1")
    monkeypatch.setattr(settings, "openai_api_key", "sk-deadhost")

    async def _call():
        return await asyncio.wait_for(
            llm_client.chat(system="s", messages=[{"role": "user", "content": "hi"}]),
            timeout=20,
        )

    t0 = time.monotonic()
    with pytest.raises(Exception):
        asyncio.run(_call())
    assert time.monotonic() - t0 < 20, "LLM client hung instead of failing fast"
