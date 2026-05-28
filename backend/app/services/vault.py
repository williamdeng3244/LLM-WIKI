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


def read_file(rel_path: str, base: Optional[Path] = None) -> Optional[VaultFile]:
    abs_path = (base or settings.vault_path) / rel_path
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


def list_files(base: Optional[Path] = None) -> Iterator[str]:
    root = base or settings.vault_path
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


def delete_file(rel_path: str) -> bool:
    """Remove the page's .md from disk. Idempotent — returns True if it
    existed and was deleted, False if it didn't exist (so a delete that
    races with a manual rm doesn't fail the API call).

    Empty parent dirs are intentionally NOT pruned: a user could have
    custom-folder placeholders we don't want to silently delete."""
    abs_path = settings.vault_path / rel_path
    try:
        abs_path.unlink()
        return True
    except FileNotFoundError:
        return False


def move_file(old_rel: str, new_rel: str) -> bool:
    """Move/rename the page's .md on disk. Creates the destination's
    parent dir if missing. Returns True if a file was moved, False if
    the source didn't exist (so a move that races with a manual rm
    doesn't fail the API call — the DB row is what we care about).

    Refuses to silently overwrite an existing destination; that case
    should be caught at the route layer before we touch disk."""
    src = settings.vault_path / old_rel
    dst = settings.vault_path / new_rel
    if not src.exists():
        return False
    if dst.exists() and src.resolve() != dst.resolve():
        raise FileExistsError(f"destination already exists: {new_rel}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.replace(dst)
    return True
