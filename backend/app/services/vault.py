"""Markdown vault: read and write files on disk.

Disk is the export target / mirror, not the source of truth — the database is.
This module exists to:
1. Bootstrap initial pages from existing markdown vaults
2. Export current published state to markdown for git mirroring
3. Optionally watch disk for external edits (future)
"""
import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

import frontmatter

from app.core.config import settings


@dataclass
class VaultFile:
    path: str
    title: str
    tags: list[str]
    body: str
    file_hash: str

    @property
    def absolute_path(self) -> Path:
        return settings.vault_path / self.path


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _derive_title(rel_path: str, body: str) -> str:
    for line in body.splitlines():
        s = line.strip()
        if s.startswith("# "):
            return s[2:].strip()
    return Path(rel_path).stem.replace("-", " ").replace("_", " ").title()


def read_file(rel_path: str) -> Optional[VaultFile]:
    abs_path = settings.vault_path / rel_path
    if not abs_path.exists() or not abs_path.is_file():
        return None
    raw = abs_path.read_text(encoding="utf-8")
    post = frontmatter.loads(raw)
    body = post.content
    meta = post.metadata or {}
    title = meta.get("title") or _derive_title(rel_path, body)
    tags = meta.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    return VaultFile(
        path=rel_path, title=title, tags=list(tags),
        body=body, file_hash=_hash(raw),
    )


def list_files() -> Iterator[str]:
    root = settings.vault_path
    if not root.exists():
        return
    for p in sorted(root.rglob("*.md")):
        yield str(p.relative_to(root)).replace("\\", "/")


def write_file(rel_path: str, title: str, tags: list[str], body: str) -> VaultFile:
    abs_path = settings.vault_path / rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    post = frontmatter.Post(body, title=title, tags=tags)
    raw = frontmatter.dumps(post)
    abs_path.write_text(raw, encoding="utf-8")
    result = read_file(rel_path)
    assert result is not None
    return result
