"""Hybrid search."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user
from app.core.db import get_session
from app.models import User
from app.schemas import SearchResult
from app.services.rag import retrieve

router = APIRouter()


@router.get("", response_model=list[SearchResult])
async def search(
    q: str = Query(..., min_length=1), k: int = 10,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    rows = await retrieve(session, q, k=k)
    return [
        SearchResult(
            page_id=r.page_id, page_path=r.page_path, page_title=r.page_title,
            chunk_id=r.chunk_id, chunk_type=r.chunk_type,
            snippet=(r.content if len(r.content) <= 240 else r.content[:240] + "…"),
            line_start=r.line_start, line_end=r.line_end, score=r.score,
        ) for r in rows
    ]
