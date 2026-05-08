"""One-shot: re-chunk and re-embed every page's current revision.

Run after a schema change to the chunks table or after switching
embedding providers, e.g.:

    docker exec wiki-backend-1 python -m app.scripts.backfill_embeddings

Idempotent: reindex_page wipes the existing chunks for the page first.
"""
import asyncio
import logging

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import Page, Revision
from app.services.indexer import reindex_page, resolve_all_links

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
log = logging.getLogger(__name__)


async def main() -> None:
    async with SessionLocal() as session:
        pages = (await session.execute(select(Page))).scalars().all()
        if not pages:
            log.info("No pages to reindex.")
            return
        n = 0
        for page in pages:
            if not page.current_revision_id:
                log.info("skip %s (no published revision)", page.path)
                continue
            rev = (await session.execute(
                select(Revision).where(Revision.id == page.current_revision_id)
            )).scalar_one_or_none()
            if rev is None:
                log.info("skip %s (revision %d missing)", page.path, page.current_revision_id)
                continue
            await reindex_page(session, page, rev)
            log.info("reindexed %s", page.path)
            n += 1
        await session.commit()
        await resolve_all_links(session)
        log.info("Done. Reindexed %d pages.", n)


if __name__ == "__main__":
    asyncio.run(main())
