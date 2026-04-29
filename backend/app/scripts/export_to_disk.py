"""Export all published pages to a target directory as markdown files.

Used by scripts/git-export.sh to produce a git-trackable snapshot of the wiki.
Each export rewrites the entire target directory to match current published state.

Usage:
    python -m app.scripts.export_to_disk /path/to/target
"""
import asyncio
import sys
import shutil
from pathlib import Path

import frontmatter
from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import Page, Revision


async def export(target_dir: str) -> int:
    target = Path(target_dir)
    target.mkdir(parents=True, exist_ok=True)

    # Wipe everything except .git
    for child in target.iterdir():
        if child.name == ".git":
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()

    count = 0
    async with SessionLocal() as session:
        pages = (await session.execute(
            select(Page).where(Page.current_revision_id.is_not(None))
            .order_by(Page.path)
        )).scalars().all()
        for page in pages:
            rev = await session.get(Revision, page.current_revision_id)
            if not rev:
                continue
            rel = page.path if page.path.endswith(".md") else page.path + ".md"
            out = target / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            post = frontmatter.Post(
                rev.body, title=rev.title, tags=list(rev.tags or []),
            )
            out.write_text(frontmatter.dumps(post), encoding="utf-8")
            count += 1
    return count


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "./vault-export"
    n = asyncio.run(export(target))
    print(f"Exported {n} pages to {target}")


if __name__ == "__main__":
    main()
