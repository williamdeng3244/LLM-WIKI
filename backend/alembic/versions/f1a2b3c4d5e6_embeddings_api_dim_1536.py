"""embeddings: switch to API model — widen chunks.embedding 384 -> 1536

Revision ID: f1a2b3c4d5e6
Revises: abb6aa863be3
Create Date: 2026-06-18

The wiki moved from the local sentence-transformers model (all-MiniLM-L6-v2,
384-dim) to an external OpenAI-compatible embeddings API (text-embedding-3-small,
1536-dim by default — see app/core/config.py EMBEDDING_DIM). The old 384-dim
vectors are incompatible with the new model, so this drops + recreates the
column at the new width.

Fresh installs never need this migration: the live schema is built from the ORM
via Base.metadata.create_all (app/main.py), which already reads
settings.embedding_dim. This migration is for databases that already hold
384-dim vectors. After `alembic upgrade head`, re-embed every page with:

    python -m app.scripts.backfill_embeddings

If you set EMBEDDING_DIM to something other than 1536 (a different model),
change NEW_DIM below to match before running.
"""
from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy

# revision identifiers, used by Alembic.
revision = "f1a2b3c4d5e6"
down_revision = "abb6aa863be3"
branch_labels = None
depends_on = None

NEW_DIM = 1536
OLD_DIM = 384


def upgrade() -> None:
    # Drop + recreate rather than ALTER ... TYPE: a plain type change would fail
    # on existing 384-dim rows, and those vectors are unusable at the new
    # dimension anyway (re-embed via app.scripts.backfill_embeddings).
    op.drop_column("chunks", "embedding")
    op.add_column(
        "chunks",
        sa.Column("embedding", pgvector.sqlalchemy.Vector(NEW_DIM), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chunks", "embedding")
    op.add_column(
        "chunks",
        sa.Column("embedding", pgvector.sqlalchemy.Vector(OLD_DIM), nullable=True),
    )
