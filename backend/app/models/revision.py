"""Revision: every edit creates a new row.

Lifecycle:
- draft: being worked on by author (private to author)
- proposed: submitted for review (visible to category editors and admins)
- accepted: published, replaces page.current_revision_id
- rejected: closed without publish
- superseded: was once accepted, then a newer revision became current
"""
import enum
from datetime import datetime
from typing import Optional
from sqlalchemy import DateTime, Enum, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.db import Base


class RevisionStatus(str, enum.Enum):
    draft = "draft"
    proposed = "proposed"
    accepted = "accepted"
    rejected = "rejected"
    superseded = "superseded"


class Revision(Base):
    __tablename__ = "revisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    page_id: Mapped[int] = mapped_column(
        ForeignKey("pages.id", ondelete="CASCADE"),
        index=True,
    )
    parent_revision_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("revisions.id", ondelete="SET NULL"), nullable=True
    )

    # Snapshot of page metadata at the time of this revision
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)

    status: Mapped[RevisionStatus] = mapped_column(
        Enum(RevisionStatus), default=RevisionStatus.draft, index=True
    )

    # Authorship
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    rationale: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Review
    reviewer_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    review_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    page = relationship("Page", back_populates="revisions", foreign_keys=[page_id])
    author = relationship("User", foreign_keys=[author_id])
    reviewer = relationship("User", foreign_keys=[reviewer_id])


class ReviewAction(str, enum.Enum):
    """Used in the schema layer for review POSTs."""
    accept = "accept"
    reject = "reject"
    request_changes = "request_changes"
