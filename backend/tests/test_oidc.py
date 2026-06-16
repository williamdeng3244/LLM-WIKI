"""Unit tests for the OIDC crypto/state layer (`app.services.oidc`).

These cover the security-critical primitives the [API-mocked] callback can't
reach without a live IdP: the signed **CSRF state cookie**, **PKCE** S256, and
the authorize-URL construction. They import the service directly (the test
process runs inside the backend container) and need no IdP. Maps to
FR-AUTH-011/012/013.
"""
from __future__ import annotations

import base64
import hashlib
import time

import jwt as pyjwt

from app.core.config import settings
from app.services import oidc


def test_FR_AUTH_011_pkce_pair_is_valid_s256():
    """PKCE: challenge == base64url(sha256(verifier)), no padding."""
    verifier, challenge = oidc.make_pkce_pair()
    expect = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert challenge == expect
    assert verifier != challenge and len(verifier) >= 40 and "=" not in challenge


def test_FR_AUTH_012_state_cookie_roundtrips():
    """A signed state cookie carries state/nonce/code_verifier intact."""
    c = oidc.sign_state_cookie("st-1", "nonce-1", "verifier-1")
    got = oidc.read_state_cookie(c)
    assert got is not None
    assert got["state"] == "st-1" and got["nonce"] == "nonce-1" and got["cv"] == "verifier-1"


def test_FR_AUTH_012_state_cookie_tampered_rejected():
    """A tampered cookie (modified signature) must fail to verify (CSRF guard)."""
    c = oidc.sign_state_cookie("st", "no", "cv")
    tampered = c[:-4] + ("aaaa" if c[-4:] != "aaaa" else "bbbb")
    assert oidc.read_state_cookie(tampered) is None


def test_FR_AUTH_012_state_cookie_wrong_secret_rejected():
    """A cookie forged with a DIFFERENT secret must be rejected — the client
    cannot mint its own state (CSRF)."""
    forged = pyjwt.encode(
        {"state": "x", "nonce": "y", "cv": "z", "exp": int(time.time()) + 600},
        settings.jwt_secret + "-WRONG", algorithm="HS256",
    )
    assert oidc.read_state_cookie(forged) is None


def test_FR_AUTH_012_state_cookie_expired_rejected():
    """An expired state cookie is rejected (10-min window)."""
    expired = pyjwt.encode(
        {"state": "x", "nonce": "y", "cv": "z", "exp": int(time.time()) - 10},
        settings.jwt_secret, algorithm="HS256",
    )
    assert oidc.read_state_cookie(expired) is None


def test_FR_AUTH_011_authorization_url_carries_pkce_and_state():
    """The authorize URL must carry response_type=code, PKCE S256, state, nonce."""
    url = oidc.authorization_url("STATE123", "NONCE123", "CHALLENGE123")
    for frag in ("response_type=code", "code_challenge_method=S256",
                 "state=STATE123", "nonce=NONCE123", "code_challenge=CHALLENGE123"):
        assert frag in url, f"missing {frag} in {url}"


# -- FR-AUTH-016: boot guard refuses to start oidc mode without config --------
def _set_auth(monkeypatch, **kw):
    from app.core.config import settings
    for k, v in kw.items():
        monkeypatch.setattr(settings, k, v)


def test_FR_AUTH_016_boot_guard_refuses_oidc_without_config(monkeypatch):
    """AUTH_MODE=oidc with neither OIDC config nor a static admin must raise at
    startup (else every request 401s silently)."""
    import pytest
    from app import main
    _set_auth(monkeypatch, auth_mode="oidc", oidc_issuer="", oidc_client_id="",
              oidc_client_secret="", admin_email="", admin_password="")
    with pytest.raises(RuntimeError):
        main._validate_auth_config()


def test_FR_AUTH_016_boot_guard_allows_oidc_with_config(monkeypatch):
    from app import main
    _set_auth(monkeypatch, auth_mode="oidc", oidc_issuer="http://idp",
              oidc_client_id="c", oidc_client_secret="s")
    main._validate_auth_config()  # full OIDC config → no raise


def test_FR_AUTH_016_boot_guard_allows_static_admin_fallback(monkeypatch):
    """A configured static admin alone is enough (documented break-glass)."""
    from app import main
    _set_auth(monkeypatch, auth_mode="oidc", oidc_issuer="", oidc_client_id="",
              oidc_client_secret="", admin_email="a@b.c", admin_password="pw")
    main._validate_auth_config()  # static admin fallback → no raise
