"""IngestRun: one row per ingest invocation.

Splits the previous one-shot "click and create drafts" flow into two phases:

  planning  →  pending_review  →  applying  →  done
                       ↘ dismissed (user said no)
                       ↘ superseded (replaced by a newer run on this source)
  any phase →  failed (error)

The plan_json column holds Claude's structured tool output between the
plan and apply phases so we never re-call Claude after the user reviews.
This is also the source-level audit history (#4) — every ingest, every
draft created, with provider model and retrieval strategy preserved.
"""
import enum
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    DateTime, Enum, ForeignKey, Integer, JSON, String, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class IngestRunStatus(str, enum.Enum):
    planning = "planning"
    pending_review = "pending_review"
    applying = "applying"
    done = "done"
    dismissed = "dismissed"
    superseded = "superseded"
    failed = "failed"
    partially_failed = "partially_failed"


class IngestRun(Base):
    __tablename__ = "ingest_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    raw_source_id: Mapped[int] = mapped_column(
        ForeignKey("raw_sources.id", ondelete="CASCADE"), index=True,
    )
    triggered_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    agent_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    status: Mapped[IngestRunStatus] = mapped_column(
        Enum(IngestRunStatus), default=IngestRunStatus.planning, index=True,
    )

    # Cached Claude tool output between plan and apply. None if planning failed.
    plan_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    # Indices into plan_json["edits"] that the user approved at apply time.
    # None means "applied all" (legacy / convenience).
    approved_edit_indices: Mapped[Optional[list[int]]] = mapped_column(JSON, nullable=True)

    # Provenance / debugging metadata.
    retrieval_strategy: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    provider_model: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Counts (denormalized so list views don't have to join provenance).
    edits_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    conflict_count: Mapped[int] = mapped_column(Integer, default=0)
    # Apply-phase progress; resets on retry, recomputed from existing
    # provenance rows so they reflect actual state if the worker dies.
    applied_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)

    # Timing.
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    planned_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    applied_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
