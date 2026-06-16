"""[API] FR-AUTH-* and FR-USR-* — auth/session/token/preferences + user admin.

Black-box against the live backend on :8000 in stub auth mode. Each test name
maps 1:1 to an SRS requirement id (docs/srs/backend-functional.md). Where setup
is infeasible purely via API (OIDC flows), the relevant part is skipped with a
reason rather than faked.
"""
from __future__ import annotations

import base64
import json

import httpx
import pytest

from tests.conftest import BASE_URL, email_of, uid, unique_email


def _jwt_payload(token: str) -> dict:
    """Decode the (unverified) payload segment of an HS256 JWT."""
    seg = token.split(".")[1]
    seg += "=" * (-len(seg) % 4)  # pad base64url
    return json.loads(base64.urlsafe_b64decode(seg))


# --------------------------------------------------------------------------
# FR-AUTH-001 — GET /api/auth/config, no auth
# --------------------------------------------------------------------------
def test_FR_AUTH_001_config_no_auth(anon):
    r = anon.get("/api/auth/config")
    assert r.status_code == 200, r.text
    cfg = r.json()
    assert set(cfg) == {"mode", "oidc_enabled", "local_admin_enabled"}
    # In stub mode oidc must be disabled regardless of issuer/client config.
    assert cfg["mode"] == "stub"
    assert cfg["oidc_enabled"] is False
    # local_admin_enabled is a pure bool reflecting admin_email+password.
    assert isinstance(cfg["local_admin_enabled"], bool)


# --------------------------------------------------------------------------
# FR-AUTH-002 / FR-AUTH-003 — static-admin login (POST /api/auth/login)
# --------------------------------------------------------------------------
def _admin_creds():
    """The configured static-admin (email, password), or None. Read from
    settings since the test process runs inside the backend container; login
    success can't be asserted without the real password."""
    from app.core.config import settings
    if not (settings.admin_email and settings.admin_password):
        return None
    return settings.admin_email, settings.admin_password


def test_FR_AUTH_002_login_correct_creds_returns_admin_jwt(anon):
    creds = _admin_creds()
    if creds is None:
        pytest.skip("no static admin configured (ADMIN_EMAIL/ADMIN_PASSWORD)")
    email, password = creds
    r = anon.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["role"] == "admin"
    assert _jwt_payload(body["token"]).get("role") == "admin"


def test_FR_AUTH_003_login_wrong_password_401(anon):
    creds = _admin_creds()
    if creds is None:
        pytest.skip("no static admin configured")
    email, _ = creds
    r = anon.post("/api/auth/login", json={"email": email, "password": "definitely-not-it"})
    assert r.status_code == 401, r.text


def test_FR_AUTH_003_login_non_ascii_password_clean_401(anon):
    """Regression: a non-ASCII password must yield a clean 401, never a 500.
    secrets.compare_digest raises TypeError on non-ASCII str input; the endpoint
    compares bytes so any unicode credential simply fails the check (QA find)."""
    if _admin_creds() is None:
        pytest.skip("login not configured → 404 short-circuits before the compare")
    r = anon.post("/api/auth/login", json={"email": "nobody@example.com", "password": "密码非ASCII–π"})
    assert r.status_code == 401, f"non-ASCII password must be 401, got {r.status_code}: {r.text}"


def test_FR_AUTH_003_login_non_ascii_email_clean_401(anon):
    """Same byte-vs-str compare hazard on the email field."""
    if _admin_creds() is None:
        pytest.skip("login not configured")
    r = anon.post("/api/auth/login", json={"email": "用户@example.com", "password": "whatever"})
    assert r.status_code == 401, f"non-ASCII email must be 401, got {r.status_code}: {r.text}"


# --------------------------------------------------------------------------
# FR-AUTH-005 — POST /api/auth/dev-login (stub only)
# --------------------------------------------------------------------------
def test_FR_AUTH_005_dev_login_default_role(anon):
    email = unique_email("devlogin")
    r = anon.post("/api/auth/dev-login", params={"email": email})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and "user" in data
    # default role is contributor
    assert data["user"]["role"] == "contributor"
    assert data["user"]["email"] == email
    # the JWT decodes to the requested role
    assert _jwt_payload(data["token"])["role"] == "contributor"


# --------------------------------------------------------------------------
# FR-AUTH-007 / 008 / 014 — bearer JWT resolution, stub header auth, logout
# --------------------------------------------------------------------------
def test_FR_AUTH_007_jwt_bearer_resolves_principal(anon):
    email = unique_email("jwtbearer")
    tok = anon.post("/api/auth/dev-login", params={"email": email}).json()["token"]
    assert tok.startswith("eyJ"), "expected an HS256 JWT"
    r = anon.get("/api/auth/whoami", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    assert r.json()["email"] == email


def test_FR_AUTH_008_stub_header_valid_role_applied(anon):
    email = unique_email("stubrole")
    r = anon.get("/api/auth/whoami", headers={"X-User-Email": email, "X-User-Role": "editor"})
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "editor"


def test_FR_AUTH_008_stub_header_invalid_role_defaults_contributor(anon):
    # An unrecognized X-User-Role must NOT error or grant a bogus role — it
    # falls back to the default (contributor).
    email = unique_email("stubrole")
    r = anon.get("/api/auth/whoami", headers={"X-User-Email": email, "X-User-Role": "not-a-real-role"})
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "contributor"


def test_FR_AUTH_014_logout_returns_200_and_clears_state_cookie(anon):
    r = anon.post("/api/auth/logout")
    assert r.status_code == 200, r.text
    # Logout deletes the OIDC state cookie (there is no server session store).
    assert "wiki_oidc_state" in r.headers.get("set-cookie", "").lower(), r.headers


def test_FR_AUTH_005_dev_login_explicit_role(anon):
    email = unique_email("devlogin")
    r = anon.post("/api/auth/dev-login", params={"email": email, "role": "editor"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "editor"
    assert _jwt_payload(r.json()["token"])["role"] == "editor"


def test_FR_AUTH_005_dev_login_invalid_role_400(anon):
    r = anon.post(
        "/api/auth/dev-login",
        params={"email": unique_email("devlogin"), "role": "wizard"},
    )
    assert r.status_code == 400, r.text


def test_FR_AUTH_005_dev_login_creates_user_if_absent(anon):
    email = unique_email("devnew")
    # First dev-login creates the user; whoami via the issued JWT confirms it.
    r = anon.post("/api/auth/dev-login", params={"email": email, "role": "reader"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    who = anon.get("/api/auth/whoami", headers={"Authorization": f"Bearer {token}"})
    assert who.status_code == 200, who.text
    assert who.json()["email"] == email
    assert who.json()["role"] == "reader"


# --------------------------------------------------------------------------
# FR-AUTH-006 — Bearer resolution of wt_* api tokens
# (revoked/expired rejected; valid stamps last_used_at)
# --------------------------------------------------------------------------
def test_FR_AUTH_006_wt_token_bearer_resolves_and_revokes(editor):
    raw = editor.post("/api/auth/tokens", json={"name": "bearer-probe"}).json()["raw_token"]
    assert raw.startswith("wt_")
    bare = httpx.Client(base_url=BASE_URL, headers={"Authorization": f"Bearer {raw}"})
    try:
        assert bare.get("/api/auth/whoami").status_code == 200
        # last_used_at is stamped after a successful resolution.
        tok = editor.get("/api/auth/tokens").json()[0]
        assert tok["last_used_at"] is not None
        # revoke -> bearer rejected with 401.
        editor.delete(f"/api/auth/tokens/{tok['id']}")
        assert bare.get("/api/auth/whoami").status_code == 401
    finally:
        bare.close()


def test_FR_AUTH_006_jwt_bearer_resolves_principal(anon):
    """The JWT branch of Bearer resolution (a valid eyJ* token names the
    principal). Exercised here because the wt_* path is blocked by the
    FR-AUTH-015 bug; this proves Bearer auth itself works."""
    email = unique_email("jwtbearer")
    token = anon.post(
        "/api/auth/dev-login", params={"email": email, "role": "editor"}
    ).json()["token"]
    assert token.startswith("eyJ")
    r = anon.get("/api/auth/whoami", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert r.json()["email"] == email


def test_FR_AUTH_006_garbage_bearer_401(anon):
    r = anon.get(
        "/api/auth/whoami", headers={"Authorization": "Bearer wt_not_a_real_token"}
    )
    assert r.status_code == 401, r.text


# --------------------------------------------------------------------------
# FR-AUTH-009 — GET /api/auth/whoami returns the full UserOut
# --------------------------------------------------------------------------
def test_FR_AUTH_009_whoami_shape(editor):
    r = editor.get("/api/auth/whoami")
    assert r.status_code == 200, r.text
    u = r.json()
    for field in (
        "id", "email", "name", "role", "is_agent",
        "owner_id", "mcp_enabled", "is_active", "preferences",
    ):
        assert field in u, f"whoami missing {field}: {u}"
    assert u["role"] == "editor"
    assert u["email"] == email_of(editor)
    assert u["is_agent"] is False
    assert u["is_active"] is True
    assert isinstance(u["preferences"], dict)


def test_FR_AUTH_009_whoami_requires_principal(anon):
    assert anon.get("/api/auth/whoami").status_code == 401


# --------------------------------------------------------------------------
# FR-AUTH-010 — PUT /api/auth/me/preferences (replace; 400 non-object; 413 >64KB)
# --------------------------------------------------------------------------
def test_FR_AUTH_010_preferences_replace_visible_via_whoami(contributor):
    prefs = {"theme": "dark", "hotkeys": {"save": "ctrl+s"}}
    r = contributor.put("/api/auth/me/preferences", json=prefs)
    assert r.status_code == 200, r.text
    assert r.json()["preferences"] == prefs
    # visible via whoami
    assert contributor.get("/api/auth/whoami").json()["preferences"] == prefs
    # wholesale replace: a new (disjoint) body fully overwrites the old.
    r2 = contributor.put("/api/auth/me/preferences", json={"lang": "en"})
    assert r2.status_code == 200, r2.text
    assert r2.json()["preferences"] == {"lang": "en"}


def test_FR_AUTH_010_preferences_non_object_400(contributor):
    # SRS: a non-object body -> 400. (RED finding: the handler is typed
    # `body: dict = Body(...)`, so Pydantic rejects a non-object with 422
    # *before* the handler's own `isinstance` 400 guard can run — that guard
    # is dead code. Actual = 422, SRS = 400. Assert the SRS contract.)
    r = contributor.put("/api/auth/me/preferences", json=[1, 2, 3])
    assert r.status_code == 400, r.text


def test_FR_AUTH_010_preferences_too_large_413(contributor):
    # Serialized body > 64 KB -> 413.
    big = {"blob": "x" * (65 * 1024)}
    r = contributor.put("/api/auth/me/preferences", json=big)
    assert r.status_code == 413, r.text


# --------------------------------------------------------------------------
# FR-AUTH-015 — GET/POST/DELETE /api/auth/tokens
# create (+expires_in_days), list includes revoked, revoke-not-owned -> 404
# --------------------------------------------------------------------------
def test_FR_AUTH_015_create_token_returns_raw_wt(editor):
    """SRS: create returns a one-time raw wt_* token. (RED: handler 500s —
    TokenCreated.model_validate(token) runs before raw_token is set.)"""
    r = editor.post("/api/auth/tokens", json={"name": "t1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["raw_token"].startswith("wt_")
    assert body["name"] == "t1"
    assert body["revoked_at"] is None


def test_FR_AUTH_015_create_token_with_expiry(editor):
    """SRS: create supports expires_in_days (sets expires_at). (RED via same
    FR-AUTH-015 500.)"""
    r = editor.post("/api/auth/tokens", json={"name": "t2", "expires_in_days": 7})
    assert r.status_code == 200, r.text
    assert r.json()["expires_at"] is not None


def test_FR_AUTH_015_list_includes_revoked(editor):
    """SRS: list includes revoked tokens. Depends on create succeeding;
    RED while create 500s (FR-AUTH-015 bug)."""
    created = editor.post("/api/auth/tokens", json={"name": "t3"})
    assert created.status_code == 200, created.text
    tid = created.json()["id"]
    assert editor.delete(f"/api/auth/tokens/{tid}").status_code == 200
    listing = editor.get("/api/auth/tokens")
    assert listing.status_code == 200, listing.text
    match = [t for t in listing.json() if t["id"] == tid]
    assert match and match[0]["revoked_at"] is not None, "revoked token must stay listed"


def test_FR_AUTH_015_revoke_not_owned_404(editor, make_client):
    """SRS: revoking a token not owned by the caller -> 404. Depends on a
    token existing; RED while create 500s (FR-AUTH-015 bug)."""
    created = editor.post("/api/auth/tokens", json={"name": "owned"})
    assert created.status_code == 200, created.text
    tid = created.json()["id"]
    other = make_client("editor")
    assert other.delete(f"/api/auth/tokens/{tid}").status_code == 404


def test_FR_AUTH_015_revoke_missing_404(editor):
    # A non-existent token id -> 404 (this path does not depend on create).
    assert editor.delete("/api/auth/tokens/999999999").status_code == 404


def test_FR_AUTH_015_list_empty_for_fresh_user(editor):
    # A brand-new user has no tokens; list is an empty array (200).
    r = editor.get("/api/auth/tokens")
    assert r.status_code == 200, r.text
    assert r.json() == []


# --------------------------------------------------------------------------
# FR-USR-001 — GET /api/users returns only active users, ordered by name
# --------------------------------------------------------------------------
def test_FR_USR_001_list_active(admin, contributor):
    me = uid(admin)
    other = uid(contributor)
    rows = admin.get("/api/users").json()
    ids = {u["id"] for u in rows}
    assert me in ids and other in ids
    # all returned users are active
    assert all(u["is_active"] for u in rows)


def test_FR_USR_001_ordered_by_name(admin, make_client):
    # Verify "ORDER BY name" over a controlled subset whose names differ only by
    # a trailing digit, so every collation (Postgres locale vs Python) agrees.
    # (Asserting the whole list == python-sorted is flaky: PG locale collation
    # reorders punctuation like '-'/'%40' differently from Python's bytewise
    # sort. This subset isolates the ordering guarantee from collation.)
    import uuid

    tag = uuid.uuid4().hex[:8]
    clients = []
    expected_names = []
    for i in (3, 1, 2):  # create out of order on purpose
        name = f"zzord{tag}{i}"
        c = make_client("contributor", email=f"{name}@example.com")
        # dev-login isn't needed; first whoami auto-creates with name=email local-part
        c.get("/api/auth/whoami")
        clients.append(c)
        expected_names.append(name)
    rows = admin.get("/api/users").json()
    got = [u["name"] for u in rows if u["name"].startswith(f"zzord{tag}")]
    assert got == sorted(expected_names), f"users must be ordered by name: {got}"


def test_FR_USR_001_deactivated_excluded(admin, make_client):
    victim = make_client("contributor")
    vid = uid(victim)
    assert admin.post(f"/api/users/{vid}/deactivate").status_code == 200
    ids = {u["id"] for u in admin.get("/api/users").json()}
    assert vid not in ids, "deactivated user must be excluded from list"


# --------------------------------------------------------------------------
# FR-USR-002 — POST /api/users/{id}/role (admin only, 400 bad role, 404 missing)
# --------------------------------------------------------------------------
def test_FR_USR_002_role_change_admin_only(admin, make_client):
    target = make_client("contributor")
    tid = uid(target)
    r = admin.post(f"/api/users/{tid}/role", params={"role": "editor"})
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "editor"
    # the change is reflected in whoami for that user
    assert target.get("/api/auth/whoami").json()["role"] == "editor"


def test_FR_USR_002_role_change_non_admin_403(editor, make_client):
    target = make_client("contributor")
    tid = uid(target)
    assert editor.post(f"/api/users/{tid}/role", params={"role": "admin"}).status_code == 403


def test_FR_USR_002_role_change_invalid_role_400(admin, make_client):
    target = make_client("contributor")
    tid = uid(target)
    assert admin.post(f"/api/users/{tid}/role", params={"role": "overlord"}).status_code == 400


def test_FR_USR_002_role_change_missing_user_404(admin):
    assert admin.post("/api/users/999999999/role", params={"role": "editor"}).status_code == 404


# --------------------------------------------------------------------------
# FR-USR-003 — POST /api/users/{id}/deactivate (admin; sets is_active=False; 404)
# --------------------------------------------------------------------------
def test_FR_USR_003_deactivate_sets_inactive(admin, make_client):
    victim = make_client("contributor")
    vid = uid(victim)
    r = admin.post(f"/api/users/{vid}/deactivate")
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is False


def test_FR_USR_003_deactivate_non_admin_403(editor, make_client):
    victim = make_client("contributor")
    vid = uid(victim)
    assert editor.post(f"/api/users/{vid}/deactivate").status_code == 403


def test_FR_USR_003_deactivate_missing_404(admin):
    assert admin.post("/api/users/999999999/deactivate").status_code == 404


# --------------------------------------------------------------------------
# FR-USR-004 — POST /api/users/{id}/mcp-access (admin; toggles mcp_enabled)
# --------------------------------------------------------------------------
def test_FR_USR_004_mcp_access_toggle(admin, make_client):
    target = make_client("contributor")
    tid = uid(target)
    off = admin.post(f"/api/users/{tid}/mcp-access", params={"enabled": "false"})
    assert off.status_code == 200, off.text
    assert off.json()["mcp_enabled"] is False
    on = admin.post(f"/api/users/{tid}/mcp-access", params={"enabled": "true"})
    assert on.status_code == 200, on.text
    assert on.json()["mcp_enabled"] is True


def test_FR_USR_004_mcp_access_non_admin_403(editor, make_client):
    target = make_client("contributor")
    tid = uid(target)
    assert editor.post(
        f"/api/users/{tid}/mcp-access", params={"enabled": "false"}
    ).status_code == 403


def test_FR_USR_004_mcp_access_missing_404(admin):
    assert admin.post(
        "/api/users/999999999/mcp-access", params={"enabled": "true"}
    ).status_code == 404
