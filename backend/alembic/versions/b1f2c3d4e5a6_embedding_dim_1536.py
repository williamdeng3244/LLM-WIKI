"""embedding dim 384 -> 1536 (switch to OpenAI embeddings API)

Embeddings moved from the local sentence-transformers model
(all-MiniLM-L6-v2, 384-dim) to the OpenAI-compatible embeddings API
(text-embedding-3-small, 1536-dim). The old 384-dim vectors are
incompatible, so this resets the column to NULL and re-types it; run
`python -m app.scripts.backfill_embeddings` afterwards to repopulate.

There is no ANN index on chunks.embedding (only ix_chunks_page_id), so
the column can be re-typed directly without dropping an index first.

Revision ID: b1f2c3d4e5a6
Revises: abb6aa863be3
Create Date: 2026-06-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b1f2c3d4e5a6'
down_revision: Union[str, Sequence[str], None] = 'abb6aa863be3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Wipe the old 384-dim vectors first; the dim change is otherwise
    # rejected for any non-NULL row. Content stays — only the embeddings
    # are dropped, to be rebuilt by scripts/backfill_embeddings.
    op.execute("UPDATE chunks SET embedding = NULL")
    op.execute("ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(1536)")


def downgrade() -> None:
    op.execute("UPDATE chunks SET embedding = NULL")
    op.execute("ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(384)")
