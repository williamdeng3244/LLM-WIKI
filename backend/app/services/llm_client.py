"""Provider-agnostic LLM client.

Callers pass generic content blocks and tool definitions; this module
translates them into either Anthropic Messages or OpenAI Chat Completions
calls based on `settings.llm_provider`.

Generic content-block shapes (input to chat / tool_call):
  - {"type": "text",     "text": "..."}
  - {"type": "image",    "media_type": "image/png", "data_base64": "..."}
  - {"type": "document", "media_type": "application/pdf", "data_base64": "..."}

OpenAI has no native PDF document block — PDFs are extracted to text with
pypdf before being sent. Scanned/image-only PDFs degrade to "[no text]".
"""
from __future__ import annotations

import base64
import io
import json
import logging
from typing import Any, Optional

from app.core.config import settings

log = logging.getLogger(__name__)

_anthropic_client: Any = None
_openai_client: Any = None


# ── Client construction ────────────────────────────────────────────────

def _get_anthropic():
    global _anthropic_client
    if _anthropic_client is None:
        from anthropic import AsyncAnthropic
        _anthropic_client = AsyncAnthropic(api_key=settings.anthropic_api_key or None)
    return _anthropic_client


def _get_openai():
    global _openai_client
    if _openai_client is None:
        from openai import AsyncOpenAI
        # OpenAI-compatible endpoints (Ollama, vLLM, LM Studio, ...) often
        # ignore the key but the SDK requires a non-empty string.
        key = settings.openai_api_key or "sk-no-key-required"
        base_url = settings.openai_base_url or "https://api.openai.com/v1"
        _openai_client = AsyncOpenAI(api_key=key, base_url=base_url)
    return _openai_client


def active_provider() -> str:
    return settings.llm_provider


def active_model() -> str:
    if settings.llm_provider == "openai":
        return settings.openai_chat_model
    return settings.chat_model


# ── Content block translation ──────────────────────────────────────────

def _extract_pdf_text(data_base64: str) -> str:
    try:
        from pypdf import PdfReader
        raw = base64.b64decode(data_base64)
        reader = PdfReader(io.BytesIO(raw))
        parts = [(p.extract_text() or "") for p in reader.pages]
        out = "\n\n".join(parts).strip()
        return out or "[no extractable text — PDF may be image-only]"
    except Exception as e:  # noqa: BLE001
        log.exception("PDF extraction failed")
        return f"[PDF extraction failed: {e}]"


def _to_anthropic_blocks(blocks: list[dict]) -> list[dict]:
    out: list[dict] = []
    for b in blocks:
        t = b.get("type")
        if t == "text":
            out.append({"type": "text", "text": b["text"]})
        elif t == "image":
            out.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": b["media_type"],
                    "data": b["data_base64"],
                },
            })
        elif t == "document":
            out.append({
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": b["media_type"],
                    "data": b["data_base64"],
                },
            })
        else:
            raise ValueError(f"Unsupported content block type: {t}")
    return out


def _to_openai_content(blocks: list[dict]) -> Any:
    # Single text block → plain string (smaller payload + max compat).
    if len(blocks) == 1 and blocks[0].get("type") == "text":
        return blocks[0]["text"]
    out: list[dict] = []
    for b in blocks:
        t = b.get("type")
        if t == "text":
            out.append({"type": "text", "text": b["text"]})
        elif t == "image":
            url = f"data:{b['media_type']};base64,{b['data_base64']}"
            out.append({"type": "image_url", "image_url": {"url": url}})
        elif t == "document":
            # No native document block in OpenAI; extract text for PDFs.
            mt = b["media_type"]
            if mt == "application/pdf":
                text = _extract_pdf_text(b["data_base64"])
                out.append({"type": "text", "text": f"[Attached PDF, text extracted]\n\n{text}"})
            else:
                raise ValueError(
                    f"OpenAI provider does not support document type {mt!r}. "
                    "Switch LLM_PROVIDER=anthropic or upload as text."
                )
        else:
            raise ValueError(f"Unsupported content block type: {t}")
    return out


def _normalize_messages(
    messages: list[dict],
) -> list[tuple[str, list[dict] | str]]:
    """Coerce each message's content to either a plain string or a list
    of generic content-block dicts; preserve role."""
    out: list[tuple[str, list[dict] | str]] = []
    for m in messages:
        role = m["role"]
        c = m["content"]
        if isinstance(c, str):
            out.append((role, c))
        elif isinstance(c, list):
            out.append((role, c))
        else:
            raise ValueError(f"Unsupported message content: {type(c)}")
    return out


# ── Public API ─────────────────────────────────────────────────────────

async def chat(
    *,
    system: str,
    messages: list[dict],
    max_tokens: int = 1024,
) -> str:
    """Plain-text chat completion. Returns the assistant text."""
    norm = _normalize_messages(messages)

    if settings.llm_provider == "openai":
        client = _get_openai()
        oai: list[dict] = [{"role": "system", "content": system}]
        for role, c in norm:
            if isinstance(c, list):
                c = _to_openai_content(c)
            oai.append({"role": role, "content": c})
        resp = await client.chat.completions.create(
            model=settings.openai_chat_model,
            messages=oai,
            max_tokens=max_tokens,
        )
        return resp.choices[0].message.content or ""

    # Anthropic
    client = _get_anthropic()
    anth: list[dict] = []
    for role, c in norm:
        if isinstance(c, list):
            c = _to_anthropic_blocks(c)
        anth.append({"role": role, "content": c})
    resp = await client.messages.create(
        model=settings.chat_model,
        max_tokens=max_tokens,
        system=system,
        messages=anth,
    )
    return "".join(
        getattr(b, "text", "")
        for b in resp.content
        if getattr(b, "type", None) == "text"
    )


async def tool_call(
    *,
    system: str,
    messages: list[dict],
    tool_name: str,
    tool_description: str,
    tool_schema: dict,
    max_tokens: int = 8000,
) -> dict:
    """Force the model to call `tool_name` with arguments matching
    `tool_schema` (a JSON Schema dict). Returns the parsed arguments.

    Both providers receive the same JSON Schema; only the wrapping
    differs (Anthropic: `input_schema` + tool_choice `type:"tool"`;
    OpenAI: `function.parameters` + tool_choice `type:"function"`).
    """
    norm = _normalize_messages(messages)

    if settings.llm_provider == "openai":
        client = _get_openai()
        oai: list[dict] = [{"role": "system", "content": system}]
        for role, c in norm:
            if isinstance(c, list):
                c = _to_openai_content(c)
            oai.append({"role": role, "content": c})
        resp = await client.chat.completions.create(
            model=settings.openai_chat_model,
            messages=oai,
            max_tokens=max_tokens,
            tools=[{
                "type": "function",
                "function": {
                    "name": tool_name,
                    "description": tool_description,
                    "parameters": tool_schema,
                },
            }],
            tool_choice={"type": "function", "function": {"name": tool_name}},
        )
        msg = resp.choices[0].message
        calls = getattr(msg, "tool_calls", None) or []
        for call in calls:
            if call.function.name == tool_name:
                try:
                    return json.loads(call.function.arguments or "{}")
                except json.JSONDecodeError as e:
                    raise RuntimeError(
                        f"OpenAI returned malformed JSON for tool {tool_name}: {e}"
                    ) from e
        raise RuntimeError(
            f"OpenAI model did not return a tool call for {tool_name}; "
            f"endpoint may not support function calling."
        )

    # Anthropic
    client = _get_anthropic()
    anth: list[dict] = []
    for role, c in norm:
        if isinstance(c, list):
            c = _to_anthropic_blocks(c)
        anth.append({"role": role, "content": c})
    resp = await client.messages.create(
        model=settings.chat_model,
        max_tokens=max_tokens,
        system=system,
        messages=anth,
        tools=[{
            "name": tool_name,
            "description": tool_description,
            "input_schema": tool_schema,
        }],
        tool_choice={"type": "tool", "name": tool_name},
    )
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == tool_name:
            return block.input  # type: ignore[no-any-return,return-value]
    raise RuntimeError(f"Anthropic model did not return a tool call for {tool_name}")
