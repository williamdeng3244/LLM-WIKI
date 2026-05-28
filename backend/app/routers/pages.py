"""Page CRUD-ish: list, get, create draft, update draft, list revisions."""
from typing import Optional

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
    DraftCreate, MovePageBody, NewPageSpec, PageOut, PageSummary, RevisionOut,
)
from app.services.indexer import resolve_all_links
from app.services.vault import delete_file as vault_delete_file
from app.services.vault import move_file as vault_move_file
from app.services.workflow import create_draft, lock_page


async def _resolve_page(session: AsyncSession, page_path: str) -> Optional[Page]:
    """Try several common variants of a path so the API doesn't 404 on
    cosmetic mismatches (e.g. `.md` suffix presence, trailing slash).
    Most pages are stored verbatim under whatever path they were
    proposed with, and that's not always identical across creation
    flows — the agent ingest writes `concepts/foo.md`, manual proposals
    sometimes write `foo` bare. Pages.path lookups should be forgiving.

    Returns the first matching Page or None."""
    variants = {page_path}
    if page_path.endswith(".md"):
        variants.add(page_path[:-3])
    else:
        variants.add(page_path + ".md")
    if page_path.endswith("/"):
        variants.add(page_path.rstrip("/"))
    else:
        variants.add(page_path + "/")
    for v in variants:
        page = (await session.execute(
            select(Page).where(Page.path == v)
        )).scalar_one_or_none()
        if page:
            return page
    return None

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


# Note: `/{page_path:path}` is a greedy match — it would eat the
# `/revisions`, `/backlinks`, `/lock` suffixes of the other routes below
# and never let them dispatch. (Bug #13.) The detail route lives at the
# BOTTOM of this file so all the suffix routes match first.


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


# Detail route is last so the specific-suffix routes above match first.
# See note near the top of the file. (Bug #13.)
@router.patch("/{page_path:path}/path", response_model=PageOut)
async def move_page(
    page_path: str, body: MovePageBody,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Move (or rename) a page to a new path.

    Permissioned at editor+admin: contributors can suggest a body edit
    via a revision, but a path change is a structural rewrite that
    other people's wikilinks depend on, so we gate it tighter.

    Cosmetic differences (.md suffix, trailing slash) on the source
    path are forgiven via `_resolve_page`. The new path is validated:
    must be non-empty, not collide with any other page, and not be a
    pure traversal string like `..`.
    """
    if user.role not in (Role.admin, Role.editor):
        raise HTTPException(403, "Only editors and admins can move pages")
    page = await _resolve_page(session, page_path)
    if not page:
        raise HTTPException(404, "Page not found")

    new_path = (body.new_path or "").strip().lstrip("/")
    if not new_path:
        raise HTTPException(400, "new_path is required")
    if ".." in new_path.split("/"):
        raise HTTPException(400, "Path traversal not allowed")
    if new_path == page.path:
        return page  # no-op

    # Collision check — refuse to clobber another page.
    clash = (await session.execute(
        select(Page).where(Page.path == new_path, Page.id != page.id)
    )).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"A page already exists at {new_path}")

    old_path = page.path
    try:
        vault_move_file(old_path, new_path)
    except FileExistsError as e:
        raise HTTPException(409, str(e)) from e
    page.path = new_path
    session.add(AuditLog(
        actor_id=user.id, action="page.move",
        target_type="page", target_id=page.id,
        payload={"from": old_path, "to": new_path},
    ))
    await session.commit()
    # Old [[wikilinks]] targeting `old_path` should now resolve to the
    # new path via `normalize_link_target`'s slug fuzziness, but force
    # a re-resolve so the `links` table reflects the new state.
    await resolve_all_links(session)
    await session.refresh(page)

    # Build the same shape as GET /pages/{path} returns.
    body_text = ""
    if page.current_revision_id:
        rev = await session.get(Revision, page.current_revision_id)
        if rev:
            body_text = rev.body
    out = PageSummary.model_validate(page).model_dump()
    out["body"] = body_text
    out["current_revision_id"] = page.current_revision_id
    out["updated_at"] = page.updated_at
    return out


@router.delete("/{page_path:path}", status_code=204)
async def delete_page(
    page_path: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Hard-delete a page. Admin only.

    DB cascade handles revisions / links / chunks / flags / comments /
    provenance / bookmarks (all of those FKs are `ON DELETE CASCADE` or
    `SET NULL` already — see model definitions). We also remove the
    on-disk .md so the export mirror stays in sync, and re-resolve
    outgoing links from other pages so wikilinks that used to point
    here become unresolved (and render as 'broken' in the UI) instead
    of pointing at a stale row id."""
    if user.role != Role.admin:
        raise HTTPException(403, "Only admins can delete pages")
    page = await _resolve_page(session, page_path)
    if not page:
        raise HTTPException(404, "Page not found")

    # Record what we're about to delete BEFORE the cascade wipes the rows.
    audit_payload = {
        "page_id": page.id, "path": page.path, "title": page.title,
        "stability": page.stability.value if page.stability else None,
    }
    deleted_on_disk = vault_delete_file(page.path)
    await session.delete(page)
    session.add(AuditLog(
        actor_id=user.id, action="page.delete",
        target_type="page", target_id=audit_payload["page_id"],
        payload={**audit_payload, "vault_unlinked": deleted_on_disk},
    ))
    await session.commit()
    # Other pages may have `[[old-path]]` wikilinks → re-resolve so
    # they now read as unresolved (broken) instead of pointing at a
    # ghost id. Cheap: indexes everything by path string.
    await resolve_all_links(session)
    return None


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
