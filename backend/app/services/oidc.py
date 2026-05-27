"""OIDC authorization-code flow with PKCE.

Backs `GET /api/auth/oidc/login` + `GET /api/auth/oidc/callback`
(issue #5). The state, nonce, and code_verifier are stored in a
short-lived HttpOnly cookie keyed by the random state value, so we
don't need a server-side session store. The cookie is signed with
`settings.jwt_secret` (HMAC) to prevent the client from forging
state in a callback.

ID-token signature validation goes through the IdP's JWKS, fetched
from the well-known discovery document and cached in-process for
the lifetime of the worker.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Any, Optional

import httpx
import jwt as pyjwt
from authlib.jose import JsonWebKey, jwt as ajwt

from app.core.config import settings

log = logging.getLogger(__name__)

_DISCOVERY_TTL = 60 * 60  # 1 hour
_discovery_cache: dict[str, tuple[float, dict]] = {}
_jwks_cache: dict[str, tuple[float, Any]] = {}


@dataclass
class OidcDiscovery:
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    issuer: str


async def get_discovery() -> OidcDiscovery:
    """Fetch + cache `${issuer}/.well-known/openid-configuration`."""
    issuer = settings.oidc_issuer.rstrip("/")
    now = time.time()
    cached = _discovery_cache.get(issuer)
    if cached and now - cached[0] < _DISCOVERY_TTL:
        d = cached[1]
    else:
        url = f"{issuer}/.well-known/openid-configuration"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            d = resp.json()
        _discovery_cache[issuer] = (now, d)
    return OidcDiscovery(
        authorization_endpoint=d["authorization_endpoint"],
        token_endpoint=d["token_endpoint"],
        jwks_uri=d["jwks_uri"],
        issuer=d.get("issuer", issuer),
    )


async def _get_jwks() -> Any:
    disc = await get_discovery()
    now = time.time()
    cached = _jwks_cache.get(disc.jwks_uri)
    if cached and now - cached[0] < _DISCOVERY_TTL:
        return cached[1]
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(disc.jwks_uri)
        resp.raise_for_status()
        keyset = JsonWebKey.import_key_set(resp.json())
    _jwks_cache[disc.jwks_uri] = (now, keyset)
    return keyset


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def make_pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for PKCE S256."""
    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def random_state() -> str:
    return secrets.token_urlsafe(24)


def sign_state_cookie(state: str, nonce: str, code_verifier: str) -> str:
    """Wrap the state material in a short-lived signed JWT cookie."""
    payload = {
        "state": state,
        "nonce": nonce,
        "cv": code_verifier,
        "exp": int(time.time()) + 600,  # 10 minutes
    }
    return pyjwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def read_state_cookie(token: str) -> Optional[dict]:
    try:
        return pyjwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except pyjwt.PyJWTError:
        return None


async def exchange_code_for_tokens(code: str, code_verifier: str) -> dict:
    disc = await get_discovery()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            disc.token_endpoint,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.oidc_redirect_uri,
                "client_id": settings.oidc_client_id,
                "client_secret": settings.oidc_client_secret,
                "code_verifier": code_verifier,
            },
            headers={"Accept": "application/json"},
        )
        if resp.status_code >= 400:
            log.warning("OIDC token endpoint %s: %s", resp.status_code, resp.text)
            raise ValueError(f"Token endpoint returned {resp.status_code}")
        return resp.json()


async def validate_id_token(id_token: str, expected_nonce: str) -> dict:
    """Validate ID-token signature against JWKS + check standard claims."""
    keyset = await _get_jwks()
    disc = await get_discovery()
    # authlib's jwt.decode validates signature against the keyset.
    claims = ajwt.decode(
        id_token, keyset,
        claims_options={
            "iss": {"essential": True, "value": disc.issuer},
            "aud": {"essential": True, "value": settings.oidc_client_id},
            "exp": {"essential": True},
        },
    )
    claims.validate()
    if claims.get("nonce") != expected_nonce:
        raise ValueError("nonce mismatch — possible replay")
    return dict(claims)


def authorization_url(state: str, nonce: str, code_challenge: str) -> str:
    """Build the IdP authorize URL the user is redirected to."""
    # Discovery is async; the auth-url builder is called from sync request
    # context. Caller pre-fetched discovery via the lifespan/middleware,
    # so we can read from cache. Fall back to raw issuer if not cached.
    issuer = settings.oidc_issuer.rstrip("/")
    cached = _discovery_cache.get(issuer)
    if not cached:
        # Caller didn't warm cache — best effort: use the conventional URL.
        endpoint = f"{issuer}/oauth/authorize"
    else:
        endpoint = cached[1]["authorization_endpoint"]
    from urllib.parse import urlencode
    qs = urlencode({
        "client_id": settings.oidc_client_id,
        "redirect_uri": settings.oidc_redirect_uri,
        "response_type": "code",
        "scope": settings.oidc_scopes,
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    })
    return f"{endpoint}?{qs}"
