"""Initial seeding from disk + default categories."""
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Category, Page, PageStability, Revision, RevisionStatus, User, Role
from app.services.indexer import reindex_page, resolve_all_links
from app.services.linker import extract_tags
from app.services.vault import list_files, read_file

log = logging.getLogger(__name__)


DEFAULT_CATEGORIES = [
    ("engineering", "Engineering", "How we build."),
    ("product", "Product", "What we ship and why."),
    ("design", "Design", "Visual + interaction language."),
    ("operations", "Operations", "How we run as a company."),
    ("research", "Research", "What we've learned."),
    ("sources", "Sources", "Reference material from outside the wiki."),
]


async def ensure_default_admin(session: AsyncSession) -> User:
    """Create a default admin if none exists. Stub-mode convenience."""
    admin = (await session.execute(
        select(User).where(User.role == Role.admin).limit(1)
    )).scalar_one_or_none()
    if admin:
        return admin
    admin = User(email="admin@example.com", name="Admin", role=Role.admin)
    session.add(admin)
    await session.commit()
    await session.refresh(admin)
    log.info("Created default admin: %s", admin.email)
    return admin


async def ensure_categories(session: AsyncSession) -> dict[str, Category]:
    by_slug = {}
    for slug, name, desc in DEFAULT_CATEGORIES:
        existing = (await session.execute(
            select(Category).where(Category.slug == slug)
        )).scalar_one_or_none()
        if existing:
            by_slug[slug] = existing
            continue
        cat = Category(slug=slug, name=name, description=desc)
        session.add(cat)
        await session.flush()
        by_slug[slug] = cat
    await session.commit()
    return by_slug


async def import_disk_vault(session: AsyncSession, admin: User) -> int:
    """Read every .md in the vault and create published pages from them.

    Idempotent: skips files whose path already exists in the DB.
    """
    cats = await ensure_categories(session)
    created = 0
    for rel in list_files():
        # Existing?
        existing = (await session.execute(
            select(Page).where(Page.path == rel)
        )).scalar_one_or_none()
        if existing:
            continue
        vf = read_file(rel)
        if vf is None:
            continue
        category_slug = rel.split("/")[0] if "/" in rel else "sources"
        cat = cats.get(category_slug)
        all_tags = list(dict.fromkeys((vf.tags or []) + extract_tags(vf.body)))
        page = Page(
            path=rel, title=vf.title,
            category_id=cat.id if cat else None,
            stability=PageStability.stable,
            tags=all_tags,
            created_by_id=admin.id,
        )
        session.add(page)
        await session.flush()
        rev = Revision(
            page_id=page.id, title=vf.title, body=vf.body, tags=all_tags,
            status=RevisionStatus.accepted, author_id=admin.id, reviewer_id=admin.id,
            rationale="Initial import from disk",
        )
        session.add(rev)
        await session.flush()
        page.current_revision_id = rev.id
        await reindex_page(session, page, rev)
        created += 1
    await session.commit()
    if created > 0:
        await resolve_all_links(session)
    log.info("Imported %d pages from disk vault.", created)
    return created
