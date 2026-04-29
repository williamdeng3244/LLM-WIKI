"""FastAPI app entrypoint."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.core.db import Base, SessionLocal, engine
from app.routers import (
    agents, auth, chat, comments, graph, notifications,
    pages, revisions, search, users,
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
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
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
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(pages.router, prefix="/api/pages", tags=["pages"])
app.include_router(revisions.router, prefix="/api/revisions", tags=["revisions"])
app.include_router(comments.router, prefix="/api", tags=["comments"])
app.include_router(graph.router, prefix="/api/graph", tags=["graph"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["notifications"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "auth_mode": settings.auth_mode}
