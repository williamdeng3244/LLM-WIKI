"""Initial seeding from disk + default categories."""
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import AuditLog, Category, Page, PageStability, Revision, RevisionStatus, User, Role
from app.services.indexer import reindex_page, resolve_all_links
from app.services.linker import extract_tags
from app.services.vault import canonical_page_path, list_files, read_file

log = logging.getLogger(__name__)


async def repair_malformed_page_paths(session: AsyncSession) -> int:
    """Rename page rows whose stored path canonicalises to EMPTY ('', '/',
    '//'…) to `recovered/page-<id>`.

    Such rows were written by pre-canonicalisation code. They are
    unreachable through the path-addressed API — no URL can name them, the
    client refuses to even send the delete ("page path is empty — malformed
    page row", QA 2026-07-07) — and they render as ghosts in the tree /
    quick switcher. After the rename they are ordinary pages: visible under
    recovered/, openable, and deletable. Idempotent; returns rows repaired."""
    rows = (await session.execute(select(Page))).scalars().all()
    fixed = 0
    for p in rows:
        if canonical_page_path(p.path):
            continue
        old = p.path
        p.path = f"recovered/page-{p.id}"
        session.add(AuditLog(
            actor_id=None, action="page.path_repair",
            target_type="page", target_id=p.id,
            payload={"old_path": old, "new_path": p.path},
        ))
        log.warning("Repaired malformed page path %r -> %s (page id %d)",
                    old, p.path, p.id)
        fixed += 1
    if fixed:
        await session.commit()
    return fixed


DEFAULT_CATEGORIES = [
    ("engineering", "Engineering", "How we build."),
    ("product", "Product", "What we ship and why."),
    ("design", "Design", "Visual + interaction language."),
    ("operations", "Operations", "How we run as a company."),
    ("research", "Research", "What we've learned."),
    ("sources", "Sources", "Reference material from outside the wiki."),
]


async def ensure_default_admin(session: AsyncSession) -> User:
    """Ensure exactly one admin account exists.

    Preference order:
    1. If `settings.admin_email` is set, that account is the admin.
       Created with that exact email + role, or promoted to admin if
       the user already exists with a lower role.
    2. Otherwise, fall back to `admin@example.com` (legacy / stub-mode
       convenience). Production deployments should always set ADMIN_EMAIL.

    Idempotent across restarts.
    """
    target_email = (settings.admin_email or "").strip().lower() or "admin@example.com"
    existing_named = (await session.execute(
        select(User).where(User.email == target_email)
    )).scalar_one_or_none()
    if existing_named:
        if existing_named.role != Role.admin:
            existing_named.role = Role.admin
            await session.commit()
            log.info("Promoted %s to admin (from %s)", target_email, existing_named.role)
        return existing_named

    # No user with the target email yet — but maybe a legacy admin exists.
    legacy_admin = (await session.execute(
        select(User).where(User.role == Role.admin).limit(1)
    )).scalar_one_or_none()
    if legacy_admin and not settings.admin_email:
        # Stub mode w/o explicit ADMIN_EMAIL → keep whatever admin we have.
        return legacy_admin

    admin = User(
        email=target_email,
        name=target_email.split("@")[0] or "Admin",
        role=Role.admin,
    )
    session.add(admin)
    await session.commit()
    await session.refresh(admin)
    log.info("Created admin: %s", admin.email)
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


async def import_disk_vault(
    session: AsyncSession,
    admin: User,
    base_path=None,
    source_label: str = "disk vault",
) -> int:
    """Read every .md under `base_path` and create published pages.

    Idempotent: skips files whose path already exists in the DB.
    `base_path=None` reads from `settings.vault_path` (the user's vault).
    """
    cats = await ensure_categories(session)
    created = 0
    for rel in list_files(base=base_path):
        # The vault stores `concepts/foo.md`; the DB identity is the bare
        # `concepts/foo` (Bug #19). Canonicalise before the existence check
        # AND when creating, so a restart can't re-import a page that already
        # exists under its no-`.md` path as a `.md` twin.
        canonical = canonical_page_path(rel)
        existing = (await session.execute(
            select(Page).where(Page.path == canonical)
        )).scalar_one_or_none()
        if existing:
            continue
        vf = read_file(rel, base=base_path)
        if vf is None:
            continue
        category_slug = canonical.split("/")[0] if "/" in canonical else "sources"
        cat = cats.get(category_slug)
        all_tags = list(dict.fromkeys((vf.tags or []) + extract_tags(vf.body)))
        page = Page(
            path=canonical, title=vf.title,
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
            rationale=f"Initial import from {source_label}",
        )
        session.add(rev)
        await session.flush()
        page.current_revision_id = rev.id
        await reindex_page(session, page, rev)
        created += 1
    await session.commit()
    if created > 0:
        await resolve_all_links(session)
    log.info("Imported %d pages from %s.", created, source_label)
    return created


async def import_examples_if_enabled(session: AsyncSession, admin: User) -> int:
    """Opt-in: import the bundled demo pages from `examples_vault_path`.

    No-op unless `SEED_EXAMPLES=true`. Lets new users populate the wiki
    with sample content for evaluation without having to ship demo
    pages in every clean install.
    """
    if not settings.seed_examples:
        return 0
    if not settings.examples_vault_path.exists():
        log.warning(
            "SEED_EXAMPLES=true but %s is missing — examples directory "
            "not mounted? Skipping.", settings.examples_vault_path,
        )
        return 0
    return await import_disk_vault(
        session, admin,
        base_path=settings.examples_vault_path,
        source_label="examples vault",
    )
