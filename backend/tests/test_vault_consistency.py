"""[unit] Vault <-> DB consistency — locks the re-pollution surface.

The disk vault (`settings.vault_path`) is a *source of truth on boot*: the app
lifespan calls `bootstrap.import_disk_vault`, which reads every `.md` and creates
any page not already in the DB.

A QA cleanup that deleted pages from the DB *only* was silently undone on the
next backend restart, because the vault files were still there and got
re-imported. This test pins that behavior down so any future cleanup code (and
any reviewer) knows: **clearing test/junk pages means clearing BOTH the DB and
the vault.**
"""
from __future__ import annotations

import uuid

from sqlalchemy import delete, func, select, update

from app.models import Page, Role, User
from app.services import vault
from app.services.bootstrap import import_disk_vault
from tests._inproc import run, session_scope


def _count(path: str) -> int:
    async def _go():
        async with session_scope() as s:
            return (await s.execute(
                select(func.count()).select_from(Page).where(Page.path == path)
            )).scalar()
    return run(_go())


def _delete_db_only(path: str) -> None:
    async def _go():
        async with session_scope() as s:
            await s.execute(update(Page).where(Page.path == path).values(current_revision_id=None))
            await s.execute(delete(Page).where(Page.path == path))
            await s.commit()
    run(_go())


def _import_vault() -> None:
    async def _go():
        async with session_scope() as s:
            admin = (await s.execute(
                select(User).where(User.role == Role.admin).limit(1)
            )).scalar_one()
            await import_disk_vault(s, admin)
    run(_go())


def test_vault_reimport_recreates_db_only_deletes():
    tok = uuid.uuid4().hex[:8]
    rel = f"concepts/vaulttest-{tok}.md"  # on-disk name carries the .md
    # Since v1.2.3 (675bc63, .md/no-.md dedup) the DB identity is the
    # *canonical* path — no `.md` suffix. This test originally asserted the
    # pre-v1.2.3 identity (rel with .md) and had been failing silently since.
    canon = vault.canonical_page_path(rel)
    body = f"# Vault Test {tok}\n\nroundtrip body {tok}"
    try:
        # 1. A markdown file appears in the vault...
        vault.write_file(rel, title=f"Vault Test {tok}", tags=[], body=body)
        assert vault.read_file(rel) is not None
        assert _count(canon) == 0, "precondition: not yet in the DB"

        # 2. ...and the boot-time import creates the DB page from it,
        #    under the canonical (no-.md) path.
        _import_vault()
        assert _count(canon) == 1, "import_disk_vault should create the page from the vault file"

        # 3. Re-import is idempotent — no duplicate.
        _import_vault()
        assert _count(canon) == 1, "re-import must not duplicate an existing page"

        # 4. THE BUG SURFACE: a DB-only delete (vault file left behind)...
        _delete_db_only(canon)
        assert _count(canon) == 0, "page should be gone from the DB"
        # ...is UNDONE by the next vault import (== a backend restart).
        _import_vault()
        assert _count(canon) == 1, (
            "REGRESSION: the vault is the source of truth on boot — a DB-only "
            "delete is re-created by the vault import. Cleanup MUST clear the "
            "vault too (this is the bug that re-bloated the graph on restart)."
        )
    finally:
        # Clean up BOTH, or this test itself re-pollutes on the next boot.
        vault.delete_file(rel)
        _delete_db_only(canon)
