"""Comments and flags."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user, require_role
from app.core.db import get_session
from app.models import AuditLog, Comment, Flag, FlagStatus, Page, Role, User
from app.schemas import CommentCreate, CommentOut, FlagCreate, FlagOut

router = APIRouter()


@router.get("/pages/{page_path:path}/comments", response_model=list[CommentOut])
async def list_comments(
    page_path: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    page = (await session.execute(
        select(Page).where(Page.path == page_path)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not found")
    rows = (await session.execute(
        select(Comment).where(Comment.page_id == page.id).order_by(Comment.created_at.asc())
    )).scalars().all()
    return rows


@router.post("/pages/{page_path:path}/comments", response_model=CommentOut)
async def create_comment(
    page_path: str, payload: CommentCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    page = (await session.execute(
        select(Page).where(Page.path == page_path)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not found")
    c = Comment(
        page_id=page.id, revision_id=payload.revision_id, author_id=user.id,
        body=payload.body, anchor=payload.anchor,
    )
    session.add(c)
    await session.commit()
    await session.refresh(c)
    return c


@router.get("/pages/{page_path:path}/flags", response_model=list[FlagOut])
async def list_flags(
    page_path: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    page = (await session.execute(
        select(Page).where(Page.path == page_path)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not found")
    rows = (await session.execute(
        select(Flag).where(Flag.page_id == page.id).order_by(Flag.created_at.desc())
    )).scalars().all()
    return rows


@router.post("/pages/{page_path:path}/flags", response_model=FlagOut)
async def create_flag(
    page_path: str, payload: FlagCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    page = (await session.execute(
        select(Page).where(Page.path == page_path)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not found")
    f = Flag(
        page_id=page.id, kind=payload.kind, body=payload.body,
        raised_by_id=user.id,
    )
    session.add(f)
    session.add(AuditLog(
        actor_id=user.id, action="flag.raise",
        target_type="page", target_id=page.id,
        payload={"kind": payload.kind.value},
    ))
    await session.commit()
    await session.refresh(f)
    return f


@router.post("/flags/{flag_id}/resolve", response_model=FlagOut)
async def resolve_flag(
    flag_id: int, dismiss: bool = False,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    f = await session.get(Flag, flag_id)
    if not f:
        raise HTTPException(404, "Not found")
    # Editors-or-above can resolve
    if user.role not in (Role.editor, Role.admin):
        raise HTTPException(403, "Editor or admin role required")
    f.status = FlagStatus.dismissed if dismiss else FlagStatus.resolved
    f.resolved_by_id = user.id
    f.resolved_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(f)
    return f
