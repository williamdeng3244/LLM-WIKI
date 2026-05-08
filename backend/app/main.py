"""FastAPI app entrypoint."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.core.db import Base, SessionLocal, engine
from app.routers import (
    admin, auth, chat, comments, graph, ingest_runs, mcp, mcp_tokens,
    notifications, pages, raw_sources, revisions, search, users,
)
from app.services.bootstrap import ensure_default_admin, ensure_categories, import_disk_vault

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema setup. PROD TODO: replace with Alembic.
    # Enum extensions must run in their own transaction in older Postgres
    # versions; do them first via AUTOCOMMIT, before any other DDL.
    raw = engine.execution_options(isolation_level="AUTOCOMMIT")
    async with raw.connect() as conn:
        try:
            await conn.execute(text(
                "ALTER TYPE ingestrunstatus ADD VALUE IF NOT EXISTS 'partially_failed'"
            ))
        except Exception as e:  # enum not yet created on first boot
            log.info("ingestrunstatus enum bootstrap: %s", e)

    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
        # Inline migrations for additive changes that create_all can't apply
        # to existing tables. Each statement is idempotent.
        await conn.execute(text(
            "ALTER TABLE IF EXISTS revision_provenance "
            "ADD COLUMN IF NOT EXISTS ingest_run_id INTEGER "
            "REFERENCES ingest_runs(id) ON DELETE SET NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_revision_provenance_ingest_run_id "
            "ON revision_provenance (ingest_run_id)"
        ))
        await conn.execute(text(
            "ALTER TABLE IF EXISTS revision_provenance "
            "ADD COLUMN IF NOT EXISTS edit_id VARCHAR"
        ))
        # Partial unique constraint: at most one provenance row per
        # (run, edit) pair, allowing nulls for legacy / human-authored rows.
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_revision_provenance_run_edit "
            "ON revision_provenance (ingest_run_id, edit_id) "
            "WHERE edit_id IS NOT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE IF EXISTS ingest_runs "
            "ADD COLUMN IF NOT EXISTS applied_count INTEGER NOT NULL DEFAULT 0"
        ))
        await conn.execute(text(
            "ALTER TABLE IF EXISTS ingest_runs "
            "ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0"
        ))
        # MCP access toggle per user. Defaults to TRUE (everyone enabled).
        await conn.execute(text(
            "ALTER TABLE IF EXISTS users "
            "ADD COLUMN IF NOT EXISTS mcp_enabled BOOLEAN NOT NULL DEFAULT TRUE"
        ))
        # Reviewer-feedback fields on agent draft provenance (Phase 3.6).
        await conn.execute(text(
            "ALTER TABLE IF EXISTS revision_provenance "
            "ADD COLUMN IF NOT EXISTS reject_reason VARCHAR"
        ))
        await conn.execute(text(
            "ALTER TABLE IF EXISTS revision_provenance "
            "ADD COLUMN IF NOT EXISTS reject_notes TEXT"
        ))
        # One-time data migration: legacy agent users get deactivated and
        # their tokens revoked. The new model uses real-user tokens only.
        await conn.execute(text(
            "UPDATE users SET is_active = FALSE "
            "WHERE is_agent = TRUE AND is_active = TRUE"
        ))
        await conn.execute(text(
            "UPDATE api_tokens SET revoked_at = now() "
            "WHERE revoked_at IS NULL "
            "  AND user_id IN (SELECT id FROM users WHERE is_agent = TRUE)"
        ))
    # Bootstrap admin + categories + import vault
    async with SessionLocal() as session:
        admin = await ensure_default_admin(session)
        await ensure_categories(session)
        try:
            count = await import_disk_vault(session, admin)
            if count > 0:
                log.info("Bootstrap imported %d pages from disk", count)
        except Exception as e:
            log.exception("Bootstrap import failed: %s", e)
    yield
    await engine.dispose()


app = FastAPI(title="Acme Wiki", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(mcp_tokens.router, prefix="/api/mcp-tokens", tags=["mcp"])
app.include_router(mcp.router, prefix="/mcp", tags=["mcp"])
app.include_router(pages.router, prefix="/api/pages", tags=["pages"])
app.include_router(revisions.router, prefix="/api/revisions", tags=["revisions"])
app.include_router(comments.router, prefix="/api", tags=["comments"])
app.include_router(graph.router, prefix="/api/graph", tags=["graph"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["notifications"])
app.include_router(raw_sources.router, prefix="/api/raw", tags=["raw"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(ingest_runs.router, prefix="/api/ingest-runs", tags=["ingest-runs"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "auth_mode": settings.auth_mode}
