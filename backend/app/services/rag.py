"""RAG: retrieve published chunks, answer with strict citations.

The retrieval layer joins ONLY against published pages (page.current_revision_id
not null) and chunks belong only to those. Drafts are invisible to the agent.
"""
import re
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Chunk, Page, Revision
from app.services.claude_client import get_client
from app.services.embeddings import embed_query
from app.services.linker import extract_links, normalize_link_target


SYSTEM_PROMPT = """You are the AI assistant for an internal company wiki. Answer the user's question using ONLY the SOURCES provided.

Citation rules:
- Every factual claim MUST end with a citation marker like [1], [2], etc., that maps to one of the SOURCES.
- When more than one source supports a claim, stack markers: "[1][3]".
- If the SOURCES do not contain the answer, say so plainly. Do NOT invent facts. Do NOT cite a source that does not actually support the claim.
- Prefer concrete details (function names, file paths, line numbers) when SOURCES include them.
- Keep the answer focused and concise.
"""


@dataclass
class RetrievedChunk:
    chunk_id: int
    page_id: int
    page_path: str
    page_title: str
    chunk_type: str
    content: str
    language: Optional[str]
    symbol: Optional[str]
    line_start: int
    line_end: int
    score: float


async def retrieve(session: AsyncSession, query: str, k: int = 8) -> list[RetrievedChunk]:
    """Vector retrieval over PUBLISHED pages, with lexical fallback."""
    # The join on Page implicitly scopes to existing pages; chunks only exist for
    # published content because reindex_page is called only at publish time.
    try:
        qvec = await embed_query(query)
        stmt = (
            select(
                Chunk.id, Chunk.page_id, Page.path, Page.title,
                Chunk.chunk_type, Chunk.content, Chunk.language, Chunk.symbol,
                Chunk.line_start, Chunk.line_end,
                Chunk.embedding.cosine_distance(qvec).label("dist"),
            )
            .join(Page, Page.id == Chunk.page_id)
            .where(Chunk.embedding.is_not(None))
            .where(Page.current_revision_id.is_not(None))
            .order_by("dist").limit(k)
        )
        rows = (await session.execute(stmt)).all()
        if rows:
            return [
                RetrievedChunk(
                    chunk_id=r.id, page_id=r.page_id, page_path=r.path,
                    page_title=r.title, chunk_type=r.chunk_type, content=r.content,
                    language=r.language, symbol=r.symbol,
                    line_start=r.line_start, line_end=r.line_end,
                    score=1.0 - float(r.dist),
                ) for r in rows
            ]
    except Exception:
        pass
    # Lexical fallback
    stmt = (
        select(
            Chunk.id, Chunk.page_id, Page.path, Page.title,
            Chunk.chunk_type, Chunk.content, Chunk.language, Chunk.symbol,
            Chunk.line_start, Chunk.line_end,
        )
        .join(Page, Page.id == Chunk.page_id)
        .where(Page.current_revision_id.is_not(None))
        .where(Chunk.content.ilike(f"%{query}%"))
        .limit(k)
    )
    rows = (await session.execute(stmt)).all()
    return [
        RetrievedChunk(
            chunk_id=r.id, page_id=r.page_id, page_path=r.path,
            page_title=r.title, chunk_type=r.chunk_type, content=r.content,
            language=r.language, symbol=r.symbol,
            line_start=r.line_start, line_end=r.line_end, score=0.5,
        ) for r in rows
    ]


def _format_sources(rows: list[RetrievedChunk]) -> str:
    parts = []
    for i, r in enumerate(rows, 1):
        header = f"[{i}] {r.page_title} ({r.page_path})"
        if r.chunk_type == "code":
            header += f" — {r.language or 'code'}"
            if r.symbol:
                header += f" › {r.symbol}"
            header += f" (lines {r.line_start}-{r.line_end})"
        elif r.symbol:
            header += f" › {r.symbol}"
        parts.append(f"{header}\n{r.content[:1200]}")
    return "\n\n---\n\n".join(parts)


CITE_RE = re.compile(r"\[(\d+)\]")


async def answer(
    session: AsyncSession, message: str, history: Optional[list[dict]] = None,
) -> tuple[str, list[dict]]:
    history = history or []
    rows = await retrieve(session, message, k=8)
    if not rows:
        return "I don't have any indexed content to answer from yet.", []

    sources = _format_sources(rows)
    user_message = f"SOURCES:\n\n{sources}\n\n---\n\nQUESTION: {message}"
    client = get_client()
    msg = await client.messages.create(
        model=settings.chat_model,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[*history, {"role": "user", "content": user_message}],
    )
    answer_text = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text")

    used = sorted({int(m.group(1)) for m in CITE_RE.finditer(answer_text)})
    citations = []
    for n in used:
        if 1 <= n <= len(rows):
            r = rows[n - 1]
            snippet = r.content if len(r.content) <= 400 else r.content[:400] + "…"
            citations.append({
                "n": n, "page_path": r.page_path, "page_title": r.page_title,
                "chunk_id": r.chunk_id, "chunk_type": r.chunk_type,
                "snippet": snippet, "language": r.language, "symbol": r.symbol,
                "line_start": r.line_start, "line_end": r.line_end,
            })
    return answer_text, citations


# ── Wiki-mode synthesis (Phase 5) ───────────────────────────────────────────

WIKI_SYSTEM_PROMPT = """You are the AI assistant for an internal company wiki. Answer the user's question by synthesizing across the WIKI PAGES provided below.

This wiki is the *compiled* knowledge base — pages have been deduplicated, cross-linked, and curated. Trust the pages as the source of truth; don't fall back to raw chunk-level fragments.

Citation rules:
- Every factual claim MUST end with a citation marker like [1], [2], etc., that maps to one of the WIKI PAGES.
- Stack markers when multiple pages support a claim: "[1][3]".
- If the wiki does not contain the answer, say so plainly. Do NOT invent facts.
- When pages disagree, surface the disagreement explicitly instead of silently picking one.
- Prefer concise synthesis over per-page summaries.
"""

# How many distinct pages to seed from chunk-search hits.
WIKI_SEED_PAGES = 5
# Maximum 1-hop neighbour pages added by following [[wikilinks]].
WIKI_MAX_NEIGHBOURS = 4
# Body length cap per page (keeps prompt size sane on long pages).
WIKI_BODY_TRUNCATE = 2500


async def wiki_synthesize(
    session: AsyncSession, message: str, history: Optional[list[dict]] = None,
) -> tuple[str, list[dict]]:
    """Karpathy-style chat: read full wiki pages, follow wikilinks, cite at
    page granularity instead of chunk granularity."""
    history = history or []

    # 1. Find candidate pages via chunk retrieval, dedupe by page_id.
    rows = await retrieve(session, message, k=20)
    if not rows:
        return "I don't have any indexed content to answer from yet.", []

    seen_page_ids: set[int] = set()
    seed_pages: list[RetrievedChunk] = []
    for r in rows:
        if r.page_id in seen_page_ids:
            continue
        seen_page_ids.add(r.page_id)
        seed_pages.append(r)
        if len(seed_pages) >= WIKI_SEED_PAGES:
            break

    # 2. Load the full bodies of every seed page in chunk-search order so
    #    the [N] indices line up predictably.
    sources: list[dict] = []  # ordered list shown to Claude
    by_page_id: dict[int, dict] = {}
    for sp in seed_pages:
        page = await session.get(Page, sp.page_id)
        if page is None or page.current_revision_id is None:
            continue
        rev = await session.get(Revision, page.current_revision_id)
        if rev is None:
            continue
        body = rev.body[:WIKI_BODY_TRUNCATE]
        item = {
            "page_id": page.id, "path": page.path, "title": page.title,
            "body": body, "linked_from_n": None,
        }
        sources.append(item)
        by_page_id[page.id] = item

    # 3. 1-hop expansion: follow [[wikilinks]] in seed bodies.
    all_paths = [r[0] for r in (await session.execute(select(Page.path))).all()]
    neighbours_added = 0
    for src_idx, item in enumerate(list(sources)):
        if neighbours_added >= WIKI_MAX_NEIGHBOURS:
            break
        for raw_link in extract_links(item["body"]):
            if neighbours_added >= WIKI_MAX_NEIGHBOURS:
                break
            target = normalize_link_target(raw_link, all_paths)
            if not target:
                continue
            tp = (await session.execute(
                select(Page).where(Page.path == target)
            )).scalar_one_or_none()
            if tp is None or tp.id in by_page_id or tp.current_revision_id is None:
                continue
            tr = await session.get(Revision, tp.current_revision_id)
            if tr is None:
                continue
            ndata = {
                "page_id": tp.id, "path": tp.path, "title": tp.title,
                "body": tr.body[:WIKI_BODY_TRUNCATE],
                # Reference the seed page by its 1-indexed source position.
                "linked_from_n": src_idx + 1,
            }
            sources.append(ndata)
            by_page_id[tp.id] = ndata
            neighbours_added += 1

    # 4. Build prompt.
    parts = []
    for i, s in enumerate(sources, 1):
        header = f"[{i}] {s['path']} — \"{s['title']}\""
        if s["linked_from_n"]:
            header += f"  (linked from [{s['linked_from_n']}])"
        parts.append(f"{header}\n\n{s['body']}")
    sources_block = "\n\n---\n\n".join(parts)
    user_message = f"WIKI PAGES:\n\n{sources_block}\n\n---\n\nQUESTION: {message}"

    client = get_client()
    msg = await client.messages.create(
        model=settings.chat_model,
        max_tokens=1500,
        system=WIKI_SYSTEM_PROMPT,
        messages=[*history, {"role": "user", "content": user_message}],
    )
    answer_text = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text")

    # 5. Build citations for the [N] markers Claude actually used.
    used = sorted({int(m.group(1)) for m in CITE_RE.finditer(answer_text)})
    citations: list[dict] = []
    for n in used:
        if 1 <= n <= len(sources):
            s = sources[n - 1]
            snippet = s["body"][:300] + ("…" if len(s["body"]) > 300 else "")
            citations.append({
                "n": n,
                "page_path": s["path"],
                "page_title": s["title"],
                # Page-level citations don't have a chunk; encode that with
                # chunk_id=0 and chunk_type='page' so the frontend can
                # render appropriately (no line-range, click → page top).
                "chunk_id": 0,
                "chunk_type": "page",
                "snippet": snippet,
                "language": None,
                "symbol": None,
                "line_start": 0,
                "line_end": 0,
            })
    return answer_text, citations
