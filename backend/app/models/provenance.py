"""Per-revision agent provenance.

Sibling table to `revisions`. Populated only when an agent (ingest task or
similar) creates a draft. Captures the source-grounding reviewers need
without modifying the existing revisions table.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class RevisionProvenance(Base):
    __tablename__ = "revision_provenance"

    id: Mapped[int] = mapped_column(primary_key=True)
    revision_id: Mapped[int] = mapped_column(
        ForeignKey("revisions.id", ondelete="CASCADE"), unique=True, index=True,
    )
    # The raw source that triggered this draft (for display + audit).
    raw_source_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("raw_sources.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    # The IngestRun that produced this draft. Lets us look up every draft
    # a single run created when displaying history / approval state.
    ingest_run_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("ingest_runs.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    # Stable identifier for the planned edit within its IngestRun. Generated
    # at planning time and stored in plan_json["edits"][i]["edit_id"]. The
    # apply phase uses this to skip edits that already have a draft, making
    # retries idempotent. NULL on rows from before this column existed.
    edit_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Reviewer-feedback fields (Phase 3.6). Populated when a reviewer
    # rejects this revision; consumed later by future ingest prompts to
    # avoid repeating the same mistake category. Single-dropdown reason
    # plus optional free-text. Both nullable.
    reject_reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    reject_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # "high" | "medium" | "low" — agent self-assessment, surfaced in review.
    confidence: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # List[{source_id, quote_or_excerpt, location}].
    source_refs: Mapped[Optional[list[dict]]] = mapped_column(JSON, nullable=True)
    # Free-form notes about contradictions found vs. existing claims.
    conflict_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # "edit_existing" | "create_new" | "source_summary" | "conflict".
    edit_kind: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_agent_authored: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
