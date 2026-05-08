"""MCP server: exposes the wiki to external LLM clients via the Model
Context Protocol. Clients (Claude Desktop, Claude Code, Cursor, …) attach
this server in their MCP config and operate as the human user whose
personal token is presented in the Authorization header.

Transport: HTTP + JSON-RPC 2.0 (the synchronous mode of the spec). Every
client request is one POST; we respond with a JSON-RPC envelope. No SSE
streaming yet — the wiki's tools are all fast-returning so streaming is
not load-bearing.

Auth: Bearer token (the user's personal MCP token from /api/mcp-tokens).
The token authorizes as the real human; all role/category permission
checks run unchanged. Drafts created via MCP go through the existing
review queue with `force_review=True` so they never auto-publish.
"""
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import hash_token
from app.core.config import settings
from app.core.db import get_session
from app.core.permissions import can_propose
from app.models import (
    ApiToken, AuditLog, Page, RawSource, Revision, RevisionProvenance,
    RevisionStatus, Role, User,
)
from app.services.rag import retrieve
from app.services.workflow import create_draft, submit_for_review

router = APIRouter()

PROTOCOL_VERSION = "2024-11-05"


# ── Authentication ─────────────────────────────────────────────────────────

async def authenticate_mcp(
    request: Request, session: AsyncSession,
) -> User:
    """Verify Authorization header → ApiToken → User. Reject early on the
    global kill switch and the per-user mcp_enabled flag."""
    if not settings.mcp_enabled:
        raise HTTPException(503, "MCP server is globally disabled.")
    auth = request.headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    raw = auth[7:].strip()
    if not raw:
        raise HTTPException(401, "Empty bearer token")
    h = hash_token(raw)
    api_token = (await session.execute(
        select(ApiToken).where(
            ApiToken.token_hash == h,
            ApiToken.revoked_at.is_(None),
        )
    )).scalar_one_or_none()
    if api_token is None:
        raise HTTPException(401, "Invalid or revoked token")
    user = await session.get(User, api_token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "User inactive")
    if not user.mcp_enabled:
        raise HTTPException(403, "MCP access not granted to this user")
    api_token.last_used_at = datetime.now(timezone.utc)
    await session.commit()
    return user


# ── Tool catalogue ─────────────────────────────────────────────────────────

TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_wiki",
        "description": (
            "Hybrid semantic + lexical search across published wiki pages. "
            "Returns chunk-level matches with page path, snippet, and score."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
            },
            "required": ["query"],
        },
    },
    {
        "name": "list_pages",
        "description": "List every published page with path, title, tags.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "description": "Optional category slug filter."},
            },
        },
    },
    {
        "name": "get_page",
        "description": "Read one published wiki page by path; returns title, body, tags, stability.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "list_backlinks",
        "description": "List every page that wiki-links to the given page path.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "list_my_drafts",
        "description": "List the calling user's in-progress drafts.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_review_queue",
        "description": "List revisions pending review (only what the calling user can review).",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "create_draft",
        "description": (
            "Propose an edit or a new page. Routes through the standard "
            "draft → review → publish workflow. Force-review is on, so even "
            "stability=open pages do not auto-publish from MCP."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "page_path": {"type": "string", "description": "Existing page path (for edits)."},
                "new_page_path": {"type": "string", "description": "New page path (for creates)."},
                "new_page_category": {"type": "string"},
                "new_page_stability": {"type": "string", "enum": ["open", "stable", "locked"]},
                "title": {"type": "string"},
                "body": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "rationale": {"type": "string"},
            },
            "required": ["title", "body"],
        },
    },
]


# ── Tool dispatchers ───────────────────────────────────────────────────────

def _text_block(payload: Any) -> dict:
    """Pack arbitrary JSON into a single MCP text content block."""
    import json
    return {"content": [{"type": "text", "text": json.dumps(payload, default=str, indent=2)}]}


async def _tool_search(user: User, args: dict, session: AsyncSession) -> dict:
    q = (args.get("query") or "").strip()
    if not q:
        raise ValueError("query required")
    limit = int(args.get("limit") or 10)
    rows = await retrieve(session, q, k=limit)
    out = [{
        "page_path": r.page_path, "page_title": r.page_title,
        "snippet": r.content[:240] + ("…" if len(r.content) > 240 else ""),
        "score": float(r.score),
        "line_start": r.line_start, "line_end": r.line_end,
    } for r in rows]
    return _text_block(out)


async def _tool_list_pages(user: User, args: dict, session: AsyncSession) -> dict:
    from app.models import Category
    cat_slug = args.get("category")
    cat_id = None
    if cat_slug:
        cat = (await session.execute(
            select(Category).where(Category.slug == cat_slug)
        )).scalar_one_or_none()
        cat_id = cat.id if cat else -1
    q = select(Page)
    if cat_id is not None:
        q = q.where(Page.category_id == cat_id)
    rows = (await session.execute(q.order_by(Page.path))).scalars().all()
    out = [{"path": p.path, "title": p.title, "tags": list(p.tags or []),
            "stability": p.stability.value} for p in rows]
    return _text_block(out)


async def _tool_get_page(user: User, args: dict, session: AsyncSession) -> dict:
    path = (args.get("path") or "").strip().lstrip("/")
    if not path:
        raise ValueError("path required")
    p = (await session.execute(select(Page).where(Page.path == path))).scalar_one_or_none()
    if p is None:
        raise ValueError(f"Page not found: {path}")
    body = ""
    if p.current_revision_id:
        rev = await session.get(Revision, p.current_revision_id)
        if rev:
            body = rev.body
    return _text_block({
        "path": p.path, "title": p.title, "tags": list(p.tags or []),
        "stability": p.stability.value, "body": body,
    })


async def _tool_list_backlinks(user: User, args: dict, session: AsyncSession) -> dict:
    from app.models import Link
    path = (args.get("path") or "").strip().lstrip("/")
    page = (await session.execute(select(Page).where(Page.path == path))).scalar_one_or_none()
    if page is None:
        raise ValueError(f"Page not found: {path}")
    rows = (await session.execute(
        select(Page).join(Link, Link.source_id == Page.id).where(Link.target_id == page.id)
    )).scalars().all()
    out = [{"path": p.path, "title": p.title} for p in rows]
    return _text_block(out)


async def _tool_list_my_drafts(user: User, args: dict, session: AsyncSession) -> dict:
    rows = (await session.execute(
        select(Revision).where(
            Revision.author_id == user.id,
            Revision.status == RevisionStatus.draft,
        ).order_by(Revision.created_at.desc())
    )).scalars().all()
    out = [{"id": r.id, "page_id": r.page_id, "title": r.title,
            "created_at": r.created_at.isoformat()} for r in rows]
    return _text_block(out)


async def _tool_list_review_queue(user: User, args: dict, session: AsyncSession) -> dict:
    from app.core.permissions import can_review
    rows = (await session.execute(
        select(Revision).where(Revision.status == RevisionStatus.proposed)
        .order_by(Revision.created_at.desc())
    )).scalars().all()
    out = []
    for r in rows:
        page = await session.get(Page, r.page_id)
        if page is None or not await can_review(session, user, page):
            continue
        out.append({"id": r.id, "page_path": page.path, "title": r.title,
                    "author_id": r.author_id, "created_at": r.created_at.isoformat()})
    return _text_block(out)


async def _tool_create_draft(user: User, args: dict, session: AsyncSession) -> dict:
    if not await can_propose(user):
        raise PermissionError("This user cannot propose edits.")
    title = (args.get("title") or "").strip()
    body = args.get("body") or ""
    if not title or not body:
        raise ValueError("title and body required")
    tags = list(args.get("tags") or [])
    rationale = args.get("rationale")

    page_path = args.get("page_path")
    new_page_path = args.get("new_page_path")
    if page_path and new_page_path:
        raise ValueError("Provide page_path OR new_page_path, not both.")
    if not page_path and not new_page_path:
        raise ValueError("Provide page_path (edit) or new_page_path (create).")

    if page_path:
        page = (await session.execute(
            select(Page).where(Page.path == page_path.strip().lstrip("/"))
        )).scalar_one_or_none()
        if page is None:
            raise ValueError(f"Page not found: {page_path}")
    else:
        from app.models import Category, PageStability
        cat_slug = args.get("new_page_category")
        cat = None
        if cat_slug:
            cat = (await session.execute(
                select(Category).where(Category.slug == cat_slug)
            )).scalar_one_or_none()
        stability_str = (args.get("new_page_stability") or "stable").lower()
        stability = (
            PageStability.locked if stability_str == "locked"
            else PageStability.open if stability_str == "open"
            else PageStability.stable
        )
        page = Page(
            path=new_page_path.strip().lstrip("/"), title=title,
            category_id=cat.id if cat else None,
            stability=stability, tags=tags, created_by_id=user.id,
        )
        session.add(page)
        await session.flush()

    rev = await create_draft(
        session, page=page, author=user,
        title=title, body=body, tags=tags, rationale=rationale,
    )
    # Mirror Phase-3 behaviour: agent-style submissions force-review even
    # on stability=open pages until the system has earned trust.
    await submit_for_review(session, rev, user, force_review=True)

    # Mark provenance as agent-authored (the human is the author of record,
    # but the draft was generated through an MCP client).
    session.add(RevisionProvenance(
        revision_id=rev.id,
        confidence=None,
        source_refs=[],
        edit_kind="edit_existing" if page_path else "create_new",
        is_agent_authored=True,
    ))
    session.add(AuditLog(
        actor_id=user.id, action="mcp.create_draft",
        target_type="revision", target_id=rev.id,
        payload={"page_path": page.path, "via": "mcp"},
    ))
    await session.commit()
    return _text_block({
        "revision_id": rev.id, "page_path": page.path,
        "status": rev.status.value,
    })


TOOL_DISPATCH = {
    "search_wiki": _tool_search,
    "list_pages": _tool_list_pages,
    "get_page": _tool_get_page,
    "list_backlinks": _tool_list_backlinks,
    "list_my_drafts": _tool_list_my_drafts,
    "list_review_queue": _tool_list_review_queue,
    "create_draft": _tool_create_draft,
}


# ── JSON-RPC dispatch ──────────────────────────────────────────────────────

def _rpc_ok(req_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _rpc_err(req_id: Any, code: int, message: str, data: Optional[Any] = None) -> dict:
    err: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": req_id, "error": err}


@router.post("")
async def mcp_endpoint(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    user = await authenticate_mcp(request, session)
    try:
        body = await request.json()
    except Exception:
        return _rpc_err(None, -32700, "Parse error")

    if not isinstance(body, dict):
        return _rpc_err(None, -32600, "Invalid Request — only single JSON-RPC objects supported")

    req_id = body.get("id")
    method = body.get("method")
    params = body.get("params") or {}

    try:
        if method == "initialize":
            return _rpc_ok(req_id, {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "enflame-wiki", "version": "1.0.0"},
            })
        if method == "notifications/initialized":
            # spec-compliant client handshake notification → no response
            return {}
        if method == "tools/list":
            return _rpc_ok(req_id, {"tools": TOOLS})
        if method == "tools/call":
            name = params.get("name")
            args = params.get("arguments") or {}
            handler = TOOL_DISPATCH.get(name)
            if handler is None:
                return _rpc_err(req_id, -32601, f"Unknown tool: {name}")
            try:
                result = await handler(user, args, session)
                return _rpc_ok(req_id, result)
            except (ValueError, PermissionError) as e:
                return _rpc_ok(req_id, {
                    "content": [{"type": "text", "text": f"Error: {e}"}],
                    "isError": True,
                })
        if method in ("resources/list", "prompts/list"):
            # We don't expose resources or prompts — tools cover everything.
            key = method.split("/")[0]
            return _rpc_ok(req_id, {key: []})
        return _rpc_err(req_id, -32601, f"Method not found: {method}")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        return _rpc_err(req_id, -32603, f"Internal error: {e}")
