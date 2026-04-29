"""Links (graph edges) and chunks (RAG units)."""
from typing import Optional
from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.config import settings
from app.core.db import Base


class Link(Base):
    """[[wiki-link]] edges between published pages."""
    __tablename__ = "links"
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    target_path: Mapped[str] = mapped_column(String, index=True)
    target_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("pages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    __table_args__ = (UniqueConstraint("source_id", "target_path", name="uq_link"),)


class Chunk(Base):
    """RAG chunks built from PUBLISHED pages only.

    Critical invariant: only published content lands here. Drafts never pollute
    the agent's grounding.
    """
    __tablename__ = "chunks"
    id: Mapped[int] = mapped_column(primary_key=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    chunk_type: Mapped[str] = mapped_column(String, default="prose")
    language: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    symbol: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    line_start: Mapped[int] = mapped_column(Integer, default=0)
    line_end: Mapped[int] = mapped_column(Integer, default=0)
    embedding: Mapped[Optional[list[float]]] = mapped_column(
        Vector(settings.embedding_dim), nullable=True
    )
