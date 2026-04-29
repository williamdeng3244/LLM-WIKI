"""Authentication and authorization.

Two modes:
- 'stub': dev mode. Reads X-User-Email header, auto-creates users, defaults role
  for new accounts to 'contributor'. No password.
- 'oidc': production. Validates a session JWT signed by this server, issued after
  successful OIDC callback against an external IdP (Google/Microsoft/Okta/Auth0).

API tokens are an alternate auth path used by personal agents and scripts.
A bearer token in Authorization: Bearer <token> is hashed and matched against
api_tokens.token_hash. If found and not revoked/expired, that token's user is
the authenticated principal.
"""
import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.models import ApiToken, User, Role, ROLE_RANK


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def make_token() -> tuple[str, str]:
    """Return (raw_token, token_hash). Show raw to user once; store the hash."""
    raw = "wt_" + secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def make_session_jwt(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role.value,
        "iat": int(datetime.now(timezone.utc).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


async def _resolve_via_token(authorization: Optional[str], session: AsyncSession) -> Optional[User]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    raw = authorization[len("Bearer "):].strip()
    if not raw:
        return None
    # API tokens look like wt_*; session JWTs are eyJ*
    if raw.startswith("wt_"):
        h = hash_token(raw)
        token = (await session.execute(
            select(ApiToken).where(ApiToken.token_hash == h)
        )).scalar_one_or_none()
        if not token or token.revoked_at is not None:
            return None
        if token.expires_at and token.expires_at < datetime.now(timezone.utc):
            return None
        token.last_used_at = datetime.now(timezone.utc)
        await session.commit()
        return await session.get(User, token.user_id)
    # JWT
    try:
        payload = jwt.decode(raw, settings.jwt_secret, algorithms=["HS256"])
        user_id = int(payload["sub"])
        return await session.get(User, user_id)
    except (jwt.InvalidTokenError, KeyError, ValueError):
        return None


async def _resolve_via_stub(
    x_user_email: Optional[str], x_user_role: Optional[str], session: AsyncSession,
) -> Optional[User]:
    if not x_user_email:
        return None
    user = (await session.execute(
        select(User).where(User.email == x_user_email)
    )).scalar_one_or_none()
    if user:
        return user
    # Auto-create on first sight in stub mode
    role = Role(x_user_role) if x_user_role in [r.value for r in Role] else Role.contributor
    user = User(email=x_user_email, name=x_user_email.split("@")[0], role=role)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def current_user(
    authorization: Optional[str] = Header(default=None),
    x_user_email: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User:
    user = await _resolve_via_token(authorization, session)
    if user is None and settings.auth_mode == "stub":
        user = await _resolve_via_stub(x_user_email, x_user_role, session)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is inactive")
    return user


async def optional_user(
    authorization: Optional[str] = Header(default=None),
    x_user_email: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> Optional[User]:
    try:
        return await current_user(authorization, x_user_email, x_user_role, session)
    except HTTPException:
        return None


def require_role(min_role: Role):
    """Dependency factory: ensure user has at least the given role."""
    async def _check(user: User = Depends(current_user)) -> User:
        if ROLE_RANK[user.role] < ROLE_RANK[min_role]:
            raise HTTPException(
                status_code=403, detail=f"Requires role: {min_role.value} or higher"
            )
        return user
    return _check
