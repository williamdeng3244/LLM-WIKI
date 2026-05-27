"""Celery worker: background jobs.

Important: each task creates its OWN AsyncEngine inside the per-task
`asyncio.run()` loop, then disposes it. The module-level SessionLocal /
engine in `app.core.db` is bound to whichever loop first touched it
(during FastAPI startup in the backend process — never relevant here,
or during the first task in this worker process). Using it from
subsequent tasks raised
    RuntimeError: ... got Future ... attached to a different loop
because asyncpg's connection-pool Futures cannot cross event loops.
The task-scoped engine pattern below sidesteps the issue entirely and
also means each task's DB pool is fully cleaned up before the task
returns. (Bug #6.)
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from celery import Celery
from sqlalchemy.ext.asyncio import (
    AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine,
)

from app.core.config import settings
from app.services.ingest import run_apply_phase, run_plan_phase
from app.services.lint import run_lint

celery_app = Celery("wiki", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.task_routes = {"app.worker.*": {"queue": "default"}}

log = logging.getLogger(__name__)


@asynccontextmanager
async def _task_session() -> AsyncIterator[AsyncSession]:
    """Yield an AsyncSession backed by a fresh engine. Both are torn down
    cleanly when the context exits, so the task leaves no DB resources
    bound to its (about-to-be-discarded) event loop."""
    engine: AsyncEngine = create_async_engine(
        settings.database_url,
        # Small per-task pool — each task only uses one connection.
        pool_size=1, max_overflow=2, pool_pre_ping=True,
    )
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with Session() as session:
            yield session
    finally:
        await engine.dispose()


@celery_app.task
def ping():
    return "pong"


@celery_app.task(name="app.worker.ingest_plan", bind=True, max_retries=0)
def ingest_plan(self, run_id: int):  # noqa: ARG001
    """Plan phase: read source, call Claude, store plan on the run.
    Does not create any drafts."""
    log.info("Plan phase for run %d", run_id)

    async def _run():
        async with _task_session() as session:
            await run_plan_phase(session, run_id=run_id)

    asyncio.run(_run())
    return {"run_id": run_id, "phase": "plan"}


@celery_app.task(name="app.worker.ingest_apply", bind=True, max_retries=0)
def ingest_apply(self, run_id: int):  # noqa: ARG001
    """Apply phase: human approved (with optional per-edit toggle); now
    walk the cached plan and open drafts via the existing workflow."""
    log.info("Apply phase for run %d", run_id)

    async def _run():
        async with _task_session() as session:
            await run_apply_phase(session, run_id=run_id)

    asyncio.run(_run())
    return {"run_id": run_id, "phase": "apply"}


@celery_app.task(name="app.worker.run_lint_pass", bind=True, max_retries=0)
def run_lint_pass(self, report_id: int):  # noqa: ARG001
    """Lint pass: read wiki snapshot, call Claude, persist findings."""
    log.info("Lint pass for report %d", report_id)

    async def _run():
        async with _task_session() as session:
            await run_lint(session, report_id=report_id)

    asyncio.run(_run())
    return {"report_id": report_id}
