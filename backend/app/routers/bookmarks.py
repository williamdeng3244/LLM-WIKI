"""Per-user page bookmarks.

Add/remove are keyed by page path (not page id) so the frontend
doesn't need an extra round-trip to resolve a path → id before
toggling. The unique (user_id, page_id) constraint on the model
makes toggle idempotent at the DB level.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user
from app.core.db import get_session
from app.models import Bookmark, Page, User
from app.schemas import BookmarkOut

router = APIRouter()


@router.get("", response_model=list[BookmarkOut])
async def list_bookmarks(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Current user's bookmarks, newest first. Joins through Page so the
    response carries the path + title the UI needs."""
    rows = (await session.execute(
        select(Bookmark, Page)
        .join(Page, Page.id == Bookmark.page_id)
        .where(Bookmark.user_id == user.id)
        .order_by(Bookmark.created_at.desc())
    )).all()
    return [
        BookmarkOut(
            id=b.id, page_id=b.page_id, page_path=p.path,
            page_title=p.title, created_at=b.created_at,
        )
        for b, p in rows
    ]


@router.post("/{page_path:path}", response_model=BookmarkOut)
async def add_bookmark(
    page_path: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    page = (await session.execute(
        select(Page).where(Page.path == page_path)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not found")
    existing = (await session.execute(
        select(Bookmark).where(
            Bookmark.user_id == user.id, Bookmark.page_id == page.id,
        )
    )).scalar_one_or_none()
    if existing:
        return BookmarkOut(
            id=existing.id, page_id=page.id, page_path=page.path,
            page_title=page.title, created_at=existing.created_at,
        )
    bm = Bookmark(user_id=user.id, page_id=page.id)
    session.add(bm)
    await session.commit()
    await session.refresh(bm)
    return BookmarkOut(
        id=bm.id, page_id=page.id, page_path=page.path,
        page_title=page.title, created_at=bm.created_at,
    )


@router.delete("/{page_path:path}", status_code=204)
async def remove_bookmark(
    page_path: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    page = (await session.execute(
        select(Page).where(Page.path == page_path)
    )).scalar_one_or_none()
    if not page:
        # No page → no bookmark to remove. Be idempotent.
        return None
    bm = (await session.execute(
        select(Bookmark).where(
            Bookmark.user_id == user.id, Bookmark.page_id == page.id,
        )
    )).scalar_one_or_none()
    if bm:
        await session.delete(bm)
        await session.commit()
    return None
