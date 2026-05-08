"""Lint reports and issues.

A LintReport is one full pass over the wiki — Claude reads the directory
+ every page body + the agents.md playbook and emits structured findings.
LintIssue is the per-finding row. Reports are read-only artifacts; the
agent never auto-edits anything as a result of a lint.

Issues can be dismissed by an admin. Dismissed-not-deleted: rows persist
forever for audit, with `dismissed_by`, `dismissed_at`, and an optional
note. Acting on an issue (i.e. opening Suggest-edit on the affected page)
is tracked separately as `status=acted`.
"""
import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    DateTime, Enum, ForeignKey, Integer, JSON, String, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class LintReportStatus(str, enum.Enum):
    planning = "planning"
    done = "done"
    failed = "failed"


class LintIssueKind(str, enum.Enum):
    orphan = "orphan"
    broken_link = "broken_link"
    conflict = "conflict"
    stale = "stale"
    source_drift = "source_drift"
    other = "other"


class LintIssueSeverity(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"


class LintIssueStatus(str, enum.Enum):
    open = "open"
    dismissed = "dismissed"
    acted = "acted"


class LintReport(Base):
    __tablename__ = "lint_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    triggered_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    status: Mapped[LintReportStatus] = mapped_column(
        Enum(LintReportStatus), default=LintReportStatus.planning, index=True,
    )
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    provider_model: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    retrieval_strategy: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    total_issues: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )


class LintIssue(Base):
    __tablename__ = "lint_issues"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(
        ForeignKey("lint_reports.id", ondelete="CASCADE"), index=True,
    )
    kind: Mapped[LintIssueKind] = mapped_column(Enum(LintIssueKind), index=True)
    severity: Mapped[LintIssueSeverity] = mapped_column(
        Enum(LintIssueSeverity), default=LintIssueSeverity.medium, index=True,
    )
    title: Mapped[str] = mapped_column(String)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Wiki page paths the issue affects. JSON array.
    affected_paths: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    suggested_action: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    status: Mapped[LintIssueStatus] = mapped_column(
        Enum(LintIssueStatus), default=LintIssueStatus.open, index=True,
    )
    dismissed_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    dismissed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    dismiss_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
