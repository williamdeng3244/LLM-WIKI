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

    # Category for graph-coloring purposes. When the page has an explicit
    # `category_id` we use that; otherwise we fall back to the path's
    # first segment (e.g. `concepts/foo.md` → `concepts`). Without this
    # fallback, agent-created folders that don't have matching Category
    # rows in the DB end up as `null` on every node — the GraphSettings
    # color grid has no way to surface them, so users can't recolor them.
    def _derived_category(p: Page) -> str | None:
        if p.category_id and (slug := cats.get(p.category_id)):
            return slug
        if "/" in p.path:
            return p.path.split("/", 1)[0]
        return None

    nodes = [
        GraphNode(
            id=p.path, title=p.title,
            category=_derived_category(p),
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
