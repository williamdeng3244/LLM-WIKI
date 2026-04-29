"""Revisions: my drafts, the review queue, and review actions."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user
from app.core.db import get_session
from app.core.permissions import can_review
from app.models import (
    CategoryEditor, Page, Revision, RevisionStatus, Role, User,
)
from app.schemas import RevisionOut, ReviewBody
from app.services.workflow import review, submit_for_review

router = APIRouter()


@router.get("/my-drafts", response_model=list[RevisionOut])
async def my_drafts(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    rows = (await session.execute(
        select(Revision).where(
            Revision.author_id == user.id,
            Revision.status == RevisionStatus.draft,
        ).order_by(Revision.created_at.desc())
    )).scalars().all()
    return rows


@router.get("/review-queue", response_model=list[RevisionOut])
async def review_queue(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Pending revisions on pages this user can review.

    - Admins see all.
    - Editors see their categories + uncategorized.
    """
    if user.role == Role.admin:
        rows = (await session.execute(
            select(Revision).where(Revision.status == RevisionStatus.proposed)
            .order_by(Revision.created_at.asc())
        )).scalars().all()
        return rows
    if user.role != Role.editor:
        return []
    cats = [r[0] for r in (await session.execute(
        select(CategoryEditor.category_id).where(CategoryEditor.user_id == user.id)
    )).all()]
    rows = (await session.execute(
        select(Revision).join(Page, Page.id == Revision.page_id)
        .where(Revision.status == RevisionStatus.proposed)
        .where(or_(Page.category_id.in_(cats), Page.category_id.is_(None)))
        .order_by(Revision.created_at.asc())
    )).scalars().all()
    return rows


@router.get("/{revision_id}", response_model=RevisionOut)
async def get_revision(
    revision_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    rev = await session.get(Revision, revision_id)
    if not rev:
        raise HTTPException(404, "Not found")
    # Drafts visible only to author; proposed visible to anyone who could review
    if rev.status == RevisionStatus.draft and rev.author_id != user.id:
        raise HTTPException(403, "Drafts are visible only to the author")
    return rev


@router.post("/{revision_id}/submit", response_model=RevisionOut)
async def submit(
    revision_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    rev = await session.get(Revision, revision_id)
    if not rev:
        raise HTTPException(404, "Not found")
    return await submit_for_review(session, rev, user)


@router.post("/{revision_id}/review", response_model=RevisionOut)
async def post_review(
    revision_id: int, payload: ReviewBody,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    rev = await session.get(Revision, revision_id)
    if not rev:
        raise HTTPException(404, "Not found")
    if payload.decision not in ("accept", "reject", "request_changes"):
        raise HTTPException(400, "Invalid decision")
    return await review(session, rev, user, payload.decision, payload.comment)


@router.put("/{revision_id}", response_model=RevisionOut)
async def update_draft(
    revision_id: int, title: str, body: str, tags: list[str] = [],
    rationale: str | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    rev = await session.get(Revision, revision_id)
    if not rev:
        raise HTTPException(404, "Not found")
    if rev.author_id != user.id:
        raise HTTPException(403, "Only the author can edit a draft")
    if rev.status != RevisionStatus.draft:
        raise HTTPException(409, "Only drafts can be edited")
    rev.title = title
    rev.body = body
    rev.tags = list(tags)
    rev.rationale = rationale
    await session.commit()
    await session.refresh(rev)
    return rev
