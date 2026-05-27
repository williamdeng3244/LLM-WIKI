"""Apply / dismiss / fetch a single IngestRun (the preview phase)."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user
from app.core.db import get_session
from app.models import (
    AuditLog, IngestRun, IngestRunStatus, IngestStatus, RawSource, Role, User,
)
from app.schemas import IngestApply, IngestRunOut

router = APIRouter()


# (Bug #4.) If a `planning` or `applying` run hasn't progressed in this
# many minutes, the worker is presumed dead and the run is marked failed
# so the user can retry. Bumped to 45 min to accommodate MinerU's
# CPU-only PDF parsing (which can take 10–30 min per multi-page paper)
# plus the Anthropic plan call on top.
STALE_RUN_TIMEOUT_MIN = 45


async def _sweep_stale_runs(session: AsyncSession) -> int:
    """Lazy watchdog: called on every GET to ingest runs. Marks any run
    that's been in `planning` / `applying` longer than the cutoff as
    failed with a synthetic error message. Returns the number swept."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=STALE_RUN_TIMEOUT_MIN)
    stuck = (await session.execute(
        select(IngestRun).where(
            IngestRun.status.in_([IngestRunStatus.planning, IngestRunStatus.applying]),
            IngestRun.started_at < cutoff,
        )
    )).scalars().all()
    if not stuck:
        return 0
    now = datetime.now(timezone.utc)
    msg = (
        f"Worker timeout: run was {{stage}} for more than "
        f"{STALE_RUN_TIMEOUT_MIN} min with no completion signal. "
        f"This usually means the worker died mid-task; retry to re-queue."
    )
    for r in stuck:
        stage = r.status.value
        r.status = IngestRunStatus.failed
        r.error = msg.format(stage=stage)
        r.finished_at = now
        # Surface the same failure on the parent source row.
        rs = await session.get(RawSource, r.raw_source_id)
        if rs is not None and rs.ingest_status == IngestStatus.ingesting:
            rs.ingest_status = IngestStatus.failed
            rs.last_ingest_notes = r.error
    await session.commit()
    return len(stuck)


@router.get("/{run_id}", response_model=IngestRunOut)
async def get_run(
    run_id: int,
    user: User = Depends(current_user),  # noqa: ARG001
    session: AsyncSession = Depends(get_session),
):
    await _sweep_stale_runs(session)
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
    """Resume a stalled run. Smart dispatch:
      - If the run never produced a plan (plan_json is null), re-run the
        plan phase. Covers the worker-died-mid-plan case (Bug #6 / B4).
      - Otherwise (plan exists, apply failed mid-way), re-run apply. The
        apply phase is idempotent — already-applied edits are detected
        via the (ingest_run_id, edit_id) unique key and skipped.

    Allowed when status ∈ {planning, applying, failed, partially_failed}."""
    if user.role == Role.reader:
        raise HTTPException(403, "Readers cannot retry ingest runs")
    run = await session.get(IngestRun, run_id)
    if run is None:
        raise HTTPException(404, "Not found")
    allowed = {
        IngestRunStatus.planning,
        IngestRunStatus.applying,
        IngestRunStatus.failed,
        IngestRunStatus.partially_failed,
    }
    if run.status not in allowed:
        raise HTTPException(
            409,
            f"Run is {run.status.value}; can only retry "
            f"planning / applying / failed / partially_failed.",
        )

    # Decide which phase to re-run based on whether the plan exists.
    needs_plan = run.plan_json is None
    run.status = IngestRunStatus.planning if needs_plan else IngestRunStatus.applying
    run.error = None
    run.finished_at = None
    session.add(AuditLog(
        actor_id=user.id, action="raw.ingest.retry",
        target_type="ingest_run", target_id=run.id,
        payload={
            "phase": "plan" if needs_plan else "apply",
            "prior_applied": run.applied_count,
            "prior_failed": run.failed_count,
        },
    ))
    rs = await session.get(RawSource, run.raw_source_id)
    if rs is not None:
        rs.ingest_status = IngestStatus.ingesting
        rs.last_ingest_notes = (
            "Retrying plan phase…" if needs_plan else "Retrying apply phase…"
        )
    await session.commit()
    await session.refresh(run)

    if needs_plan:
        from app.worker import ingest_plan as plan_task
        plan_task.delay(run_id=run.id)
    else:
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
