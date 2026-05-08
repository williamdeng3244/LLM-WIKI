"""CRUD for raw input documents.

Phase 1 of the Karpathy-style hybrid pipeline. The agent ingestion that
turns a RawSource into wiki-page drafts lives in Phase 3 (`/ingest`).
For now we just store, list, download, and delete.
"""
import logging
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user
from app.core.config import settings
from app.core.db import get_session
from app.models import (
    AuditLog, IngestRun, IngestRunStatus, IngestStatus,
    Page, RawSource, Revision, Role, User,
)
from app.schemas import (
    IngestRunOut, PendingDraftOut, RawSourceOut, RawSourceUpdate,
)
from app.services.ingest import (
    list_pending_drafts_for_source, supersede_pending_runs,
)
from sqlalchemy import select as sa_select  # alias to avoid shadowing imports below

router = APIRouter()
log = logging.getLogger(__name__)

MAX_BYTES = 50 * 1024 * 1024  # 50 MB hard cap per file


def _ensure_raw_dir() -> Path:
    p = Path(settings.raw_path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _safe_extension(name: str) -> str:
    suffix = Path(name).suffix.lower()
    # Allow conservatively. Anything weirder gets stored extension-less.
    if 1 <= len(suffix) <= 16 and all(c.isalnum() or c == "." for c in suffix):
        return suffix
    return ""


def _disk_filename_for(original: str) -> str:
    return f"{uuid.uuid4().hex}{_safe_extension(original)}"


@router.get("", response_model=list[RawSourceOut])
async def list_sources(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    del user
    rows = (await session.execute(
        select(RawSource).order_by(RawSource.uploaded_at.desc())
    )).scalars().all()
    return rows


@router.post("", response_model=RawSourceOut)
async def upload_source(
    file: UploadFile = File(...),
    title: str = Form(""),
    description: str = Form(""),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if user.role == Role.reader:
        raise HTTPException(403, "Readers cannot upload sources")

    raw_dir = _ensure_raw_dir()
    disk_name = _disk_filename_for(file.filename or "upload.bin")
    target = raw_dir / disk_name

    size = 0
    with target.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BYTES:
                out.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, f"File exceeds {MAX_BYTES // (1024*1024)} MB cap")
            out.write(chunk)
    await file.close()

    rs = RawSource(
        title=(title.strip() or (file.filename or disk_name)),
        description=description.strip() or None,
        original_filename=file.filename or disk_name,
        disk_filename=disk_name,
        mime_type=(file.content_type or "application/octet-stream"),
        size_bytes=size,
        uploaded_by_id=user.id,
    )
    session.add(rs)
    await session.flush()
    session.add(AuditLog(
        actor_id=user.id, action="raw.upload",
        target_type="raw_source", target_id=rs.id,
        payload={"filename": rs.original_filename, "size": size},
    ))
    await session.commit()
    await session.refresh(rs)
    return rs


@router.get("/{source_id}", response_model=RawSourceOut)
async def get_source(
    source_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    del user
    rs = await session.get(RawSource, source_id)
    if rs is None:
        raise HTTPException(404, "Not found")
    return rs


@router.patch("/{source_id}", response_model=RawSourceOut)
async def update_source(
    source_id: int, body: RawSourceUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    rs = await session.get(RawSource, source_id)
    if rs is None:
        raise HTTPException(404, "Not found")
    if user.role == Role.reader:
        raise HTTPException(403, "Readers cannot edit sources")
    if body.title is not None:
        rs.title = body.title.strip() or rs.title
    if body.description is not None:
        rs.description = body.description.strip() or None
    await session.commit()
    await session.refresh(rs)
    return rs


@router.get("/{source_id}/download")
async def download_source(
    source_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    del user
    rs = await session.get(RawSource, source_id)
    if rs is None:
        raise HTTPException(404, "Not found")
    path = Path(settings.raw_path) / rs.disk_filename
    if not path.exists():
        raise HTTPException(410, "File missing on disk")
    return FileResponse(
        path,
        media_type=rs.mime_type,
        filename=rs.original_filename,
    )


@router.get("/{source_id}/pending-drafts", response_model=list[PendingDraftOut])
async def list_pending_drafts(
    source_id: int,
    user: User = Depends(current_user),  # noqa: ARG001
    session: AsyncSession = Depends(get_session),
):
    """Lightweight summary of agent drafts on this source not yet reviewed.
    The frontend uses this to render the duplicate-draft warning before
    triggering a new ingest."""
    revs = await list_pending_drafts_for_source(session, source_id=source_id)
    out: list[PendingDraftOut] = []
    for r in revs:
        page = await session.get(Page, r.page_id)
        out.append(PendingDraftOut(
            revision_id=r.id,
            page_path=page.path if page else "",
            page_title=page.title if page else r.title,
            status=r.status,
        ))
    return out


@router.get("/{source_id}/runs", response_model=list[IngestRunOut])
async def list_runs(
    source_id: int,
    user: User = Depends(current_user),  # noqa: ARG001
    session: AsyncSession = Depends(get_session),
):
    """Source-level ingest history (newest first)."""
    rows = (await session.execute(
        sa_select(IngestRun)
        .where(IngestRun.raw_source_id == source_id)
        .order_by(IngestRun.started_at.desc())
    )).scalars().all()
    return rows


@router.post("/{source_id}/ingest", response_model=IngestRunOut)
async def ingest_source_endpoint(
    source_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Start an ingest run. Two-phase flow:
      this call → creates run + dispatches plan task → run.status=planning
      worker plans → run.status=pending_review (no drafts yet)
      human reviews → POST /api/ingest-runs/{id}/apply OR /dismiss

    If the source already has an in-flight run (planning/pending_review),
    that run is marked superseded so the new one replaces it.
    """
    if user.role == Role.reader:
        raise HTTPException(403, "Readers cannot trigger ingest")
    rs = await session.get(RawSource, source_id)
    if rs is None:
        raise HTTPException(404, "Not found")

    # Supersede any in-flight run on this source so the new plan replaces it.
    superseded = await supersede_pending_runs(session, source_id=source_id)

    run = IngestRun(
        raw_source_id=rs.id,
        triggered_by_id=user.id,
        status=IngestRunStatus.planning,
    )
    session.add(run)
    await session.flush()

    rs.ingest_status = IngestStatus.ingesting
    rs.last_ingest_notes = None
    session.add(AuditLog(
        actor_id=user.id, action="raw.ingest.queue",
        target_type="ingest_run", target_id=run.id,
        payload={
            "filename": rs.original_filename,
            "superseded_runs": superseded,
        },
    ))
    await session.commit()
    await session.refresh(run)

    from app.worker import ingest_plan as plan_task
    plan_task.delay(run_id=run.id)

    return run


@router.delete("/{source_id}", status_code=204)
async def delete_source(
    source_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if user.role != Role.admin:
        raise HTTPException(403, "Admins only")
    rs = await session.get(RawSource, source_id)
    if rs is None:
        raise HTTPException(404, "Not found")
    path = Path(settings.raw_path) / rs.disk_filename
    try:
        path.unlink(missing_ok=True)
    except Exception as e:
        log.warning("Failed to remove %s: %s", path, e)
    session.add(AuditLog(
        actor_id=user.id, action="raw.delete",
        target_type="raw_source", target_id=rs.id,
        payload={"filename": rs.original_filename},
    ))
    await session.delete(rs)
    await session.commit()
    return None
