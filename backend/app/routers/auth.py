"""Auth: whoami, login (static admin + OIDC), tokens, logout."""
import logging
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, Body, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user, hash_token, make_session_jwt, make_token, optional_user
from app.core.config import settings
from app.core.db import get_session
from app.models import ApiToken, Role, User
from app.schemas import (
    AuthConfig, LoginRequest, LoginResponse,
    TokenCreate, TokenCreated, TokenOut, UserOut,
)
from app.services import oidc

log = logging.getLogger(__name__)
_OIDC_COOKIE = "wiki_oidc_state"

router = APIRouter()


@router.get("/whoami", response_model=UserOut)
async def whoami(user: User = Depends(current_user)):
    return user


@router.put("/me/preferences", response_model=UserOut)
async def update_my_preferences(
    body: dict = Body(...),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Replace the signed-in user's UI preferences (custom hotkeys, etc.).
    Account-bound, so customizations follow the user across devices. The
    payload is the full preferences object; size-capped to keep the JSON
    column sane."""
    import json as _json
    if not isinstance(body, dict):
        raise HTTPException(400, "preferences must be a JSON object")
    if len(_json.dumps(body)) > 64 * 1024:
        raise HTTPException(413, "preferences too large (max 64 KB)")
    user.preferences = body
    await session.commit()
    await session.refresh(user)
    return user


@router.get("/config", response_model=AuthConfig)
async def auth_config():
    """Tells the login screen which sign-in options to show."""
    return AuthConfig(
        mode=settings.auth_mode,
        oidc_enabled=bool(
            settings.auth_mode == "oidc"
            and settings.oidc_issuer
            and settings.oidc_client_id
        ),
        local_admin_enabled=bool(settings.admin_email and settings.admin_password),
    )


@router.post("/login", response_model=LoginResponse)
async def local_admin_login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
):
    """Static-admin login via ADMIN_EMAIL + ADMIN_PASSWORD (issue #5).

    Available regardless of auth_mode so deployments without OIDC still
    have a working sign-in path, and OIDC deployments have an emergency
    break-glass account if the IdP is down.
    """
    if not settings.admin_email or not settings.admin_password:
        raise HTTPException(404, "Local admin login not configured")
    submitted_email = body.email.strip().lower()
    expected_email = settings.admin_email.strip().lower()
    # secrets.compare_digest avoids timing side channels on credential comparison.
    email_ok = secrets.compare_digest(submitted_email, expected_email)
    pw_ok = secrets.compare_digest(body.password, settings.admin_password)
    if not (email_ok and pw_ok):
        raise HTTPException(401, "Invalid credentials")
    # Upsert the admin user. ensure_default_admin already runs at startup
    # so this row should exist, but be defensive in case the DB was wiped
    # between boot and login.
    user = (await session.execute(
        select(User).where(User.email == expected_email)
    )).scalar_one_or_none()
    if user is None:
        user = User(email=expected_email, name=expected_email.split("@")[0], role=Role.admin)
        session.add(user)
        await session.commit()
        await session.refresh(user)
    elif user.role != Role.admin:
        user.role = Role.admin
        await session.commit()
        await session.refresh(user)
    return LoginResponse(
        token=make_session_jwt(user),
        user=UserOut.model_validate(user),
    )


@router.get("/oidc/login")
async def oidc_login():
    """Initiate OIDC authorization-code flow (PKCE)."""
    if not (settings.oidc_issuer and settings.oidc_client_id):
        raise HTTPException(503, "OIDC not configured")
    try:
        await oidc.get_discovery()
    except Exception as e:
        log.exception("OIDC discovery failed: %s", e)
        raise HTTPException(502, f"OIDC discovery failed: {e}") from e
    code_verifier, code_challenge = oidc.make_pkce_pair()
    state = oidc.random_state()
    nonce = oidc.random_state()
    url = oidc.authorization_url(state, nonce, code_challenge)
    cookie_value = oidc.sign_state_cookie(state, nonce, code_verifier)
    resp = RedirectResponse(url, status_code=302)
    # HttpOnly so JS can't read it; SameSite=Lax is necessary because the
    # callback arrives from an OIDC redirect (top-level navigation).
    resp.set_cookie(
        _OIDC_COOKIE, cookie_value,
        max_age=600, httponly=True, secure=False, samesite="lax", path="/api/auth",
    )
    return resp


@router.get("/oidc/callback")
async def oidc_callback(
    code: str = "", state: str = "", error: str = "",
    wiki_oidc_state: str = Cookie(default="", alias=_OIDC_COOKIE),
    session: AsyncSession = Depends(get_session),
):
    """Exchange the authorization code, validate, mint a session JWT."""
    if error:
        raise HTTPException(400, f"IdP returned error: {error}")
    if not (settings.oidc_issuer and settings.oidc_client_id):
        raise HTTPException(503, "OIDC not configured")
    if not wiki_oidc_state:
        raise HTTPException(400, "Missing OIDC state cookie (cookie expired or blocked)")
    saved = oidc.read_state_cookie(wiki_oidc_state)
    if not saved or saved.get("state") != state:
        raise HTTPException(400, "State mismatch — possible CSRF")
    try:
        tokens = await oidc.exchange_code_for_tokens(code, saved["cv"])
    except Exception as e:
        log.exception("OIDC code exchange failed")
        raise HTTPException(502, f"Token exchange failed: {e}") from e
    id_token = tokens.get("id_token")
    if not id_token:
        raise HTTPException(502, "IdP response missing id_token")
    try:
        claims = await oidc.validate_id_token(id_token, saved["nonce"])
    except Exception as e:
        log.exception("OIDC ID-token validation failed")
        raise HTTPException(401, f"ID token invalid: {e}") from e
    email = (claims.get("email") or "").strip().lower()
    name = (claims.get("name") or claims.get("preferred_username") or email.split("@")[0])
    if not email:
        raise HTTPException(400, "IdP did not return an email claim")

    # Upsert user. ADMIN_EMAIL match → admin role. Else → default role.
    user = (await session.execute(
        select(User).where(User.email == email)
    )).scalar_one_or_none()
    target_role = (
        Role.admin
        if email == (settings.admin_email or "").strip().lower() and settings.admin_email
        else Role(settings.default_oidc_role)
    )
    if user is None:
        user = User(email=email, name=name, role=target_role)
        session.add(user)
        await session.commit()
        await session.refresh(user)
    else:
        # Promote on email match, but never demote an existing higher role.
        if target_role == Role.admin and user.role != Role.admin:
            user.role = Role.admin
            await session.commit()
            await session.refresh(user)
    jwt_token = make_session_jwt(user)
    # Pass JWT to frontend via URL fragment so it never lands in server
    # logs or referer headers. Frontend's /auth/callback page reads
    # `location.hash` and stores it in localStorage.
    frontend_callback = settings.oidc_redirect_uri  # http://host/auth/callback
    target = f"{frontend_callback}#token={jwt_token}"
    resp = RedirectResponse(target, status_code=302)
    resp.delete_cookie(_OIDC_COOKIE, path="/api/auth")
    return resp


@router.post("/logout")
async def logout(response: Response):
    """Clear the state cookie. JWT lives in client localStorage —
    frontend is responsible for removing it."""
    response.delete_cookie(_OIDC_COOKIE, path="/api/auth")
    return {"ok": True}


@router.post("/dev-login", response_model=dict)
async def dev_login(
    email: str, name: str | None = None, role: str = "contributor",
    session: AsyncSession = Depends(get_session),
):
    """Stub-mode quick login. Returns a JWT for a user (creates if missing).
    Disabled when AUTH_MODE != 'stub'.
    """
    if settings.auth_mode != "stub":
        raise HTTPException(404, "Not found")
    if role not in [r.value for r in Role]:
        raise HTTPException(400, f"Invalid role: {role}")
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user:
        user = User(email=email, name=name or email.split("@")[0], role=Role(role))
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return {"token": make_session_jwt(user), "user": UserOut.model_validate(user).model_dump()}


@router.get("/tokens", response_model=list[TokenOut])
async def list_tokens(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
):
    rows = (await session.execute(
        select(ApiToken).where(ApiToken.user_id == user.id).order_by(ApiToken.created_at.desc())
    )).scalars().all()
    return rows


@router.post("/tokens", response_model=TokenCreated)
async def create_token(
    payload: TokenCreate,
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
):
    raw, h = make_token()
    expires_at = (
        datetime.now(timezone.utc) + timedelta(days=payload.expires_in_days)
        if payload.expires_in_days else None
    )
    token = ApiToken(user_id=user.id, name=payload.name, token_hash=h, expires_at=expires_at)
    session.add(token)
    await session.commit()
    await session.refresh(token)
    out = TokenCreated.model_validate(token).model_dump()
    out["raw_token"] = raw
    return out


@router.delete("/tokens/{token_id}")
async def revoke_token(
    token_id: int,
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
):
    token = await session.get(ApiToken, token_id)
    if not token or token.user_id != user.id:
        raise HTTPException(404, "Not found")
    token.revoked_at = datetime.now(timezone.utc)
    await session.commit()
    return {"ok": True}
