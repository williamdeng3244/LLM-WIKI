"""MCP JSON-RPC server — covers FR-MCP-001/002/003 (+ a get_page tools/call).

Black-box integration against the live backend on :8000. The MCP endpoint is
mounted at ``/mcp`` (NOT under ``/api``) and speaks JSON-RPC 2.0 over POST.

Auth model: a Bearer personal MCP token authorizes as the real human user.
To obtain a working token in-test we, as an admin, grant a fresh user
``mcp_enabled`` (FR-USR-004) then have that user mint a token (FR-MTOK-002).

This env has MCP globally ENABLED (verified at collection time below). If a
future run flips ``MCP_ENABLED=false`` the suite auto-detects the 503 path and
skips the bearer-dependent tests with reason instead of failing.
"""
from __future__ import annotations

import httpx
import pytest

from tests.conftest import BASE_URL, TIMEOUT, uid


# ── env probe: is MCP globally enabled here? ────────────────────────────────

def _mcp_globally_enabled() -> bool:
    """A POST with no bearer returns 503 iff MCP is globally disabled; 401
    (missing bearer) means it's enabled."""
    r = httpx.post(
        f"{BASE_URL}/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        timeout=TIMEOUT,
    )
    return r.status_code != 503


MCP_ON = _mcp_globally_enabled()
requires_mcp = pytest.mark.skipif(
    not MCP_ON, reason="MCP_ENABLED=false in this env; bearer-path tests N/A"
)


# ── helpers ─────────────────────────────────────────────────────────────────

def _rpc(client: httpx.Client, method: str, params: dict | None = None,
         req_id=1, token: str | None = None) -> httpx.Response:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post(
        "/mcp",
        headers=headers,
        json={"jsonrpc": "2.0", "id": req_id, "method": method,
              "params": params or {}},
    )


def _mint_mcp_token(admin, user) -> str:
    """Grant `user` MCP access and return a fresh raw bearer token.

    If token creation is broken upstream (the POST /api/mcp-tokens 500 — see
    tests/test_mcp_tokens.py::test_FR_MTOK_002_create_returns_raw_wt_token),
    skip the dependent MCP test with reason rather than re-reporting the same
    root-cause bug here. The MCP server's own auth/dispatch contract cannot be
    exercised over a real bearer until a token can be minted."""
    tid = uid(user)
    g = admin.post(f"/api/users/{tid}/mcp-access", params={"enabled": True})
    assert g.status_code == 200, g.text
    t = user.post("/api/mcp-tokens", json={"name": "mcp-test"})
    if t.status_code != 200:
        pytest.skip(
            f"blocked: cannot mint MCP token (POST /api/mcp-tokens → "
            f"{t.status_code}); see test_mcp_tokens.py FR-MTOK-002 RED"
        )
    raw = t.json()["raw_token"]
    assert raw.startswith("wt_")
    return raw


@pytest.fixture
def mcp_client():
    """A bare httpx client pointed at the backend (no stub auth headers — MCP
    authorizes via Bearer token only)."""
    c = httpx.Client(base_url=BASE_URL, timeout=TIMEOUT, follow_redirects=False)
    yield c
    c.close()


# ── FR-MCP-001: global kill switch ──────────────────────────────────────────

def test_FR_MCP_001_global_switch_state(mcp_client):
    """If globally disabled, ANY /mcp POST → 503. If enabled, a no-bearer POST
    → 401 (proving the switch is on, not 503). We assert whichever holds."""
    r = _rpc(mcp_client, "initialize")
    if MCP_ON:
        assert r.status_code == 401, r.text
    else:
        assert r.status_code == 503, r.text


@pytest.mark.skipif(
    MCP_ON, reason="MCP is globally ENABLED in this env; the 503 kill-switch "
                   "path is not reachable without setting MCP_ENABLED=false.")
def test_FR_MCP_001_disabled_503():  # pragma: no cover - env-dependent
    ...


# ── FR-MCP-002: auth ────────────────────────────────────────────────────────

@requires_mcp
def test_FR_MCP_002_missing_bearer_401(mcp_client):
    r = _rpc(mcp_client, "initialize")
    assert r.status_code == 401, r.text


@requires_mcp
def test_FR_MCP_002_bearer_without_token_401(mcp_client):
    # "Bearer" with no token value: fails the `startswith("bearer ")` check →
    # 401 "Missing bearer token". (The distinct "Bearer <space>" empty-token
    # branch is unreachable: httpx rejects a trailing-space header value
    # client-side with LocalProtocolError, so it never hits the server.)
    r = mcp_client.post(
        "/mcp", headers={"Authorization": "Bearer"},
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
    )
    assert r.status_code == 401, r.text


@requires_mcp
def test_FR_MCP_002_invalid_token_401(mcp_client):
    r = _rpc(mcp_client, "initialize", token="wt_not_a_real_token_zzz")
    assert r.status_code == 401, r.text


@requires_mcp
def test_FR_MCP_002_user_without_mcp_enabled_403(mcp_client, admin, make_client):
    # Mint a valid token, then REVOKE the user's mcp access → token resolves to
    # a user whose mcp_enabled is false → 403 (not 401).
    user = make_client("contributor")
    raw = _mint_mcp_token(admin, user)
    tid = uid(user)
    off = admin.post(f"/api/users/{tid}/mcp-access", params={"enabled": False})
    assert off.status_code == 200 and off.json()["mcp_enabled"] is False
    r = _rpc(mcp_client, "tools/list", token=raw)
    assert r.status_code == 403, r.text


# ── FR-MCP-003: JSON-RPC dispatch ───────────────────────────────────────────

@requires_mcp
def test_FR_MCP_003_initialize_serverinfo(mcp_client, admin, make_client):
    user = make_client("contributor")
    raw = _mint_mcp_token(admin, user)
    r = _rpc(mcp_client, "initialize", token=raw)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["jsonrpc"] == "2.0"
    result = body["result"]
    assert "serverInfo" in result
    assert result["serverInfo"]["name"]  # non-empty server name
    assert "protocolVersion" in result
    assert "capabilities" in result


@requires_mcp
def test_FR_MCP_003_tools_list_is_array(mcp_client, admin, make_client):
    user = make_client("contributor")
    raw = _mint_mcp_token(admin, user)
    r = _rpc(mcp_client, "tools/list", token=raw)
    assert r.status_code == 200, r.text
    tools = r.json()["result"]["tools"]
    assert isinstance(tools, list) and len(tools) > 0
    names = {t["name"] for t in tools}
    # Spot-check a couple of catalogue tools are present.
    assert "get_page" in names
    assert "search_wiki" in names
    # Every tool advertises a name + inputSchema.
    for t in tools:
        assert "name" in t and "inputSchema" in t


@requires_mcp
def test_FR_MCP_003_unknown_method_32601(mcp_client, admin, make_client):
    user = make_client("contributor")
    raw = _mint_mcp_token(admin, user)
    r = _rpc(mcp_client, "no/such/method", token=raw)
    assert r.status_code == 200, r.text
    assert r.json()["error"]["code"] == -32601, r.text


@requires_mcp
def test_FR_MCP_003_parse_error_32700(mcp_client, admin, make_client):
    # Authenticated, but body is not valid JSON → -32700 parse error.
    user = make_client("contributor")
    raw = _mint_mcp_token(admin, user)
    r = mcp_client.post(
        "/mcp",
        headers={"Authorization": f"Bearer {raw}",
                 "Content-Type": "application/json"},
        content=b"{not json",
    )
    assert r.status_code == 200, r.text
    assert r.json()["error"]["code"] == -32700, r.text


@requires_mcp
def test_FR_MCP_003_resources_list_empty(mcp_client, admin, make_client):
    user = make_client("contributor")
    raw = _mint_mcp_token(admin, user)
    r = _rpc(mcp_client, "resources/list", token=raw)
    assert r.status_code == 200, r.text
    assert r.json()["result"]["resources"] == []


# ── FR-MCP-003 + tools/call: get_page round-trips a published page ─────────

@requires_mcp
def test_FR_MCP_003_tools_call_get_page(mcp_client, admin, make_client):
    # Publish a page as an editor (auto-publishes at stability=open), then read
    # it back through the MCP get_page tool using a bearer token.
    from tests.conftest import publish_page, unique_path

    author = make_client("editor")
    path = unique_path("mcp")
    publish_page(author, path=path, title="MCP Readable",
                 body="visible via mcp", stability="open")

    user = make_client("contributor")
    raw = _mint_mcp_token(admin, user)
    r = _rpc(mcp_client, "tools/call",
             params={"name": "get_page", "arguments": {"path": path}},
             token=raw)
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    # Tool success returns a content block; not an isError envelope.
    assert not result.get("isError"), result
    text = result["content"][0]["text"]
    assert path in text
    assert "MCP Readable" in text


@requires_mcp
def test_FR_MCP_003_tools_call_get_page_missing_is_error(mcp_client, admin, make_client):
    # A missing page surfaces as a *successful* RPC result with isError=true
    # (FR-MCP-004 behaviour), not a transport error.
    from tests.conftest import unique_path

    user = make_client("contributor")
    raw = _mint_mcp_token(admin, user)
    r = _rpc(mcp_client, "tools/call",
             params={"name": "get_page",
                     "arguments": {"path": unique_path("ghost")}},
             token=raw)
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    assert result.get("isError") is True, result


@requires_mcp
def test_FR_MCP_003_tools_call_unknown_tool_32601(mcp_client, admin, make_client):
    user = make_client("contributor")
    raw = _mint_mcp_token(admin, user)
    r = _rpc(mcp_client, "tools/call",
             params={"name": "does_not_exist", "arguments": {}}, token=raw)
    assert r.status_code == 200, r.text
    assert r.json()["error"]["code"] == -32601, r.text


@requires_mcp
def test_FR_MCP_005_search_wiki_clamps_bad_limit_no_crash(mcp_client, admin, make_client):
    """search_wiki must clamp a negative / oversized / non-numeric limit and
    never crash. The MCP layer does NOT enforce the tool inputSchema, so a
    negative limit otherwise reaches the SQL LIMIT and aborts the transaction
    (`InFailedSQLTransactionError`). Regression for a QA-found crash."""
    raw = _mint_mcp_token(admin, make_client("editor"))
    _rpc(mcp_client, "initialize", token=raw)
    for bad in (-1, 0, 99999, "abc"):
        r = _rpc(mcp_client, "tools/call",
                 params={"name": "search_wiki", "arguments": {"query": "x", "limit": bad}},
                 token=raw)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "error" not in body, f"limit={bad!r} crashed search_wiki: {body.get('error')}"
        assert "result" in body


def _tool(client, token, name, args):
    """Call a tool; return (http_status, rpc_error_or_None, isError_bool)."""
    r = _rpc(client, "tools/call", params={"name": name, "arguments": args}, token=token)
    try:
        b = r.json()
    except Exception:
        b = {}
    return r.status_code, b.get("error"), bool((b.get("result") or {}).get("isError"))


@requires_mcp
def test_FR_MCP_006_read_tools(mcp_client, admin, make_client):
    """FR-MCP-006: the read tools succeed; get_page on a missing path is a clean
    isError (not an RPC crash); a huge path doesn't 5xx."""
    raw = _mint_mcp_token(admin, make_client("editor"))
    for name in ("list_pages", "list_my_drafts", "list_review_queue"):
        s, err, is_err = _tool(mcp_client, raw, name, {})
        assert s == 200 and err is None and not is_err, f"{name}: {s} {err}"
    s, err, is_err = _tool(mcp_client, raw, "get_page", {"path": "does/not/exist/xyz"})
    assert s == 200 and err is None and is_err, "missing get_page should be a clean isError"
    s, err, _ = _tool(mcp_client, raw, "list_backlinks", {"path": "x" * 9000})
    assert s < 500 and err is None, "huge path must not 5xx/crash"


@requires_mcp
def test_FR_MCP_007_create_draft_target_validation(mcp_client, admin, make_client):
    """FR-MCP-007: create_draft needs exactly one page target — neither/both is a
    clean isError, not a crash."""
    raw = _mint_mcp_token(admin, make_client("editor"))
    for args in ({"title": "T", "body": "B"},
                 {"title": "T", "body": "B", "page_path": "p", "new_page_path": "q"}):
        s, err, is_err = _tool(mcp_client, raw, "create_draft", args)
        assert s == 200 and err is None and is_err, f"bad target {args} should be isError: {s} {err}"


@requires_mcp
def test_FR_MCP_008_009_artifact_tools(mcp_client, admin, make_client):
    """FR-MCP-008/009: publish_artifact rejects a bad MIME without a 5xx;
    update_artifact on a missing id is a clean isError; list_my_artifacts clamps
    a negative limit instead of crashing."""
    raw = _mint_mcp_token(admin, make_client("editor"))
    s, err, _ = _tool(mcp_client, raw, "publish_artifact",
                      {"name": "A", "body": "x", "mime_type": "application/evil"})
    assert s < 500 and err is None, f"bad mime must not 5xx/crash: {s} {err}"
    s, err, is_err = _tool(mcp_client, raw, "update_artifact", {"short_id": "nope", "body": "x"})
    assert s == 200 and err is None and is_err, "missing artifact should be isError"
    s, err, _ = _tool(mcp_client, raw, "list_my_artifacts", {"limit": -5})
    assert s == 200 and err is None, "negative limit must clamp, not crash"


@requires_mcp
def test_FR_MCP_009_update_artifact_versions_and_list_is_owner_scoped(
    mcp_client, admin, make_client,
):
    """FR-MCP-009 (success paths) — update_artifact (owner/admin only) adds a new
    version; list_my_artifacts is owner-scoped. A non-owner's update is a clean
    PermissionError (isError) and the artifact never appears in their list."""
    import json as _json

    owner_tok = _mint_mcp_token(admin, make_client("editor"))

    # 1. Owner publishes an artifact (version 1).
    r = _rpc(mcp_client, "tools/call", token=owner_tok, params={
        "name": "publish_artifact",
        "arguments": {"name": "MCP Art", "body": "v1 body", "mime_type": "text/markdown"},
    })
    assert r.status_code == 200, r.text
    res = r.json()["result"]
    assert not res.get("isError"), res
    short_id = _json.loads(res["content"][0]["text"])["short_id"]

    # 2. Owner updates it → succeeds and bumps the version to 2.
    r = _rpc(mcp_client, "tools/call", token=owner_tok, params={
        "name": "update_artifact", "arguments": {"short_id": short_id, "body": "v2 body"},
    })
    res = r.json()["result"]
    assert not res.get("isError"), res
    assert _json.loads(res["content"][0]["text"]).get("version") == 2

    # 3. list_my_artifacts (owner) includes it.
    r = _rpc(mcp_client, "tools/call", token=owner_tok,
             params={"name": "list_my_artifacts", "arguments": {}})
    res = r.json()["result"]
    assert not res.get("isError") and short_id in res["content"][0]["text"], \
        "owner should see their own artifact"

    # 4. A different user cannot update it (owner/admin only) and never lists it.
    other_tok = _mint_mcp_token(admin, make_client("editor"))
    r = _rpc(mcp_client, "tools/call", token=other_tok, params={
        "name": "update_artifact", "arguments": {"short_id": short_id, "body": "hijack"},
    })
    assert r.json()["result"].get("isError") is True, \
        "non-owner update must be a clean PermissionError isError"
    r = _rpc(mcp_client, "tools/call", token=other_tok,
             params={"name": "list_my_artifacts", "arguments": {}})
    assert short_id not in r.json()["result"]["content"][0]["text"], \
        "list_my_artifacts is owner-scoped"


@requires_mcp
def test_FR_MCP_tools_reject_null_byte_cleanly(mcp_client, admin, make_client):
    """Regression: a null byte (0x00) in a tool argument that reaches the DB must
    be a clean isError, NOT a -32603 internal error + aborted transaction.
    (QA-found across list_pages / get_page / create_draft.)"""
    raw = _mint_mcp_token(admin, make_client("editor"))
    for name, args in [
        ("list_pages", {"category": "a\x00b"}),
        ("get_page", {"path": "a\x00b"}),
        ("create_draft", {"title": "T\x00", "body": "B", "new_page_path": "qa/mcpnull2"}),
    ]:
        s, err, is_err = _tool(mcp_client, raw, name, args)
        assert s == 200 and err is None, f"{name} null-byte crashed (-32603): {err}"
        assert is_err, f"{name} null-byte should be a clean isError"
