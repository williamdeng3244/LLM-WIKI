"""Personal agents: each user can create agent users they own.

Agents are User rows with is_agent=True and owner_id set to a human user.
They have their own API tokens, route through normal authorization, and
inherit the owner's category-editor scopes (NOT role — they default to
contributor; admins can promote a specific agent to editor explicitly).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user, hash_token, make_token
from app.core.db import get_session
from app.models import ApiToken, AuditLog, Role, User
from app.schemas import AgentCreate, TokenCreated, UserOut

router = APIRouter()


@router.get("", response_model=list[UserOut])
async def list_my_agents(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
):
    rows = (await session.execute(
        select(User).where(User.is_agent.is_(True), User.owner_id == user.id)
    )).scalars().all()
    return rows


@router.post("", response_model=TokenCreated)
async def create_agent(
    payload: AgentCreate,
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
):
    """Create an agent and return its first API token (shown once)."""
    agent_email = f"agent+{user.id}+{payload.name.lower().replace(' ', '-')}@local"
    existing = (await session.execute(
        select(User).where(User.email == agent_email)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Agent with this name already exists")
    agent = User(
        email=agent_email, name=f"{payload.name} (agent of {user.name})",
        role=Role.contributor, is_agent=True, owner_id=user.id,
    )
    session.add(agent)
    await session.flush()
    raw, h = make_token()
    token = ApiToken(user_id=agent.id, name=f"{payload.name} primary", token_hash=h)
    session.add(token)
    session.add(AuditLog(
        actor_id=user.id, action="agent.create",
        target_type="user", target_id=agent.id,
        payload={"name": payload.name},
    ))
    await session.commit()
    await session.refresh(token)
    out = TokenCreated.model_validate(token).model_dump()
    out["raw_token"] = raw
    return out


@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: int,
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
):
    agent = await session.get(User, agent_id)
    if not agent or not agent.is_agent or agent.owner_id != user.id:
        raise HTTPException(404, "Not found")
    agent.is_active = False
    session.add(AuditLog(
        actor_id=user.id, action="agent.delete",
        target_type="user", target_id=agent.id, payload={},
    ))
    await session.commit()
    return {"ok": True}
