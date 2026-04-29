"""Page CRUD-ish: list, get, create draft, update draft, list revisions."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user, require_role
from app.core.db import get_session
from app.core.permissions import can_lock, can_propose
from app.models import (
    AuditLog, Category, Link, Page, PageStability,
    Revision, RevisionStatus, Role, User,
)
from app.schemas import (
    DraftCreate, NewPageSpec, PageOut, PageSummary, RevisionOut,
)
from app.services.workflow import create_draft, lock_page

router = APIRouter()


@router.get("", response_model=list[PageSummary])
async def list_pages(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    rows = (await session.execute(
        select(Page).where(Page.current_revision_id.is_not(None)).order_by(Page.path)
    )).scalars().all()
    return rows


@router.get("/{page_path:path}", response_model=PageOut)
async def get_page(
    page_path: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    page = (await session.execute(
        select(Page).where(Page.path == page_path)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not found")
    body = ""
    if page.current_revision_id:
        rev = await session.get(Revision, page.current_revision_id)
        if rev:
            body = rev.body
    out = PageSummary.model_validate(page).model_dump()
    out["body"] = body
    out["current_revision_id"] = page.current_revision_id
    out["updated_at"] = page.updated_at
    return out


@router.get("/{page_path:path}/revisions", response_model=list[RevisionOut])
async def list_revisions(
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
        select(Revision).where(Revision.page_id == page.id).order_by(Revision.id.desc())
    )).scalars().all()
    return rows


@router.post("/draft", response_model=RevisionOut)
async def create_draft_endpoint(
    payload: DraftCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    if not await can_propose(user):
        raise HTTPException(403, "Readers cannot propose changes")
    if payload.page_path:
        # Edit existing
        page = (await session.execute(
            select(Page).where(Page.path == payload.page_path)
        )).scalar_one_or_none()
        if not page:
            raise HTTPException(404, "Page not found")
    elif payload.new_page:
        # Propose a new page
        spec = payload.new_page
        existing = (await session.execute(
            select(Page).where(Page.path == spec.path)
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(409, "Page already exists at that path")
        category_id = None
        if spec.category_slug:
            cat = (await session.execute(
                select(Category).where(Category.slug == spec.category_slug)
            )).scalar_one_or_none()
            if cat:
                category_id = cat.id
        page = Page(
            path=spec.path, title=payload.title, category_id=category_id,
            stability=spec.stability, tags=payload.tags, created_by_id=user.id,
        )
        session.add(page)
        await session.flush()
        session.add(AuditLog(
            actor_id=user.id, action="page.create_proposal",
            target_type="page", target_id=page.id,
            payload={"path": page.path},
        ))
    else:
        raise HTTPException(400, "Must provide page_path or new_page")
    rev = await create_draft(
        session, page=page, author=user, title=payload.title,
        body=payload.body, tags=payload.tags, rationale=payload.rationale,
    )
    return rev


@router.post("/{page_path:path}/lock", response_model=PageOut)
async def lock(
    page_path: str, locked: bool = True,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_role(Role.admin)),
):
    page = (await session.execute(
        select(Page).where(Page.path == page_path)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not found")
    page = await lock_page(session, page, user, locked=locked)
    out = PageSummary.model_validate(page).model_dump()
    out["body"] = ""
    out["current_revision_id"] = page.current_revision_id
    out["updated_at"] = page.updated_at
    return out


@router.get("/{page_path:path}/backlinks", response_model=list[PageSummary])
async def backlinks(
    page_path: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Return all published pages that link to this one."""
    page = (await session.execute(
        select(Page).where(Page.path == page_path)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not found")
    rows = (await session.execute(
        select(Page).join(Link, Link.source_id == Page.id)
        .where(Link.target_id == page.id)
        .where(Page.current_revision_id.is_not(None))
        .order_by(Page.path)
    )).scalars().unique().all()
    return rows
