"""Personal MCP token management — covers FR-MTOK-001/002/003 (and the
FR-USR-004 admin mcp-access grant used to unlock token creation).

Black-box integration against the live backend on :8000 in stub auth mode.
The stored hash is never exposed through the API, so we assert the one-time
``raw_token`` shape (``wt_`` prefix) and the list/revoke contract instead.
"""
from __future__ import annotations

import pytest

from tests.conftest import uid


def _grant_mcp(admin, target_client) -> int:
    """Admin grants the target user mcp_enabled=true. Returns target user id."""
    tid = uid(target_client)
    r = admin.post(f"/api/users/{tid}/mcp-access", params={"enabled": True})
    assert r.status_code == 200, r.text
    assert r.json()["mcp_enabled"] is True
    return tid


def _set_mcp(admin, target_client, enabled: bool) -> int:
    tid = uid(target_client)
    r = admin.post(f"/api/users/{tid}/mcp-access", params={"enabled": enabled})
    assert r.status_code == 200, r.text
    assert r.json()["mcp_enabled"] is enabled
    return tid


def _mint_token(client, name: str = "t"):
    return client.post("/api/mcp-tokens", json={"name": name})


def _mint_token_or_skip(admin, client, name: str = "t") -> dict:
    """Grant + create a token, returning the TokenCreated json. If creation is
    broken upstream (the model_validate(raw_token) 500 — see
    test_FR_MTOK_002_create_returns_raw_wt_token), skip the dependent test
    instead of emitting a duplicate RED for the same root-cause bug."""
    _grant_mcp(admin, client)
    r = _mint_token(client, name=name)
    if r.status_code != 200:
        pytest.skip(
            f"blocked: POST /api/mcp-tokens returns {r.status_code} (token "
            f"creation broken — see test_FR_MTOK_002_create_returns_raw_wt_token)"
        )
    return r.json()


# ── FR-MTOK-002: create returns one-time raw wt_ token ─────────────────────

def test_FR_MTOK_002_create_returns_raw_wt_token(admin, make_client):
    user = make_client("contributor")
    _grant_mcp(admin, user)
    r = _mint_token(user, name="my-laptop")
    assert r.status_code == 200, r.text
    body = r.json()
    # One-time plaintext token, wt_ prefix (hash is stored, not returned).
    assert "raw_token" in body, body
    assert body["raw_token"].startswith("wt_"), body["raw_token"][:8]
    assert body["name"] == "my-laptop"
    # No expiry is set on personal MCP tokens.
    assert body["expires_at"] is None
    assert body["revoked_at"] is None


def test_FR_MTOK_002_create_without_mcp_access_403(admin, make_client):
    # NOTE: in this build `User.mcp_enabled` defaults to True, so a *fresh*
    # user is already permitted. To exercise the 403 guard we must explicitly
    # revoke access first. (The guard fires before the broken model_validate,
    # so this path returns a clean 403.)
    user = make_client("contributor")
    _set_mcp(admin, user, False)
    r = _mint_token(user)
    assert r.status_code == 403, r.text


# ── FR-MTOK-001: list shows active tokens, hides revoked ───────────────────

def test_FR_MTOK_001_list_empty_for_fresh_user(admin, make_client):
    # A granted user with no tokens lists an empty array (200, not 500 — this
    # path doesn't hit the broken raw_token validation).
    user = make_client("contributor")
    _grant_mcp(admin, user)
    r = user.get("/api/mcp-tokens")
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_FR_MTOK_001_list_active_only(admin, make_client):
    user = make_client("editor")
    t1 = _mint_token_or_skip(admin, user, name="keep")
    t2 = _mint_token_or_skip(admin, user, name="revoke-me")

    listed = user.get("/api/mcp-tokens")
    assert listed.status_code == 200, listed.text
    ids = {row["id"] for row in listed.json()}
    assert t1["id"] in ids and t2["id"] in ids
    # raw_token must NOT appear in the list view (only on creation).
    assert all("raw_token" not in row for row in listed.json())

    # Revoke t2 → it disappears from the active list.
    assert user.delete(f"/api/mcp-tokens/{t2['id']}").status_code == 200
    ids_after = {row["id"] for row in user.get("/api/mcp-tokens").json()}
    assert t1["id"] in ids_after
    assert t2["id"] not in ids_after


def test_FR_MTOK_001_list_scoped_to_caller(admin, make_client):
    # One user's tokens are invisible to another user.
    owner = make_client("contributor")
    other = make_client("contributor")
    tok = _mint_token_or_skip(admin, owner, name="owners")

    other_ids = {row["id"] for row in other.get("/api/mcp-tokens").json()}
    assert tok["id"] not in other_ids


# ── FR-MTOK-003: revoke — 404 when not owned; idempotent re-revoke ─────────

def test_FR_MTOK_003_revoke_not_owned_404(admin, make_client):
    owner = make_client("contributor")
    intruder = make_client("contributor")
    tok = _mint_token_or_skip(admin, owner, name="owners")
    # Intruder cannot revoke someone else's token → 404 (not 403, by design).
    r = intruder.delete(f"/api/mcp-tokens/{tok['id']}")
    assert r.status_code == 404, r.text


def test_FR_MTOK_003_revoke_missing_404(admin, make_client):
    user = make_client("contributor")
    _grant_mcp(admin, user)
    r = user.delete("/api/mcp-tokens/99999999")
    assert r.status_code == 404, r.text


def test_FR_MTOK_003_revoke_idempotent(admin, make_client):
    user = make_client("contributor")
    tok = _mint_token_or_skip(admin, user)
    first = user.delete(f"/api/mcp-tokens/{tok['id']}")
    assert first.status_code == 200, first.text
    second = user.delete(f"/api/mcp-tokens/{tok['id']}")
    assert second.status_code == 200, second.text
    assert second.json().get("already_revoked") is True, second.text
