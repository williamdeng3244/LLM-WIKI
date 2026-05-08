"""Apply / dismiss / fetch a single IngestRun (the preview phase)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user
from app.core.db import get_session
from app.models import (
    AuditLog, IngestRun, IngestRunStatus, IngestStatus, RawSource, Role, User,
)
from app.schemas import IngestApply, IngestRunOut

router = APIRouter()


@router.get("/{run_id}", response_model=IngestRunOut)
async def get_run(
    run_id: int,
    user: User = Depends(current_user),  # noqa: ARG001
    session: AsyncSession = Depends(get_session),
):
    run = await session.get(IngestRun, run_id)
    if run is None:
        raise HTTPException(404, "Not found")
    return run


@router.post("/{run_id}/apply", response_model=IngestRunOut)
async def apply_run(
    run_id: int, body: IngestApply,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Approve a plan: dispatches the apply phase. Optional
    `approved_indices` lets the human cherry-pick which edits to land."""
    if user.role == Role.reader:
        raise HTTPException(403, "Readers cannot apply ingest plans")
    run = await session.get(IngestRun, run_id)
    if run is None:
        raise HTTPException(404, "Not found")
    if run.status != IngestRunStatus.pending_review:
        raise HTTPException(
            409, f"Run is {run.status.value}, not pending_review.",
        )

    if body.approved_indices is not None:
        # Validate indices fit the cached plan.
        edits = (run.plan_json or {}).get("edits") or []
        for i in body.approved_indices:
            if not (0 <= i < len(edits)):
                raise HTTPException(400, f"Invalid edit index {i}")
        run.approved_edit_indices = list(body.approved_indices)
    run.status = IngestRunStatus.applying
    run.applied_at = datetime.now(timezone.utc)
    session.add(AuditLog(
        actor_id=user.id, action="raw.ingest.approve",
        target_type="ingest_run", target_id=run.id,
        payload={"approved_count": (
            len(body.approved_indices) if body.approved_indices is not None
            else (run.edits_count or 0)
        )},
    ))
    rs = await session.get(RawSource, run.raw_source_id)
    if rs is not None:
        rs.ingest_status = IngestStatus.ingesting
        rs.last_ingest_notes = "Applying approved edits…"
    await session.commit()
    await session.refresh(run)

    from app.worker import ingest_apply as apply_task
    apply_task.delay(run_id=run.id)

    return run


@router.post("/{run_id}/retry", response_model=IngestRunOut)
async def retry_run(
    run_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Resume a stalled or partially-completed apply phase.

    Allowed when status ∈ {applying, failed, partially_failed}. The apply
    phase is idempotent — already-applied edits are detected via the
    (ingest_run_id, edit_id) unique key and skipped on retry."""
    if user.role == Role.reader:
        raise HTTPException(403, "Readers cannot retry ingest runs")
    run = await session.get(IngestRun, run_id)
    if run is None:
        raise HTTPException(404, "Not found")
    allowed = {
        IngestRunStatus.applying,
        IngestRunStatus.failed,
        IngestRunStatus.partially_failed,
    }
    if run.status not in allowed:
        raise HTTPException(
            409,
            f"Run is {run.status.value}; can only retry "
            f"applying / failed / partially_failed.",
        )
    run.status = IngestRunStatus.applying
    run.error = None
    run.finished_at = None
    session.add(AuditLog(
        actor_id=user.id, action="raw.ingest.retry",
        target_type="ingest_run", target_id=run.id,
        payload={"prior_applied": run.applied_count, "prior_failed": run.failed_count},
    ))
    rs = await session.get(RawSource, run.raw_source_id)
    if rs is not None:
        rs.ingest_status = IngestStatus.ingesting
        rs.last_ingest_notes = "Retrying apply phase…"
    await session.commit()
    await session.refresh(run)

    from app.worker import ingest_apply as apply_task
    apply_task.delay(run_id=run.id)

    return run


@router.post("/{run_id}/dismiss", response_model=IngestRunOut)
async def dismiss_run(
    run_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Reject a plan: no drafts will be created. Plan stays on the row
    forever (per #5 — keep rejected plans in history)."""
    if user.role == Role.reader:
        raise HTTPException(403, "Readers cannot dismiss ingest plans")
    run = await session.get(IngestRun, run_id)
    if run is None:
        raise HTTPException(404, "Not found")
    if run.status != IngestRunStatus.pending_review:
        raise HTTPException(
            409, f"Run is {run.status.value}, not pending_review.",
        )
    run.status = IngestRunStatus.dismissed
    run.finished_at = datetime.now(timezone.utc)
    session.add(AuditLog(
        actor_id=user.id, action="raw.ingest.dismiss",
        target_type="ingest_run", target_id=run.id, payload={},
    ))
    rs = await session.get(RawSource, run.raw_source_id)
    if rs is not None:
        rs.ingest_status = IngestStatus.failed
        rs.last_ingest_notes = "Plan dismissed by reviewer."
    await session.commit()
    await session.refresh(run)
    return run
