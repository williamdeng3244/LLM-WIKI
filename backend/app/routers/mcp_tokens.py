"""个人 MCP 接入凭证管理。

每个真人用户可为自己生成 personal MCP token,用于在外部 LLM 客户端
(Claude Desktop / Claude Code / Cursor 等) 中通过 MCP 协议接入本 wiki。
Token 直接关联真人用户;通过 MCP 进行的所有操作以该用户的身份和角色
作用域执行。

前提:
  1. 全局 settings.mcp_enabled = True
  2. 当前用户的 user.mcp_enabled = True (admin 控制)

旧的"创建 agent user"概念已废弃 — 不再有独立的 agent 实体。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user, hash_token, make_token
from app.core.config import settings
from app.core.db import get_session
from app.models import ApiToken, AuditLog, User
from app.schemas import AgentCreate, TokenCreated, TokenOut

router = APIRouter()


@router.get("", response_model=list[TokenOut])
async def list_my_tokens(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """List the current user's active MCP tokens (revoked tokens hidden)."""
    rows = (await session.execute(
        select(ApiToken).where(
            ApiToken.user_id == user.id,
            ApiToken.revoked_at.is_(None),
        ).order_by(ApiToken.created_at.desc())
    )).scalars().all()
    return rows


@router.post("", response_model=TokenCreated)
async def create_my_token(
    payload: AgentCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Generate a personal MCP token for the current user. Returned ONCE
    in plaintext via `raw_token`; only the hash is stored.

    Refused if MCP is globally disabled or this user lacks mcp_enabled."""
    if not settings.mcp_enabled:
        raise HTTPException(503, "MCP server is globally disabled by an admin.")
    if not user.mcp_enabled:
        raise HTTPException(403, "MCP access not granted to this user. Contact an admin.")

    raw, h = make_token()
    token = ApiToken(user_id=user.id, name=payload.name or "MCP token", token_hash=h)
    session.add(token)
    session.add(AuditLog(
        actor_id=user.id, action="mcp_token.create",
        target_type="api_token", target_id=None,
        payload={"name": payload.name},
    ))
    await session.commit()
    await session.refresh(token)
    out = TokenCreated.model_validate(token).model_dump()
    out["raw_token"] = raw
    return out


@router.delete("/{token_id}")
async def revoke_my_token(
    token_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Revoke one of the current user's tokens."""
    tok = await session.get(ApiToken, token_id)
    if tok is None or tok.user_id != user.id:
        raise HTTPException(404, "Not found")
    if tok.revoked_at is not None:
        return {"ok": True, "already_revoked": True}
    from datetime import datetime, timezone
    tok.revoked_at = datetime.now(timezone.utc)
    session.add(AuditLog(
        actor_id=user.id, action="mcp_token.revoke",
        target_type="api_token", target_id=tok.id, payload={},
    ))
    await session.commit()
    return {"ok": True}
