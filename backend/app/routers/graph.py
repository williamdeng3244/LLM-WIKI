"""Graph view data."""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user
from app.core.db import get_session
from app.models import Category, Link, Page, User
from app.schemas import GraphData, GraphEdge, GraphNode

router = APIRouter()


@router.get("", response_model=GraphData)
async def graph(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    pages = (await session.execute(
        select(Page).where(Page.current_revision_id.is_not(None))
    )).scalars().all()
    cats = {c.id: c.slug for c in (await session.execute(select(Category))).scalars().all()}

    counts_q = (
        select(Link.target_id, func.count(Link.id).label("c"))
        .where(Link.target_id.is_not(None))
        .group_by(Link.target_id)
    )
    counts = {r.target_id: r.c for r in (await session.execute(counts_q)).all()}

    nodes = [
        GraphNode(
            id=p.path, title=p.title,
            category=cats.get(p.category_id) if p.category_id else None,
            tags=list(p.tags or []), backlinks=counts.get(p.id, 0),
        ) for p in pages
    ]

    pages_by_id = {p.id: p for p in pages}
    edges_q = select(Link.source_id, Link.target_id).where(Link.target_id.is_not(None))
    edges: list[GraphEdge] = []
    seen: set[tuple[str, str]] = set()
    for sid, tid in (await session.execute(edges_q)).all():
        sp, tp = pages_by_id.get(sid), pages_by_id.get(tid)
        if not sp or not tp:
            continue
        a, b = sorted([sp.path, tp.path])
        if (a, b) in seen:
            continue
        seen.add((a, b))
        edges.append(GraphEdge(source=sp.path, target=tp.path))

    return GraphData(nodes=nodes, edges=edges)
