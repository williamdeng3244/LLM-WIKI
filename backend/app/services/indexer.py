"""Indexer: rebuilds chunks/embeddings/links from a published revision.

Critical: this only runs on accepted revisions. Drafts never index.
"""
import logging
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Chunk, Link, Page, Revision
from app.services.chunker import chunk_markdown
from app.services.embeddings import embed_texts
from app.services.linker import extract_links, normalize_link_target

log = logging.getLogger(__name__)


async def reindex_page(session: AsyncSession, page: Page, revision: Revision) -> None:
    """Replace chunks + outgoing links for a page based on the revision body."""
    await session.execute(delete(Chunk).where(Chunk.page_id == page.id))
    await session.execute(delete(Link).where(Link.source_id == page.id))

    chunks = chunk_markdown(revision.body)
    embeddings: list = [None] * len(chunks)
    if chunks:
        try:
            embeddings = await embed_texts([c.content for c in chunks])
        except Exception as e:
            log.warning("Embedding failed for %s: %s", page.path, e)
            embeddings = [None] * len(chunks)
    for c, vec in zip(chunks, embeddings):
        session.add(Chunk(
            page_id=page.id, chunk_index=c.chunk_index, content=c.content,
            chunk_type=c.chunk_type, language=c.language, symbol=c.symbol,
            line_start=c.line_start, line_end=c.line_end, embedding=vec,
        ))
    for target in extract_links(revision.body):
        session.add(Link(source_id=page.id, target_path=target))
    await session.flush()


async def resolve_all_links(session: AsyncSession) -> None:
    """Best-effort second pass: resolve link target paths to page ids."""
    paths = [r[0] for r in (await session.execute(select(Page.path))).all()]
    if not paths:
        return
    path_to_id = {p: pid for p, pid in (
        await session.execute(select(Page.path, Page.id))
    ).all()}
    unresolved = (await session.execute(
        select(Link).where(Link.target_id.is_(None))
    )).scalars().all()
    for link in unresolved:
        resolved = normalize_link_target(link.target_path, paths)
        if resolved and resolved in path_to_id:
            link.target_id = path_to_id[resolved]
    await session.commit()
