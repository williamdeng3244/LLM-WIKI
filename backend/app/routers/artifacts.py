"""Gated artifact CRUD — `/api/artifacts/*`.

Lifecycle:
  POST /api/artifacts                 → create v1, return short_id + url
  POST /api/artifacts/from-page/{p}   → snapshot a wiki page as markdown
  POST /api/artifacts/{sid}/versions  → upload a new version (owner+admin)
  GET  /api/artifacts                 → list current user's artifacts
  GET  /api/artifacts/{sid}           → metadata + views_7d
  PATCH/api/artifacts/{sid}           → rename / change visibility / expire
  DELETE /api/artifacts/{sid}         → soft delete (sets deleted_at)
  GET  /api/artifacts/{sid}/access-log → recent views (owner+admin)

The actual `/a/<short_id>` viewer route lives in `artifact_viewer.py` —
that one is mounted at the app root and is the auth-gated security
boundary. This router is purely the management surface.

Spec deviations (noted in PR description):
  - Offset pagination instead of cursor — matches the rest of the codebase
  - Per-user rate limit is a TODO in this commit (will land as a small
    follow-up using `redis.asyncio` INCR + EXPIRE)
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, Request, UploadFile,
)
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user
from app.core.config import settings
from app.core.db import get_session
from app.models import (
    ALLOWED_MIME_TYPES, Artifact, ArtifactAccessLog, ArtifactVersion,
    Page, Revision, Role, User, VALID_VISIBILITIES, VISIBILITY_PRIVATE, VISIBILITY_WIKI,
    VISIBILITY_PUBLIC,
)
from app.schemas import (
    ArtifactAccessLogEntry, ArtifactAccessLogResponse,
    ArtifactCreateResponse, ArtifactListResponse, ArtifactMeta,
    ArtifactPatchRequest,
)
from app.services.artifact_storage import get_storage

router = APIRouter()


# ── Helpers (also re-used by the MCP tool registration in commit 4) ───


_SHORT_ID_LEN = 10
# url-safe but **stable**: drop the `_` and `-` from token_urlsafe output
# so links double-click-select cleanly in chat clients.
_SHORT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def generate_short_id(n: int = _SHORT_ID_LEN) -> str:
    """8–10-char URL-safe slug. Spec § 4 names nanoid; using stdlib
    `secrets.choice` over a 62-char alphabet gives ~5.95 bits/char =
    ~59 bits of entropy at length 10. With <1M artifacts ever per
    instance the collision probability is ~1.4e-5 — we still retry on
    IntegrityError below to be safe."""
    return "".join(secrets.choice(_SHORT_ID_ALPHABET) for _ in range(n))


_SLUG_STRIP = re.compile(r"[^\w\s-]")
_SLUG_DASH = re.compile(r"[\s_]+")


def slugify(name: str) -> str:
    """Kebab-case the human name for the decorative trailing URL slug.
    Empty / unicode-only inputs collapse to `untitled` so the URL is
    always well-formed."""
    s = _SLUG_STRIP.sub("", name.lower())
    s = _SLUG_DASH.sub("-", s).strip("-")
    return (s or "untitled")[:200]


def _resolve_expiry(
    explicit: Optional[datetime],
    default_days: Optional[int],
) -> Optional[datetime]:
    if explicit is not None:
        # Naive ISO strings are interpreted as UTC for safety; clients
        # that care can pass explicit `Z` / offset suffixes.
        if explicit.tzinfo is None:
            explicit = explicit.replace(tzinfo=timezone.utc)
        return explicit
    if default_days is not None and default_days > 0:
        return datetime.now(timezone.utc) + timedelta(days=default_days)
    return None


def _build_url(short_id: str, slug: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}/a/{short_id}-{slug}"


def _validate_visibility(visibility: str) -> None:
    if visibility not in VALID_VISIBILITIES:
        raise HTTPException(
            400, f"visibility must be one of {sorted(VALID_VISIBILITIES)}"
        )
    if visibility == VISIBILITY_PUBLIC and not settings.artifacts_allow_public:
        # Spec § 6: 403 when the public-share flag is off.
        raise HTTPException(
            403,
            "Public-visibility artifacts are disabled on this instance "
            "(ARTIFACTS_ALLOW_PUBLIC=false).",
        )


def _validate_mime(mime: str) -> None:
    if mime not in ALLOWED_MIME_TYPES:
        # Spec § 6: 415 for unsupported types.
        raise HTTPException(
            415,
            f"Only {sorted(ALLOWED_MIME_TYPES)} accepted; got {mime!r}.",
        )


async def _resolve_artifact(
    session: AsyncSession, short_id: str, *, include_soft_deleted: bool = False,
) -> Optional[Artifact]:
    """Look up by short_id. Returns None for missing / soft-deleted (so
    the caller can collapse them into a generic 404, no existence leak).
    Pass `include_soft_deleted=True` for owner / admin routes that need
    to act on deleted rows (e.g. `/api/admin/artifacts`)."""
    art = (await session.execute(
        select(Artifact).where(Artifact.short_id == short_id)
    )).scalar_one_or_none()
    if art is None:
        return None
    if not include_soft_deleted and art.deleted_at is not None:
        return None
    return art


def _can_modify(art: Artifact, user: User) -> bool:
    return art.owner_id == user.id or user.role == Role.admin


def _ensure_owner_or_admin(art: Artifact, user: User) -> None:
    if not _can_modify(art, user):
        raise HTTPException(403, "Only the owner or an admin can do this.")


async def _views_7d(session: AsyncSession, artifact_id: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    return (await session.execute(
        select(func.count(ArtifactAccessLog.id)).where(
            ArtifactAccessLog.artifact_id == artifact_id,
            ArtifactAccessLog.accessed_at >= cutoff,
        )
    )).scalar() or 0


async def _to_meta(session: AsyncSession, art: Artifact) -> ArtifactMeta:
    meta = ArtifactMeta.model_validate(art)
    meta.views_7d = await _views_7d(session, art.id)
    return meta


async def persist_new_artifact(
    session: AsyncSession,
    *,
    owner: User,
    name: str,
    body: bytes,
    mime_type: str,
    visibility: str = VISIBILITY_WIKI,
    expires_at: Optional[datetime] = None,
    is_bundle: bool = False,
) -> Artifact:
    """Internal: write a brand-new artifact (v1) + persist its body. Used
    by the upload endpoint, the from-page snapshot endpoint, the directory
    bundle endpoint, AND the MCP `publish_artifact` tool — sharing one code
    path keeps validation and storage layout consistent."""
    # Bundles store a .zip whose MIME isn't in the single-file allow-list;
    # the caller has already validated the zip contents, so skip the check.
    if not is_bundle:
        _validate_mime(mime_type)
    _validate_visibility(visibility)

    if len(body) > settings.artifacts_max_body_bytes:
        # Spec § 11 test_max_body_size_enforced expects 413.
        raise HTTPException(
            413,
            f"Body of {len(body)} bytes exceeds limit "
            f"({settings.artifacts_max_body_bytes}).",
        )

    expires_at = _resolve_expiry(expires_at, settings.artifacts_default_expiry_days)

    # Retry on short_id collision. Practically never trips, but the unique
    # index would reject otherwise.
    storage = get_storage()
    for _ in range(5):
        short_id = generate_short_id()
        artifact = Artifact(
            short_id=short_id,
            name=name[:200] or "Untitled artifact",
            slug=slugify(name),
            owner_id=owner.id,
            mime_type=mime_type,
            visibility=visibility,
            current_version=1,
            expires_at=expires_at,
            is_bundle=is_bundle,
        )
        session.add(artifact)
        try:
            await session.flush()
            break
        except Exception:  # noqa: BLE001 — IntegrityError or similar
            await session.rollback()
            continue
    else:
        raise HTTPException(500, "Could not allocate a unique short_id.")

    storage_path = await storage.save(short_id, 1, body)
    version = ArtifactVersion(
        artifact_id=artifact.id,
        version=1,
        content_hash=hashlib.sha256(body).hexdigest(),
        body_size=len(body),
        storage_path=storage_path,
        created_by_id=owner.id,
    )
    session.add(version)
    await session.commit()
    await session.refresh(artifact)
    return artifact


# ── Endpoints ─────────────────────────────────────────────────────────


@router.post("", response_model=ArtifactCreateResponse, status_code=201)
async def create_artifact(
    file: UploadFile = File(...),
    name: Optional[str] = Form(default=None),
    visibility: str = Form(default=VISIBILITY_WIKI),
    expires_at: Optional[datetime] = Form(default=None),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    body = await file.read()
    art = await persist_new_artifact(
        session,
        owner=user,
        name=(name or file.filename or "Untitled artifact"),
        body=body,
        mime_type=(file.content_type or "application/octet-stream"),
        visibility=visibility,
        expires_at=expires_at,
    )
    return ArtifactCreateResponse(
        short_id=art.short_id,
        url=_build_url(art.short_id, art.slug),
        version=art.current_version,
    )


@router.post("/from-page/{page_path:path}", response_model=ArtifactCreateResponse, status_code=201)
async def create_artifact_from_page(
    page_path: str,
    visibility: str = VISIBILITY_WIKI,
    expires_at: Optional[datetime] = None,
    name: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Snapshot a wiki page's current published markdown into a new
    artifact. The page is NOT modified; deleting / renaming it later
    does not affect the artifact's body — that's the whole point of
    snapshotting."""
    page = (await session.execute(
        select(Page).where(Page.path == page_path)
    )).scalar_one_or_none()
    if page is None or page.current_revision_id is None:
        raise HTTPException(404, "Page not found or has no published revision.")

    rev = await session.get(Revision, page.current_revision_id)
    if rev is None:
        raise HTTPException(404, "Page revision missing.")

    body_text = rev.body or ""
    art = await persist_new_artifact(
        session,
        owner=user,
        name=name or page.title or page.path,
        body=body_text.encode("utf-8"),
        mime_type="text/markdown",
        visibility=visibility,
        expires_at=expires_at,
    )
    return ArtifactCreateResponse(
        short_id=art.short_id,
        url=_build_url(art.short_id, art.slug),
        version=art.current_version,
    )


@router.post("/bundle", response_model=ArtifactCreateResponse, status_code=201)
async def create_bundle(
    file: UploadFile = File(...),
    name: Optional[str] = Form(default=None),
    visibility: str = Form(default=VISIBILITY_WIKI),
    expires_at: Optional[datetime] = Form(default=None),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Publish a whole directory as one artifact. The client uploads a .zip
    of the directory (entry point: index.html at the zip root). It's served
    at /a/<short_id>/<path>, so relative assets (css/js/images) resolve to
    the same origin and a multi-file site works without inlining."""
    import io
    import zipfile

    body = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Bundle must be a .zip archive.")
    names = zf.namelist()
    if "index.html" not in names:
        raise HTTPException(400, "Bundle must contain index.html at its root.")
    # Reject path traversal / absolute members up front so the viewer can
    # trust every archive member name it later serves.
    for n in names:
        norm = n.replace("\\", "/")
        if norm.startswith("/") or ".." in norm.split("/"):
            raise HTTPException(400, f"Unsafe path in bundle: {n}")

    art = await persist_new_artifact(
        session,
        owner=user,
        name=(name or file.filename or "Untitled bundle"),
        body=body,
        mime_type="text/html",  # entry point renders inside the sandboxed iframe
        visibility=visibility,
        expires_at=expires_at,
        is_bundle=True,
    )
    return ArtifactCreateResponse(
        short_id=art.short_id,
        url=_build_url(art.short_id, art.slug),
        version=art.current_version,
    )


@router.post("/{short_id}/versions", response_model=ArtifactCreateResponse, status_code=201)
async def upload_new_version(
    short_id: str,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    art = await _resolve_artifact(session, short_id)
    if art is None:
        raise HTTPException(404, "Artifact not found.")
    _ensure_owner_or_admin(art, user)

    body = await file.read()
    mime = file.content_type or art.mime_type
    _validate_mime(mime)
    if len(body) > settings.artifacts_max_body_bytes:
        raise HTTPException(413, "Body too large.")

    new_version = art.current_version + 1
    storage_path = await get_storage().save(art.short_id, new_version, body)
    version = ArtifactVersion(
        artifact_id=art.id,
        version=new_version,
        content_hash=hashlib.sha256(body).hexdigest(),
        body_size=len(body),
        storage_path=storage_path,
        created_by_id=user.id,
    )
    session.add(version)
    art.current_version = new_version
    art.mime_type = mime
    await session.commit()
    await session.refresh(art)
    return ArtifactCreateResponse(
        short_id=art.short_id,
        url=_build_url(art.short_id, art.slug),
        version=art.current_version,
    )


@router.get("", response_model=ArtifactListResponse)
async def list_my_artifacts(
    limit: int = 20,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    base = select(Artifact).where(
        Artifact.owner_id == user.id,
        Artifact.deleted_at.is_(None),
    )
    total = (await session.execute(
        select(func.count()).select_from(base.subquery())
    )).scalar() or 0
    rows = (await session.execute(
        base.order_by(Artifact.created_at.desc()).limit(limit).offset(offset)
    )).scalars().all()
    items = [await _to_meta(session, a) for a in rows]
    return ArtifactListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/public", response_model=ArtifactListResponse)
async def list_public_artifacts(
    limit: int = 20,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
):
    """Public artifacts — **no auth required**. The signed-out /artifacts
    page calls this so a logged-out visitor still sees public shares on
    this server. Only `visibility=public` rows that aren't soft-deleted
    or past their expiry are returned. Declared before `/{short_id}` so
    the literal path wins over the wildcard.

    Note: this lists every public artifact on the instance, not just one
    owner's — a logged-out caller can't be tied to an owner, and public
    artifacts are viewable by anyone anyway."""
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    now = datetime.now(timezone.utc)
    base = select(Artifact).where(
        Artifact.visibility == VISIBILITY_PUBLIC,
        Artifact.deleted_at.is_(None),
        or_(Artifact.expires_at.is_(None), Artifact.expires_at > now),
    )
    total = (await session.execute(
        select(func.count()).select_from(base.subquery())
    )).scalar() or 0
    rows = (await session.execute(
        base.order_by(Artifact.created_at.desc()).limit(limit).offset(offset)
    )).scalars().all()
    items = [await _to_meta(session, a) for a in rows]
    return ArtifactListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/{short_id}", response_model=ArtifactMeta)
async def get_artifact(
    short_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    art = await _resolve_artifact(session, short_id)
    if art is None:
        raise HTTPException(404, "Artifact not found.")
    # A private artifact's metadata is owner/admin-only — return the SAME generic
    # 404 as the viewer for anyone else, so its name/owner/existence isn't leaked
    # (FR-ART-007). wiki/public metadata stays visible to any authenticated user.
    if art.visibility == VISIBILITY_PRIVATE and not _can_modify(art, user):
        raise HTTPException(404, "Artifact not found.")
    return await _to_meta(session, art)


@router.patch("/{short_id}", response_model=ArtifactMeta)
async def patch_artifact(
    short_id: str,
    body: ArtifactPatchRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    art = await _resolve_artifact(session, short_id)
    if art is None:
        raise HTTPException(404, "Artifact not found.")
    _ensure_owner_or_admin(art, user)

    if body.name is not None:
        art.name = body.name[:200] or art.name
        art.slug = slugify(body.name)
    if body.visibility is not None:
        _validate_visibility(body.visibility)
        art.visibility = body.visibility
    if body.expires_at is not None:
        art.expires_at = _resolve_expiry(body.expires_at, None)

    await session.commit()
    await session.refresh(art)
    return await _to_meta(session, art)


@router.delete("/{short_id}", status_code=204)
async def soft_delete_artifact(
    short_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    art = await _resolve_artifact(session, short_id)
    if art is None:
        # Already gone → idempotent 204.
        return
    _ensure_owner_or_admin(art, user)
    art.deleted_at = datetime.now(timezone.utc)
    await session.commit()


@router.get("/{short_id}/access-log", response_model=ArtifactAccessLogResponse)
async def get_access_log(
    short_id: str,
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    art = await _resolve_artifact(session, short_id, include_soft_deleted=True)
    if art is None:
        raise HTTPException(404, "Artifact not found.")
    _ensure_owner_or_admin(art, user)
    limit = max(1, min(limit, 200))

    # Join to users so we can return emails. Older deleted users come
    # back as `None` (ArtifactAccessLog.user_id is ON DELETE SET NULL).
    stmt = (
        select(ArtifactAccessLog, User.email)
        .outerjoin(User, User.id == ArtifactAccessLog.user_id)
        .where(ArtifactAccessLog.artifact_id == art.id)
        .order_by(ArtifactAccessLog.accessed_at.desc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    items = [
        ArtifactAccessLogEntry(
            user_id=log.user_id,
            user_email=email,
            version=log.version,
            accessed_at=log.accessed_at,
            ip=log.ip,
            user_agent=log.user_agent,
        )
        for log, email in rows
    ]
    total = (await session.execute(
        select(func.count(ArtifactAccessLog.id)).where(
            ArtifactAccessLog.artifact_id == art.id
        )
    )).scalar() or 0
    return ArtifactAccessLogResponse(items=items, total=total, limit=limit)
