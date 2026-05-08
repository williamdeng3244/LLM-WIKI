"""Celery worker: background jobs."""
import asyncio
import logging

from celery import Celery

from app.core.config import settings
from app.core.db import SessionLocal
from app.services.ingest import run_apply_phase, run_plan_phase
from app.services.lint import run_lint

celery_app = Celery("wiki", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.task_routes = {"app.worker.*": {"queue": "default"}}

log = logging.getLogger(__name__)


@celery_app.task
def ping():
    return "pong"


@celery_app.task(name="app.worker.ingest_plan", bind=True, max_retries=0)
def ingest_plan(self, run_id: int):  # noqa: ARG001
    """Plan phase: read source, call Claude, store plan on the run.
    Does not create any drafts."""
    log.info("Plan phase for run %d", run_id)

    async def _run():
        async with SessionLocal() as session:
            await run_plan_phase(session, run_id=run_id)

    asyncio.run(_run())
    return {"run_id": run_id, "phase": "plan"}


@celery_app.task(name="app.worker.ingest_apply", bind=True, max_retries=0)
def ingest_apply(self, run_id: int):  # noqa: ARG001
    """Apply phase: human approved (with optional per-edit toggle); now
    walk the cached plan and open drafts via the existing workflow."""
    log.info("Apply phase for run %d", run_id)

    async def _run():
        async with SessionLocal() as session:
            await run_apply_phase(session, run_id=run_id)

    asyncio.run(_run())
    return {"run_id": run_id, "phase": "apply"}


@celery_app.task(name="app.worker.run_lint_pass", bind=True, max_retries=0)
def run_lint_pass(self, report_id: int):  # noqa: ARG001
    """Lint pass: read wiki snapshot, call Claude, persist findings."""
    log.info("Lint pass for report %d", report_id)

    async def _run():
        async with SessionLocal() as session:
            await run_lint(session, report_id=report_id)

    asyncio.run(_run())
    return {"report_id": report_id}
