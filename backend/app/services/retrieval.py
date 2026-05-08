"""Pluggable retrieval for the ingest agent.

Encapsulates "what context does the agent need to merge a raw source into
the wiki?" Phase 3 ships a directory-scan strategy: include every page's
path/title/tags, plus the FULL bodies of pages whose tags or path overlap
the source. This is bounded by ~30 included pages and works fine for the
seed corpus.

Future: swap in semantic retrieval against `chunks.embedding` so the
context stays small as the wiki grows. The interface here is the seam.
"""
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Page, RawSource, Revision


@dataclass
class PageStub:
    path: str
    title: str
    tags: list[str]


@dataclass
class FocusedPage:
    path: str
    title: str
    tags: list[str]
    body: str


@dataclass
class RetrievalContext:
    directory: list[PageStub]
    focus: list[FocusedPage]
    strategy: str  # human-readable, ends up in audit/notes


def _slug_terms(s: str) -> set[str]:
    """Crude tokenization for fuzzy overlap."""
    out: set[str] = set()
    cur = []
    for ch in s.lower():
        if ch.isalnum():
            cur.append(ch)
        else:
            if cur:
                out.add("".join(cur))
                cur = []
    if cur:
        out.add("".join(cur))
    return {t for t in out if len(t) > 2}


async def gather_context(
    session: AsyncSession, source: RawSource, *,
    max_focus: int = 8,
    max_directory: int = 200,
) -> RetrievalContext:
    """Directory-scan strategy.

    Score each page by token overlap between (raw source title + filename + tags)
    and (page path + title + tags). Top-K become focus pages with full bodies.
    Everything else stays in the directory as path/title/tags only.
    """
    pages = (await session.execute(select(Page))).scalars().all()
    if not pages:
        return RetrievalContext(directory=[], focus=[], strategy="directory-scan")

    src_terms = _slug_terms(
        " ".join([source.title or "", source.original_filename or ""])
    )

    scored = []
    for p in pages:
        terms = _slug_terms(" ".join([p.path, p.title] + list(p.tags or [])))
        score = len(src_terms & terms)
        scored.append((score, p))
    scored.sort(key=lambda t: t[0], reverse=True)

    focus_pages = [p for s, p in scored[:max_focus] if s > 0]
    focus: list[FocusedPage] = []
    for p in focus_pages:
        body = ""
        if p.current_revision_id:
            rev = (await session.execute(
                select(Revision).where(Revision.id == p.current_revision_id)
            )).scalar_one_or_none()
            if rev is not None:
                body = rev.body
        focus.append(FocusedPage(path=p.path, title=p.title, tags=list(p.tags or []), body=body))

    directory = [
        PageStub(path=p.path, title=p.title, tags=list(p.tags or []))
        for p in pages[:max_directory]
    ]
    return RetrievalContext(directory=directory, focus=focus, strategy="directory-scan")
