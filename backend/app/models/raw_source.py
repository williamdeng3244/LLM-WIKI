"""Raw sources: immutable input documents (PDFs, articles, notes, …).

Karpathy's LLM Wiki distinguishes the *raw* layer (the ground-truth sources
the agent reads) from the *wiki* layer (synthesized pages the agent writes
across many ingest passes). This model is the storage spine for the raw
layer; the actual file bytes live on disk under settings.raw_path.
"""
import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class IngestStatus(str, enum.Enum):
    pending = "pending"      # uploaded, never ingested
    ingesting = "ingesting"  # task running
    done = "done"            # last ingest succeeded
    failed = "failed"        # last ingest raised


class RawSource(Base):
    __tablename__ = "raw_sources"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Human-facing display name; defaults to original_filename on upload.
    title: Mapped[str] = mapped_column(String, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # File details. disk_filename is a server-controlled name (UUID-based)
    # under settings.raw_path so we never have to worry about collisions or
    # path-traversal in the original_filename the user uploaded.
    original_filename: Mapped[str] = mapped_column(String)
    disk_filename: Mapped[str] = mapped_column(String, unique=True)
    mime_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer)

    ingest_status: Mapped[IngestStatus] = mapped_column(
        Enum(IngestStatus), default=IngestStatus.pending, index=True,
    )
    last_ingested_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    last_ingest_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    uploaded_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
