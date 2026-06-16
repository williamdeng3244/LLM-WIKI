"""[unit] Provider-agnostic LLM client.

The OpenAI path is exercised end-to-end by test_chat.py against the
OpenAI-compatible mock (tests/mock_llm.py). This module fills the parts that
the mock doesn't reach:
  - the content-block translators (`_to_anthropic_blocks`, `_to_openai_content`,
    `_extract_pdf_text`, `_normalize_messages`) — pure functions, tested directly;
  - the **Anthropic** provider path of `chat()` / `tool_call()` — the SDK is
    replaced with a tiny fake so no network/API key is needed (we assert the
    translation + response handling, not model quality).
"""
from __future__ import annotations

import asyncio
import base64

import pytest

from app.core.config import settings
from app.services import llm_client


def run(coro):
    return asyncio.run(coro)


def _minimal_pdf() -> bytes:
    # A structurally-valid 1-page PDF. pypdf parses it; there's no text layer,
    # so extraction returns the "[no extractable text]" placeholder — either
    # way the document branch executes.
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF"
    )


# ── content-block translation (pure functions) ─────────────────────────


def test_to_anthropic_blocks_text_image_document():
    out = llm_client._to_anthropic_blocks([
        {"type": "text", "text": "hi"},
        {"type": "image", "media_type": "image/png", "data_base64": "AAAA"},
        {"type": "document", "media_type": "application/pdf", "data_base64": "BBBB"},
    ])
    assert out[0] == {"type": "text", "text": "hi"}
    assert out[1]["type"] == "image" and out[1]["source"]["media_type"] == "image/png"
    assert out[2]["type"] == "document" and out[2]["source"]["data"] == "BBBB"


def test_to_anthropic_blocks_rejects_unknown_type():
    with pytest.raises(ValueError):
        llm_client._to_anthropic_blocks([{"type": "audio", "data_base64": "x"}])


def test_to_openai_content_single_text_is_plain_string():
    assert llm_client._to_openai_content([{"type": "text", "text": "x"}]) == "x"


def test_to_openai_content_image_becomes_data_url():
    out = llm_client._to_openai_content([
        {"type": "text", "text": "a"},
        {"type": "image", "media_type": "image/png", "data_base64": "QUJD"},
    ])
    assert out[0] == {"type": "text", "text": "a"}
    assert out[1]["type"] == "image_url"
    assert out[1]["image_url"]["url"].startswith("data:image/png;base64,QUJD")


def test_to_openai_content_pdf_document_extracts_text():
    out = llm_client._to_openai_content([
        {"type": "document", "media_type": "application/pdf",
         "data_base64": base64.b64encode(_minimal_pdf()).decode()},
    ])
    assert out[0]["type"] == "text"
    assert "Attached PDF" in out[0]["text"]


def test_to_openai_content_rejects_non_pdf_document():
    with pytest.raises(ValueError):
        llm_client._to_openai_content([
            {"type": "document", "media_type": "application/zip", "data_base64": ""},
        ])


def test_to_openai_content_rejects_unknown_block():
    with pytest.raises(ValueError):
        llm_client._to_openai_content([{"type": "audio", "data_base64": "x"}])


def test_extract_pdf_text_on_garbage_returns_placeholder():
    out = llm_client._extract_pdf_text(base64.b64encode(b"not a pdf").decode())
    assert "[PDF extraction failed" in out or "no extractable" in out


def test_normalize_messages_rejects_non_str_non_list_content():
    with pytest.raises(ValueError):
        llm_client._normalize_messages([{"role": "user", "content": 123}])


# ── Anthropic provider path (SDK mocked) ───────────────────────────────


class _TextBlock:
    type = "text"

    def __init__(self, text: str):
        self.text = text


class _ToolBlock:
    type = "tool_use"

    def __init__(self, name: str, inp: dict):
        self.name = name
        self.input = inp


class _Msg:
    def __init__(self, content: list):
        self.content = content


class _Stream:
    """Mimics `client.messages.stream(...)` — an async context manager that
    is also an async iterator and yields a final message."""

    def __init__(self, final: _Msg):
        self._final = final

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration

    async def get_final_message(self):
        return self._final


class _Messages:
    def __init__(self, chat_msg, tool_msg):
        self._chat = chat_msg
        self._tool = tool_msg

    async def create(self, **kw):
        return self._chat

    def stream(self, **kw):
        return _Stream(self._tool)


class _FakeAnthropic:
    def __init__(self, chat_msg=None, tool_msg=None):
        self.messages = _Messages(chat_msg, tool_msg)


@pytest.fixture
def anthropic(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "anthropic")
    monkeypatch.setattr(settings, "chat_model", "claude-test-model")

    def _install(chat_msg=None, tool_msg=None):
        fake = _FakeAnthropic(chat_msg, tool_msg)
        monkeypatch.setattr(llm_client, "_get_anthropic", lambda: fake)
        return fake

    return _install


def test_anthropic_chat_joins_text_blocks(anthropic):
    anthropic(chat_msg=_Msg([_TextBlock("Hello "), _TextBlock("world")]))
    out = run(llm_client.chat(system="s", messages=[{"role": "user", "content": "hi"}]))
    assert out == "Hello world"


def test_anthropic_chat_translates_list_content(anthropic):
    anthropic(chat_msg=_Msg([_TextBlock("ok")]))
    out = run(llm_client.chat(
        system="s",
        messages=[{"role": "user", "content": [{"type": "text", "text": "blk"}]}],
    ))
    assert out == "ok"


def test_anthropic_tool_call_returns_tool_input(anthropic):
    anthropic(tool_msg=_Msg([_ToolBlock("emit", {"x": 1, "y": "z"})]))
    out = run(llm_client.tool_call(
        system="s",
        messages=[{"role": "user", "content": "go"}],
        tool_name="emit", tool_description="d", tool_schema={"type": "object"},
    ))
    assert out == {"x": 1, "y": "z"}


def test_anthropic_tool_call_without_tool_use_raises(anthropic):
    anthropic(tool_msg=_Msg([_TextBlock("model declined to call the tool")]))
    with pytest.raises(RuntimeError):
        run(llm_client.tool_call(
            system="s",
            messages=[{"role": "user", "content": "go"}],
            tool_name="emit", tool_description="d", tool_schema={},
        ))


def test_active_provider_and_model_reflect_settings(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "anthropic")
    monkeypatch.setattr(settings, "chat_model", "claude-x")
    assert llm_client.active_provider() == "anthropic"
    assert llm_client.active_model() == "claude-x"
    monkeypatch.setattr(settings, "llm_provider", "openai")
    monkeypatch.setattr(settings, "openai_chat_model", "gpt-x")
    assert llm_client.active_model() == "gpt-x"
