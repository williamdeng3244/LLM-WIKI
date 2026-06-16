"""In-process OpenAI-compatible mock LLM for the Tier-3 (LLM-dependent) tests.

Why this exists
---------------
The RAG chat (FR-CHAT-003), ingest (FR-ING-005/007/008), and lint (FR-LINT-001)
requirements all route through ``app.services.llm_client``. In stub/dev mode
there is no real model, so those paths were previously untestable. This module
is the LLM analogue of ``tests/mock_idp.py``: a tiny server that speaks the
OpenAI Chat Completions wire format, so a test can point the backend at it with

    settings.llm_provider   = "openai"
    settings.openai_base_url = mock_llm.base_url(srv)   # http://127.0.0.1:<port>/v1

and exercise the *real* ``llm_client.chat()`` / ``tool_call()`` request
translation + response parsing end-to-end — only the model's *content* is canned.

Design notes
------------
* Binds to **127.0.0.1 (IPv4) on purpose**: ``localhost`` on this WSL2 host can
  resolve to a dead IPv6 route (the project's recurring "API Error"), which would
  make the openai SDK's call hang. 127.0.0.1 sidesteps name resolution entirely.
* Runs in a daemon thread in the pytest process, so a test can mutate ``STATE``
  between calls to control exactly what the "model" returns.
* Responses are driven by ``STATE``:
    - plain chat  -> ``STATE["chat_text"]``   (assistant message content)
    - forced tool -> ``STATE["tool_args"]`` serialized as the tool_call
      arguments; the tool *name* is echoed back from the request's
      ``tool_choice`` so ingest gets ``submit_ingest_result`` and lint gets
      ``submit_lint_findings`` without the mock needing to know which is which.

This is a mock: it proves the *plumbing/contract* (request shape, tool-call
parsing, the service orchestration around the call). It deliberately says
nothing about a real model's output quality.
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

# Mutated by tests before each call. Defaults are harmless no-ops.
STATE: dict[str, Any] = {
    "chat_text": "Mock answer.",
    "tool_args": {},
}


class _Handler(BaseHTTPRequestHandler):
    # Silence the default per-request stderr logging.
    def log_message(self, *_a):  # noqa: D401, N802
        return

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            body = {}

        tool_choice = body.get("tool_choice")
        forced = isinstance(tool_choice, dict) and tool_choice.get("type") == "function"
        if forced:
            name = (tool_choice.get("function") or {}).get("name") or "tool"
            message = {
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": "call_mock",
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": json.dumps(STATE.get("tool_args") or {}),
                    },
                }],
            }
            finish = "tool_calls"
        else:
            message = {"role": "assistant", "content": STATE.get("chat_text") or ""}
            finish = "stop"

        payload = {
            "id": "chatcmpl-mock",
            "object": "chat.completion",
            "created": 0,
            "model": body.get("model") or "mock-model",
            "choices": [{"index": 0, "message": message, "finish_reason": finish}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        }
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def start(port: int = 0) -> ThreadingHTTPServer:
    """Start the mock on 127.0.0.1:<port> (0 = ephemeral) in a daemon thread."""
    srv = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def base_url(srv: ThreadingHTTPServer) -> str:
    """The OpenAI-style base URL to hand to ``settings.openai_base_url``."""
    return f"http://127.0.0.1:{srv.server_address[1]}/v1"


def stop(srv: ThreadingHTTPServer) -> None:
    srv.shutdown()
