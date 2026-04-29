"""Page and category models.

Stability levels (per-page):
- open: drafts auto-publish on submit (low-stakes pages, brainstorming)
- stable: drafts require editor review (default)
- locked: only admins can publish; double-review for changes
"""
import enum
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    DateTime, Enum, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.db import Base


class PageStability(str, enum.Enum):
    open = "open"
    stable = "stable"
    locked = "locked"


class PageStatus(str, enum.Enum):
    active = "active"
    archived = "archived"


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class CategoryEditor(Base):
    """Editor role is scoped per category."""
    __tablename__ = "category_editors"
    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    __table_args__ = (UniqueConstraint("category_id", "user_id", name="uq_cat_editor"),)


class Page(Base):
    __tablename__ = "pages"

    id: Mapped[int] = mapped_column(primary_key=True)
    path: Mapped[str] = mapped_column(String, unique=True, index=True)  # e.g. "engineering/auth"
    title: Mapped[str] = mapped_column(String)
    category_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    stability: Mapped[PageStability] = mapped_column(Enum(PageStability), default=PageStability.stable)
    status: Mapped[PageStatus] = mapped_column(Enum(PageStatus), default=PageStatus.active)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)

    # The currently published revision. NULL means page exists but has no published version yet.
    current_revision_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("revisions.id", ondelete="SET NULL", use_alter=True, name="fk_pages_current_rev"),
        nullable=True,
    )

    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    category = relationship("Category")
    revisions = relationship(
        "Revision", back_populates="page",
        foreign_keys="Revision.page_id", cascade="all, delete-orphan",
    )
    current_revision = relationship(
        "Revision", foreign_keys=[current_revision_id], post_update=True
    )
