"""User management: admin assigns roles, anyone lists users (for mentions etc.)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user, require_role
from app.core.db import get_session
from app.models import AuditLog, Role, User
from app.schemas import UserOut

router = APIRouter()


@router.get("", response_model=list[UserOut])
async def list_users(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    rows = (await session.execute(
        select(User).where(User.is_active.is_(True)).order_by(User.name)
    )).scalars().all()
    return rows


@router.post("/{user_id}/role", response_model=UserOut)
async def set_role(
    user_id: int, role: str,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_role(Role.admin)),
):
    if role not in [r.value for r in Role]:
        raise HTTPException(400, f"Invalid role: {role}")
    target = await session.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    old = target.role.value
    target.role = Role(role)
    session.add(AuditLog(
        actor_id=admin.id, action="user.role_change",
        target_type="user", target_id=target.id,
        payload={"from": old, "to": role},
    ))
    await session.commit()
    await session.refresh(target)
    return target


@router.post("/{user_id}/deactivate", response_model=UserOut)
async def deactivate(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_role(Role.admin)),
):
    target = await session.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    target.is_active = False
    session.add(AuditLog(
        actor_id=admin.id, action="user.deactivate",
        target_type="user", target_id=target.id, payload={},
    ))
    await session.commit()
    await session.refresh(target)
    return target


@router.post("/{user_id}/mcp-access", response_model=UserOut)
async def set_mcp_access(
    user_id: int, enabled: bool = True,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_role(Role.admin)),
):
    """Admin toggle: grant or revoke MCP接入 for a specific user."""
    target = await session.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    prev = target.mcp_enabled
    target.mcp_enabled = enabled
    session.add(AuditLog(
        actor_id=admin.id,
        action="user.mcp_access_grant" if enabled else "user.mcp_access_revoke",
        target_type="user", target_id=target.id,
        payload={"from": prev, "to": enabled},
    ))
    await session.commit()
    await session.refresh(target)
    return target
