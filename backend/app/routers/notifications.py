"""User notifications."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user
from app.core.db import get_session
from app.models import Notification, User
from app.schemas import NotificationOut

router = APIRouter()


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    only_unread: bool = False,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    stmt = select(Notification).where(Notification.user_id == user.id)
    if only_unread:
        stmt = stmt.where(Notification.is_read.is_(False))
    rows = (await session.execute(
        stmt.order_by(Notification.created_at.desc()).limit(100)
    )).scalars().all()
    return rows


@router.post("/{notif_id}/read")
async def mark_read(
    notif_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    n = await session.get(Notification, notif_id)
    if not n or n.user_id != user.id:
        raise HTTPException(404, "Not found")
    n.is_read = True
    await session.commit()
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    from sqlalchemy import update
    await session.execute(
        update(Notification).where(
            Notification.user_id == user.id, Notification.is_read.is_(False)
        ).values(is_read=True)
    )
    await session.commit()
    return {"ok": True}
