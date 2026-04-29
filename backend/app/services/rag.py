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
from app.models import Chunk, Page
from app.services.claude_client import get_client
from app.services.embeddings import embed_query


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
