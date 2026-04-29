"""Flags: 'this page is wrong', 'this is outdated', etc."""
import enum
from datetime import datetime
from typing import Optional
from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.db import Base


class FlagKind(str, enum.Enum):
    incorrect = "incorrect"
    outdated = "outdated"
    needs_source = "needs_source"
    duplicate = "duplicate"
    other = "other"


class FlagStatus(str, enum.Enum):
    open = "open"
    resolved = "resolved"
    dismissed = "dismissed"


class Flag(Base):
    __tablename__ = "flags"
    id: Mapped[int] = mapped_column(primary_key=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    kind: Mapped[FlagKind] = mapped_column(Enum(FlagKind))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[FlagStatus] = mapped_column(Enum(FlagStatus), default=FlagStatus.open, index=True)
    raised_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    resolved_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
