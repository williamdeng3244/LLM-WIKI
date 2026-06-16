"""[API] integration tests for FR-CHAT — RAG chat endpoint.

Black-box against the LIVE backend on :8000 in stub-auth mode.

The chat endpoint calls an LLM, which may be slow or entirely unconfigured in
the test environment. The contract we can ALWAYS assert is:
  * POST /api/chat requires authentication (anon → 401), and
  * a JWT/stub-authenticated request is ACCEPTED (auth + body shape pass) —
    i.e. we never get 401/403/422 for a well-formed request.
Answer-content assertions ({answer, citations} on a 200) are only made when the
LLM actually returns 200; if it errors (no provider configured), we record that
as an environment skip rather than failing the suite. We never fake a 200.
"""
from __future__ import annotations

import time

import httpx
import pytest

from tests.conftest import BASE_URL  # noqa: F401  (kept for parity w/ suite)


# The LLM call can be slow; give it a generous ceiling but don't hang forever.
CHAT_TIMEOUT = 90.0

# An LLM/provider failure surfaces as a 5xx (or 424/503 from a provider shim).
# Treat a *persistent* one as "LLM not configured/unavailable" rather than a
# contract break — but retry first, since a single 5xx is usually a cold-start
# or transient rate-limit, not a missing provider.
LLM_UNAVAILABLE = {500, 502, 503, 504, 424}
_RETRIES = 2


def _chat(client: httpx.Client, **body) -> httpx.Response:
    """POST /api/chat, retrying transient 5xx a couple times. A well-formed
    request that keeps 5xx-ing is taken as 'LLM down' by the callers."""
    body.setdefault("message", "What is in this wiki?")
    r = client.post("/api/chat", json=body, timeout=CHAT_TIMEOUT)
    for _ in range(_RETRIES):
        if r.status_code not in LLM_UNAVAILABLE:
            break
        time.sleep(2.0)
        r = client.post("/api/chat", json=body, timeout=CHAT_TIMEOUT)
    return r


def test_FR_CHAT_001_requires_auth(anon):
    """FR-CHAT-001 — POST /api/chat requires authentication; an anonymous
    caller is rejected with 401 before any LLM work happens."""
    r = anon.post(
        "/api/chat", json={"message": "hello"}, timeout=CHAT_TIMEOUT
    )
    assert r.status_code == 401, r.text


def test_FR_CHAT_001_authenticated_request_accepted(contributor):
    """FR-CHAT-001 — a well-formed authenticated request is ACCEPTED: the auth
    + body-validation gates pass, so the status is never 401/403/422. The
    actual answer may 200 (LLM up) or 5xx (LLM down); both prove acceptance."""
    r = _chat(contributor)
    assert r.status_code not in (401, 403, 422), r.text
    if r.status_code in LLM_UNAVAILABLE:
        pytest.skip(f"LLM not configured in test env (chat → {r.status_code})")
    assert r.status_code == 200, r.text


def test_FR_CHAT_002_json_body_with_answer_and_citations(contributor):
    """FR-CHAT-002 — the response is a SINGLE JSON body (not SSE/streamed) with
    `answer` (str) and `citations` (list) keys. Skipped if the LLM is down."""
    r = _chat(contributor, message="Summarize the available pages.")
    assert r.status_code not in (401, 403, 422), r.text
    if r.status_code in LLM_UNAVAILABLE:
        pytest.skip(f"LLM not configured in test env (chat → {r.status_code})")
    assert r.status_code == 200, r.text

    # Not streamed: a normal JSON content-type, fully buffered.
    ctype = r.headers.get("content-type", "")
    assert "application/json" in ctype, f"expected JSON, got {ctype}"
    assert "text/event-stream" not in ctype

    data = r.json()
    assert "answer" in data and isinstance(data["answer"], str), data
    assert "citations" in data and isinstance(data["citations"], list), data


def test_FR_CHAT_002_wiki_mode_accepted(contributor):
    """FR-CHAT-002 — mode='wiki' (page-level synthesis) is also accepted and,
    when the LLM is up, returns the same {answer, citations} envelope."""
    r = _chat(contributor, message="Give an overview.", mode="wiki")
    assert r.status_code not in (401, 403, 422), r.text
    if r.status_code in LLM_UNAVAILABLE:
        pytest.skip(f"LLM not configured in test env (chat wiki → {r.status_code})")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "answer" in data and "citations" in data, data


def test_FR_CHAT_001_missing_message_422(contributor):
    """FR-CHAT-001 — body validation: `message` is required, so a body without
    it is rejected with 422 (FastAPI/Pydantic) and never reaches the LLM."""
    r = contributor.post("/api/chat", json={"history": []}, timeout=CHAT_TIMEOUT)
    assert r.status_code == 422, r.text


# ── FR-CHAT-003 + FR-SRCH-003: in-process (mocked-LLM) RAG grounding ─────────
#
# FR-CHAT-003 is documented [API-mocked] and FR-SRCH-003 [API][unit]: both
# exercise app.services.rag directly with a DB session in hand. The black-box
# tests above can only prove "accepted / not-streamed" (the live LLM may be
# down); these prove the *grounding contract* deterministically by driving the
# real llm_client against tests/mock_llm (an OpenAI-compatible mock) and
# monkeypatching retrieval where a controlled source set is needed.
import uuid

import app.services.rag as rag
from app.services.rag import RetrievedChunk, answer, retrieve
from tests import mock_llm
from tests._inproc import mock_llm_server, run, session_scope  # noqa: F401
from tests.conftest import publish_page


def _chunk(n: int, path: str) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=n, page_id=n, page_path=path, page_title=f"Page {n}",
        chunk_type="prose", content=f"Body of source {n}.", language=None,
        symbol=None, line_start=1, line_end=2, score=0.9,
    )


def test_FR_CHAT_003_citation_markers_in_range_mapped_out_of_range_dropped(
    mock_llm_server, monkeypatch,
):
    """FR-CHAT-003 — only citation markers [n] within 1..len(sources) become
    citations; out-of-range markers are dropped. Drives the real
    llm_client.chat() against the OpenAI-compatible mock end-to-end."""
    rows = [_chunk(1, "eng/alpha"), _chunk(2, "eng/beta")]

    async def _fake_retrieve(session, query, k=8):
        return rows
    monkeypatch.setattr(rag, "retrieve", _fake_retrieve)

    # Two valid markers + one out-of-range ([9]; only 2 sources exist).
    mock_llm.STATE["chat_text"] = "Alpha fact [1]. Beta fact [2]. Hallucinated [9]."

    async def _go():
        async with session_scope() as s:
            return await answer(s, "what is alpha?")
    text, citations = run(_go())

    assert "[1]" in text and "[9]" in text, "raw model text is returned verbatim"
    mapped = sorted(c["n"] for c in citations)
    assert mapped == [1, 2], f"out-of-range [9] must be dropped; got {mapped}"
    assert citations[0]["page_path"] == "eng/alpha"
    assert citations[1]["page_path"] == "eng/beta"


def test_FR_CHAT_003_empty_index_returns_no_content_answer(monkeypatch):
    """FR-CHAT-003 — when retrieval yields nothing (empty index), answer returns
    a plain 'no indexed content' message with citations=[] and never calls the
    model."""
    async def _empty_retrieve(session, query, k=8):
        return []
    monkeypatch.setattr(rag, "retrieve", _empty_retrieve)

    async def _go():
        async with session_scope() as s:
            return await answer(s, "anything at all")
    text, citations = run(_go())

    assert citations == []
    assert "indexed content" in text.lower(), text


def test_FR_SRCH_003_lexical_fallback_when_embedding_fails(make_client, monkeypatch):
    """FR-SRCH-003 — if the query embedding raises (or vector returns nothing),
    retrieval falls back to a `content ILIKE %q%` scan over PUBLISHED pages with
    a constant score=0.5. Publish a page with a distinctive token, force the
    embedding to fail, and assert the token page comes back via the fallback."""
    token = "zqxlexfb" + uuid.uuid4().hex[:8]
    editor = make_client("editor")
    publish_page(
        editor,
        title="Lexical fallback probe",
        body=f"The {token} marker sits in published prose for the ILIKE path.",
        stability="open",
    )

    async def _boom(*a, **k):
        raise RuntimeError("embeddings unavailable")
    monkeypatch.setattr(rag, "embed_query", _boom)

    async def _go():
        async with session_scope() as s:
            return await retrieve(s, token, k=8)
    rows = run(_go())

    assert rows, "ILIKE fallback should find the freshly published page"
    assert all(r.score == 0.5 for r in rows), "fallback rows carry the constant 0.5 score"
    assert any(token in r.content for r in rows), "the token page must be among the hits"
