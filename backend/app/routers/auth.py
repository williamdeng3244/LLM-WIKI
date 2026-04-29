"""Auth: whoami, dev login (stub), tokens, logout.

OIDC implementation is stubbed — see `core/auth.py` notes for production.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user, hash_token, make_session_jwt, make_token, optional_user
from app.core.config import settings
from app.core.db import get_session
from app.models import ApiToken, Role, User
from app.schemas import TokenCreate, TokenCreated, TokenOut, UserOut

router = APIRouter()


@router.get("/whoami", response_model=UserOut)
async def whoami(user: User = Depends(current_user)):
    return user


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
