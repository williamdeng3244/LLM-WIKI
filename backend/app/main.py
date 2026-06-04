"""FastAPI app entrypoint."""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.core.db import Base, SessionLocal, engine
from app.routers import (
    admin, artifact_viewer, artifacts, auth, bookmarks, chat, comments,
    graph, ingest_runs, mcp, mcp_tokens, notifications, pages, raw_sources,
    revisions, search, users,
)
from app.services.bootstrap import (
    ensure_default_admin, ensure_categories,
    import_disk_vault, import_examples_if_enabled,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger(__name__)


async def _wait_for_db(max_attempts: int = 30, base_delay: float = 1.0) -> None:
    """Bounded exponential-backoff probe of the DB.

    Earlier the lifespan tried to connect exactly once — any transient
    DNS / not-yet-ready / network failure killed the container forever
    (see issue #1). Combined with `restart: unless-stopped` in compose,
    this gives clean self-recovery for the usual race-with-postgres-init.
    Ceiling is ~3 minutes (30 attempts, backoff capped at 10s).
    """
    for attempt in range(1, max_attempts + 1):
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            if attempt > 1:
                log.info("DB reachable after %d attempt(s)", attempt)
            return
        except Exception as e:  # noqa: BLE001
            if attempt == max_attempts:
                log.error("DB unreachable after %d attempts; giving up", attempt)
                raise
            delay = min(base_delay * (2 ** (attempt - 1)), 10.0)
            log.warning("DB not ready (attempt %d/%d: %s); retrying in %.1fs",
                        attempt, max_attempts, type(e).__name__, delay)
            await asyncio.sleep(delay)


def _validate_auth_config() -> None:
    """Fail-fast if AUTH_MODE=oidc but the OIDC env vars are missing,
    so deployments don't silently 401 every request (issue #5).
    A configured static admin alone is enough to bypass the OIDC check —
    that's the documented break-glass account."""
    if settings.auth_mode != "oidc":
        return
    has_oidc = bool(settings.oidc_issuer and settings.oidc_client_id and settings.oidc_client_secret)
    has_local_admin = bool(settings.admin_email and settings.admin_password)
    if not (has_oidc or has_local_admin):
        raise RuntimeError(
            "AUTH_MODE=oidc requires either OIDC_ISSUER + OIDC_CLIENT_ID + "
            "OIDC_CLIENT_SECRET to be set, or a static fallback admin via "
            "ADMIN_EMAIL + ADMIN_PASSWORD. Neither was provided — refusing "
            "to start because every request would 401."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _validate_auth_config()

    # Wait for the DB to be reachable before doing any DDL. Necessary so
    # transient infra issues (recreated network, slow PG init) don't
    # permanently kill the container.
    await _wait_for_db()

    # Schema setup. PROD TODO: replace with Alembic.
    # Enum extensions must run in their own transaction in older Postgres
    # versions; do them first via AUTOCOMMIT, before any other DDL.
    raw = engine.execution_options(isolation_level="AUTOCOMMIT")
    async with raw.connect() as conn:
        # Only extend the enum if it already exists. On a fresh DB the
        # type is created by Base.metadata.create_all below (with all
        # values), so this ALTER would just log a scary traceback for
        # nothing — see issue #5.
        exists = (await conn.execute(text(
            "SELECT 1 FROM pg_type WHERE typname = 'ingestrunstatus'"
        ))).scalar()
        if exists:
            await conn.execute(text(
                "ALTER TYPE ingestrunstatus ADD VALUE IF NOT EXISTS 'partially_failed'"
            ))

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
        # Per-user UI preferences (custom hotkeys, etc.) as a JSON blob.
        await conn.execute(text(
            "ALTER TABLE IF EXISTS users "
            "ADD COLUMN IF NOT EXISTS preferences JSON NOT NULL DEFAULT '{}'"
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
        # URL-ingest (issue #6): track the originating URL so the UI can
        # show "open original" and a future re-fetch worker can detect
        # content drift.
        await conn.execute(text(
            "ALTER TABLE IF EXISTS raw_sources "
            "ADD COLUMN IF NOT EXISTS source_url TEXT"
        ))
        # Issue #12 backfill: pre-fix, review_requested notifications
        # were never cleared when the revision left the `proposed`
        # state. Mark all such stale rows as read so existing installs
        # don't carry a stuck badge count. Idempotent — once the
        # `review()` path keeps the table clean, this update finds 0
        # rows on subsequent boots.
        await conn.execute(text(
            "UPDATE notifications "
            "SET is_read = TRUE "
            "WHERE kind = 'review_requested' "
            "  AND is_read = FALSE "
            "  AND EXISTS (SELECT 1 FROM revisions r "
            "              WHERE r.status <> 'proposed' "
            "                AND notifications.link = '/review/' || r.id)"
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
        # Artifact visibility model v1 → v2: "company" became "wiki" (any
        # signed-in user) and the never-wired "specific" collapses to the
        # most-restrictive "private" (owner-only). Idempotent: once renamed,
        # subsequent boots match 0 rows.
        await conn.execute(text(
            "UPDATE artifacts SET visibility = 'wiki' WHERE visibility = 'company'"
        ))
        await conn.execute(text(
            "UPDATE artifacts SET visibility = 'private' WHERE visibility = 'specific'"
        ))
        # Directory-bundle artifacts (a zip served at /a/<sid>/<path>).
        await conn.execute(text(
            "ALTER TABLE IF EXISTS artifacts "
            "ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN NOT NULL DEFAULT FALSE"
        ))
    # Bootstrap admin + categories + import vault
    async with SessionLocal() as session:
        admin = await ensure_default_admin(session)
        await ensure_categories(session)
        try:
            count = await import_disk_vault(session, admin)
            if count > 0:
                log.info("Bootstrap imported %d pages from disk", count)
            # Opt-in: SEED_EXAMPLES=true ingests the bundled demo pages
            # from /examples/vault. Default is off so fresh installs
            # start empty (see issue #7).
            ex_count = await import_examples_if_enabled(session, admin)
            if ex_count > 0:
                log.info("Bootstrap imported %d demo pages from examples", ex_count)
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
app.include_router(bookmarks.router, prefix="/api/bookmarks", tags=["bookmarks"])
app.include_router(artifacts.router, prefix="/api/artifacts", tags=["artifacts"])
# The viewer mounts at the app root (NOT under /api) — `/a/<short_id>`
# is the public, user-facing share-link surface. See spec § 7.
app.include_router(artifact_viewer.router, prefix="/a", tags=["artifacts"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "auth_mode": settings.auth_mode}
