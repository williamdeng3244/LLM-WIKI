"""Draft -> Propose -> Review -> Publish workflow.

The single source of truth for state transitions on revisions.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import can_review
from app.models import (
    AuditLog, Notification, Page, PageStability,
    Revision, RevisionProvenance, RevisionStatus, User,
)
from app.services.indexer import reindex_page, resolve_all_links
from app.services.vault import write_file

log = logging.getLogger(__name__)


async def create_draft(
    session: AsyncSession, *,
    page: Page, author: User, title: str, body: str,
    tags: list[str], rationale: Optional[str] = None,
) -> Revision:
    rev = Revision(
        page_id=page.id, parent_revision_id=page.current_revision_id,
        title=title, body=body, tags=tags,
        status=RevisionStatus.draft, author_id=author.id, rationale=rationale,
    )
    session.add(rev)
    await session.flush()
    session.add(AuditLog(
        actor_id=author.id, action="revision.create_draft",
        target_type="revision", target_id=rev.id,
        payload={"page_id": page.id, "page_path": page.path},
    ))
    await session.commit()
    await session.refresh(rev)
    return rev


async def submit_for_review(
    session: AsyncSession, revision: Revision, author: User, *,
    force_review: bool = False,
) -> Revision:
    """Submit a draft. With force_review=True the open-stability auto-publish
    shortcut is skipped — used for agent-authored drafts so every change
    enters the review queue regardless of page trust dial."""
    if revision.author_id != author.id:
        raise HTTPException(403, "Only the author can submit a draft.")
    if revision.status != RevisionStatus.draft:
        raise HTTPException(409, f"Revision is {revision.status.value}, not draft.")
    page = await session.get(Page, revision.page_id)
    assert page is not None

    # Open pages auto-publish (the trust dial says "let it through")
    # unless the caller has asked for force-review.
    if page.stability == PageStability.open and not force_review:
        return await _publish(session, revision, page, reviewer=author, comment=None)

    revision.status = RevisionStatus.proposed
    session.add(AuditLog(
        actor_id=author.id, action="revision.propose",
        target_type="revision", target_id=revision.id,
        payload={"page_id": page.id, "page_path": page.path},
    ))
    await _notify_reviewers(session, page, revision, author)
    await session.commit()
    await session.refresh(revision)
    return revision


async def review(
    session: AsyncSession, revision: Revision, reviewer: User,
    decision: str, comment: Optional[str] = None, *,
    reject_reason: Optional[str] = None,
    reject_notes: Optional[str] = None,
) -> Revision:
    page = await session.get(Page, revision.page_id)
    assert page is not None
    if not await can_review(session, reviewer, page):
        raise HTTPException(403, "You cannot review this page.")
    if revision.status != RevisionStatus.proposed:
        raise HTTPException(409, f"Revision is {revision.status.value}, not proposed.")

    revision.reviewer_id = reviewer.id
    revision.review_comment = comment
    revision.reviewed_at = datetime.now(timezone.utc)

    if decision == "accept":
        return await _publish(session, revision, page, reviewer=reviewer, comment=comment)
    if decision == "reject":
        revision.status = RevisionStatus.rejected
        # Phase 3.6: persist reviewer's structured feedback on the
        # provenance row when the rejected revision was agent-authored.
        # This is the corpus future ingest prompts will learn from.
        if reject_reason or reject_notes:
            prov = (await session.execute(
                select(RevisionProvenance)
                .where(RevisionProvenance.revision_id == revision.id)
            )).scalar_one_or_none()
            if prov is not None:
                prov.reject_reason = reject_reason
                prov.reject_notes = reject_notes
        session.add(AuditLog(
            actor_id=reviewer.id, action="revision.reject",
            target_type="revision", target_id=revision.id,
            payload={
                "page_id": page.id, "comment": comment,
                "reject_reason": reject_reason,
            },
        ))
        session.add(Notification(
            user_id=revision.author_id, kind="revision_rejected",
            body=f'Your edit to "{page.title}" was rejected.'
                 + (f' Reviewer note: {comment}' if comment else ""),
            link=f"/pages/{page.path}",
        ))
        await session.commit()
        await session.refresh(revision)
        return revision
    if decision == "request_changes":
        revision.status = RevisionStatus.draft  # bounces back to author
        session.add(AuditLog(
            actor_id=reviewer.id, action="revision.request_changes",
            target_type="revision", target_id=revision.id,
            payload={"page_id": page.id, "comment": comment},
        ))
        session.add(Notification(
            user_id=revision.author_id, kind="changes_requested",
            body=f'Reviewer requested changes on "{page.title}".'
                 + (f' Note: {comment}' if comment else ""),
            link=f"/pages/{page.path}",
        ))
        await session.commit()
        await session.refresh(revision)
        return revision
    raise HTTPException(400, f"Unknown decision: {decision}")


async def _publish(
    session: AsyncSession, revision: Revision, page: Page,
    reviewer: User, comment: Optional[str],
) -> Revision:
    """Mark revision accepted, set as current, supersede prior, reindex, write disk."""
    if page.current_revision_id and page.current_revision_id != revision.id:
        await session.execute(
            update(Revision)
            .where(Revision.id == page.current_revision_id)
            .values(status=RevisionStatus.superseded)
        )

    revision.status = RevisionStatus.accepted
    page.current_revision_id = revision.id
    page.title = revision.title
    page.tags = list(revision.tags or [])

    # Mirror to disk for git export
    write_file(
        rel_path=page.path if page.path.endswith(".md") else page.path + ".md",
        title=revision.title, tags=list(revision.tags or []), body=revision.body,
    )

    # Reindex for search and graph
    await reindex_page(session, page, revision)

    session.add(AuditLog(
        actor_id=reviewer.id, action="revision.publish",
        target_type="revision", target_id=revision.id,
        payload={"page_id": page.id, "page_path": page.path, "comment": comment},
    ))

    if revision.author_id != reviewer.id:
        session.add(Notification(
            user_id=revision.author_id, kind="revision_accepted",
            body=f'Your edit to "{page.title}" was published.',
            link=f"/pages/{page.path}",
        ))

    await session.commit()
    await resolve_all_links(session)
    await session.refresh(revision)
    return revision


async def _notify_reviewers(
    session: AsyncSession, page: Page, revision: Revision, author: User,
) -> None:
    """Notify users who can review this page (editors-in-category and admins)."""
    from app.models import CategoryEditor, Role
    from sqlalchemy import or_
    q = select(User).where(
        or_(
            User.role == Role.admin,
            User.id.in_(
                select(CategoryEditor.user_id).where(
                    CategoryEditor.category_id == page.category_id
                )
            ) if page.category_id else User.role == Role.admin,
        ),
        User.is_active.is_(True),
    )
    reviewers = (await session.execute(q)).scalars().all()
    for r in reviewers:
        if r.id == author.id:
            continue
        session.add(Notification(
            user_id=r.id, kind="review_requested",
            body=f'{author.name} proposed an edit to "{page.title}".',
            link=f"/review/{revision.id}",
        ))


async def lock_page(session: AsyncSession, page: Page, admin: User, locked: bool) -> Page:
    page.stability = PageStability.locked if locked else PageStability.stable
    session.add(AuditLog(
        actor_id=admin.id, action="page.lock" if locked else "page.unlock",
        target_type="page", target_id=page.id,
        payload={"page_path": page.path},
    ))
    await session.commit()
    await session.refresh(page)
    return page
