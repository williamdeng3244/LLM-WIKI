"""Pluggable storage for artifact bodies.

v1 backs to local disk. The interface is narrow enough — three methods —
that a future S3 / GCS / MinIO implementation can drop in without touching
the routers. The `storage_path` stored in `artifact_versions` is opaque
to callers; only this module is allowed to translate it to a real on-disk
path.

Layout on disk: `<ARTIFACTS_STORAGE_DIR>/<short_id>/v<version>.bin`
- one directory per artifact, one file per version
- `.bin` extension because the body can be HTML/Markdown/plain-text; the
  authoritative MIME type lives in the DB
- nothing about ordering or sorting depends on filesystem listing
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from app.core.config import settings


class ArtifactStorage:
    """File-backed body storage. Methods are async to match the rest of
    the codebase's I/O surface, but we wrap blocking I/O in
    `asyncio.to_thread` rather than pulling in `aiofiles` — no new
    dependency, same effective behavior at our scale (≤10 MB bodies)."""

    def __init__(self, base_dir: Path):
        self.base = Path(base_dir)
        # Create the root once on construction. The `parents=True` makes
        # this safe under fresh installs where /data/artifacts didn't
        # exist; `exist_ok=True` makes it safe under restarts.
        self.base.mkdir(parents=True, exist_ok=True)

    # ── Path helpers ───────────────────────────────────────────────────

    def _path_for(self, short_id: str, version: int) -> Path:
        return self.base / short_id / f"v{version}.bin"

    def _rel(self, abs_path: Path) -> str:
        # Always store a forward-slash-style relative path in the DB so a
        # future S3 implementation can use it as a key without translation.
        return abs_path.relative_to(self.base).as_posix()

    # ── Public surface ─────────────────────────────────────────────────

    async def save(self, short_id: str, version: int, body: bytes) -> str:
        """Persist `body` and return the relative storage path to record
        in `artifact_versions.storage_path`. Existing files at the same
        (short_id, version) coordinate are overwritten — but the caller
        enforces version uniqueness via the DB unique constraint, so this
        is normally a write-once path."""
        target = self._path_for(short_id, version)

        def _write() -> None:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)

        await asyncio.to_thread(_write)
        return self._rel(target)

    async def load(self, storage_path: str) -> bytes:
        full = self.base / storage_path
        return await asyncio.to_thread(full.read_bytes)

    async def delete(self, storage_path: str) -> None:
        """Delete a single version's bytes. The artifact-level soft delete
        intentionally does NOT call this — soft-deleted artifacts keep
        their bytes so an admin can recover. Hard delete (admin route)
        will call this once per version."""
        full = self.base / storage_path

        def _unlink() -> None:
            full.unlink(missing_ok=True)
            # Best-effort prune empty parent dir; tolerate races.
            try:
                full.parent.rmdir()
            except (OSError, FileNotFoundError):
                pass

        await asyncio.to_thread(_unlink)


# ── Singleton accessor ─────────────────────────────────────────────────

_storage: ArtifactStorage | None = None


def get_storage() -> ArtifactStorage:
    """Lazy singleton so we don't run `mkdir` at import time (which would
    fight pytest's tmp paths). FastAPI dependency-injects this through
    the router."""
    global _storage
    if _storage is None:
        _storage = ArtifactStorage(settings.artifacts_storage_dir)
    return _storage
