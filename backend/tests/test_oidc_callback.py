"""[API-mocked] OIDC endpoint integration tests — the real flow in OIDC mode.

These exercise `GET /api/auth/oidc/callback` + `/oidc/login` (FR-AUTH-011/012/013).
They need a backend in OIDC mode; the normal suite runs in *stub* mode, so each
test SKIPS unless its required instance is reachable. Two instances are used:

1. **Error/CSRF instance** (`WIKI_OIDC_BASE_URL`, default :8011) — points at an
   *unreachable* IdP, so the CSRF/error paths short-circuit before any IdP call
   and the IdP-dependent paths fail with 502. Start it:

       docker exec -d wiki-backend-1 sh -c "cd /app && AUTH_MODE=oidc \\
         OIDC_ISSUER=http://127.0.0.1:1 OIDC_CLIENT_ID=test-client \\
         OIDC_CLIENT_SECRET=test-secret JWT_SECRET=known-secret-12345 \\
         OIDC_REDIRECT_URI=http://localhost:3000/auth/callback \\
         uvicorn app.main:app --host 0.0.0.0 --port 8011"

2. **Success instance** (`WIKI_OIDC_FULL_BASE_URL`, default :8013) — points at a
   **mock IdP** (a tiny RS256-signing server, see `tests/mock_idp.py`) so the
   full happy path works. Start the mock IdP then the backend:

       docker exec -d wiki-backend-1 python /app/tests/mock_idp.py   # :9990
       docker exec -d wiki-backend-1 sh -c "cd /app && AUTH_MODE=oidc \\
         OIDC_ISSUER=http://localhost:9990 OIDC_CLIENT_ID=test-client \\
         OIDC_CLIENT_SECRET=test-secret JWT_SECRET=known-secret-12345 \\
         ADMIN_EMAIL=oidc-success@example.com \\
         OIDC_REDIRECT_URI=http://localhost:3000/auth/callback \\
         uvicorn app.main:app --host 0.0.0.0 --port 8013"
"""
from __future__ import annotations

import base64
import json
import os
import time

import httpx
import jwt
import pytest

OIDC_BASE = os.environ.get("WIKI_OIDC_BASE_URL", "http://localhost:8011")
FULL_OIDC_BASE = os.environ.get("WIKI_OIDC_FULL_BASE_URL", "http://localhost:8013")
OIDC_SECRET = os.environ.get("WIKI_OIDC_SECRET", "known-secret-12345")
# The nonce + email the mock IdP's signed id_token carries (see tests/mock_idp.py).
MOCK_NONCE = "fixed-test-nonce-abc"
MOCK_EMAIL = "oidc-success@example.com"


def _oidc_mode(base: str) -> bool:
    try:
        r = httpx.get(f"{base}/api/auth/config", timeout=2)
        return r.status_code == 200 and r.json().get("mode") == "oidc"
    except Exception:
        return False


needs_oidc = pytest.mark.skipif(
    not _oidc_mode(OIDC_BASE),
    reason=f"no error/CSRF OIDC backend at {OIDC_BASE} (see module docstring)",
)
needs_full_oidc = pytest.mark.skipif(
    not _oidc_mode(FULL_OIDC_BASE),
    reason=f"no mock-IdP OIDC backend at {FULL_OIDC_BASE} (see module docstring)",
)


def _c(base: str = OIDC_BASE) -> httpx.Client:
    return httpx.Client(base_url=base, follow_redirects=False, timeout=15)


def _state_cookie(state: str, nonce: str = "n", cv: str = "v") -> str:
    return jwt.encode(
        {"state": state, "nonce": nonce, "cv": cv, "exp": int(time.time()) + 600},
        OIDC_SECRET, algorithm="HS256",
    )


# ── FR-AUTH-012: callback CSRF + error handling (unreachable-IdP instance) ───

@needs_oidc
def test_FR_AUTH_012_callback_idp_error_param_400():
    with _c() as c:
        assert c.get("/api/auth/oidc/callback", params={"error": "access_denied"}).status_code == 400


@needs_oidc
def test_FR_AUTH_012_callback_missing_state_cookie_400():
    with _c() as c:
        assert c.get("/api/auth/oidc/callback", params={"code": "x", "state": "y"}).status_code == 400


@needs_oidc
def test_FR_AUTH_012_callback_state_mismatch_is_csrf_400():
    """The headline CSRF guard: a valid signed cookie but a mismatched `state`
    query param → 400, so an attacker can't replay a callback against a victim."""
    with _c() as c:
        r = c.get("/api/auth/oidc/callback", params={"code": "x", "state": "WRONG"},
                  cookies={"wiki_oidc_state": _state_cookie("RIGHT")})
        assert r.status_code == 400, r.text


@needs_oidc
def test_FR_AUTH_012_callback_tampered_cookie_400():
    with _c() as c:
        ck = _state_cookie("RIGHT")
        r = c.get("/api/auth/oidc/callback", params={"code": "x", "state": "RIGHT"},
                  cookies={"wiki_oidc_state": ck[:-4] + "zzzz"})
        assert r.status_code == 400


@needs_oidc
def test_FR_AUTH_012_callback_valid_state_unreachable_idp_502():
    """A matching state passes CSRF, then the code exchange to the (unreachable)
    IdP fails → 502, not a 500."""
    with _c() as c:
        r = c.get("/api/auth/oidc/callback", params={"code": "x", "state": "RIGHT"},
                  cookies={"wiki_oidc_state": _state_cookie("RIGHT")})
        assert r.status_code == 502, r.text


@needs_oidc
def test_FR_AUTH_011_oidc_login_discovery_failure_502():
    with _c() as c:
        assert c.get("/api/auth/oidc/login").status_code == 502


@needs_oidc
def test_FR_AUTH_004_local_login_404_when_not_configured():
    """FR-AUTH-004: this oidc instance sets no ADMIN_EMAIL/PASSWORD, so the
    static-admin login is disabled — `POST /api/auth/login` → 404, not 401/500."""
    with _c() as c:
        assert c.get("/api/auth/config").json()["local_admin_enabled"] is False
        r = c.post("/api/auth/login", json={"email": "x@example.com", "password": "p"})
        assert r.status_code == 404, r.text


# ── FR-AUTH-013: full success path (mock-IdP instance) ───────────────────────

@needs_full_oidc
def test_FR_AUTH_013_oidc_login_success_upserts_user_and_delivers_jwt():
    """The complete happy path against a mock IdP: a matching state passes CSRF →
    the code is exchanged at the mock IdP → the RS256 id_token is validated
    (signature via JWKS, iss/aud/exp, and nonce) → the user is upserted (promoted
    to admin because the email matches ADMIN_EMAIL) → the session JWT is delivered
    via the `#token` URL fragment, and the OIDC state cookie is cleared."""
    with _c(FULL_OIDC_BASE) as c:
        cookie = _state_cookie("S", nonce=MOCK_NONCE, cv="V")
        r = c.get("/api/auth/oidc/callback", params={"code": "any-code", "state": "S"},
                  cookies={"wiki_oidc_state": cookie})
        assert r.status_code == 302, r.text
        loc = r.headers.get("location", "")
        assert "#token=" in loc, loc

        seg = loc.split("#token=")[1].split(".")[1]
        seg += "=" * (-len(seg) % 4)  # pad base64url
        claims = json.loads(base64.urlsafe_b64decode(seg))
        assert claims["email"] == MOCK_EMAIL
        assert claims["role"] == "admin", "ADMIN_EMAIL match should promote to admin"
        # the short-lived state cookie is deleted after a successful login
        assert "wiki_oidc_state" in r.headers.get("set-cookie", "").lower()


@needs_full_oidc
def test_FR_AUTH_013_oidc_login_redirects_to_idp_with_pkce():
    """`/oidc/login` performs discovery against the (reachable) mock IdP and
    302-redirects to its authorize endpoint with PKCE + a state cookie."""
    with _c(FULL_OIDC_BASE) as c:
        r = c.get("/api/auth/oidc/login")
        assert r.status_code == 302, r.text
        loc = r.headers.get("location", "")
        assert "code_challenge_method=S256" in loc and "response_type=code" in loc
        assert "wiki_oidc_state" in r.headers.get("set-cookie", "").lower()
