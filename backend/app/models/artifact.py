"""Gated artifact publishing — sibling concept to Page, not nested under it.

An Artifact is a stand-alone HTML / Markdown / Text payload published behind
the wiki's auth boundary, addressable at /a/<short_id>. Modeled after
display.dev and Flowershow share links. Unlike a Page it has no review
queue, no revision graph, no backlinks, no search index — it's just
"here is a thing, who can see it, when does it expire."

Deviation from spec § 4: the spec describes UUID PKs and `default=utcnow`.
The rest of the codebase uses `int` PKs and `DateTime(timezone=True) +
server_default=func.now()` (see `models/page.py`); we follow the codebase
and rely on `short_id` (an 8–10-char URL-safe slug) as the externally
visible identifier.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    DateTime, ForeignKey, Integer, String, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


# Visibility kept as plain String (not PG enum) so adding values later is a
# zero-downtime change. v1 set:
#   "company"  — any authenticated wiki user can view
#   "specific" — only listed user_ids (schema-only for v1; UI not wired)
#   "public"   — no auth required; gated behind ARTIFACTS_ALLOW_PUBLIC
VISIBILITY_COMPANY = "company"
VISIBILITY_SPECIFIC = "specific"
VISIBILITY_PUBLIC = "public"
VALID_VISIBILITIES = frozenset({VISIBILITY_COMPANY, VISIBILITY_SPECIFIC, VISIBILITY_PUBLIC})


# MIME types accepted by the publish endpoint. HTML is rendered inside a
# sandboxed iframe; markdown is server-rendered to safe HTML; plain text
# is wrapped in `<pre>`. Anything else returns 415.
ALLOWED_MIME_TYPES = frozenset({"text/html", "text/markdown", "text/plain"})


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    # The visible URL is /a/<short_id>-<kebab-name> but routing keys
    # only on short_id; the trailing slug is decorative.
    short_id: Mapped[str] = mapped_column(String(16), unique=True, index=True)

    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(200))

    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True,
    )

    # text/html | text/markdown | text/plain
    mime_type: Mapped[str] = mapped_column(String(50))
    visibility: Mapped[str] = mapped_column(String(20), default=VISIBILITY_COMPANY)

    current_version: Mapped[int] = mapped_column(Integer, default=1)
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    # Soft delete: the viewer route returns a generic 404 once this is set,
    # so existence is not leakable post-deletion.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )

    owner = relationship("User", foreign_keys=[owner_id])
    versions = relationship(
        "ArtifactVersion", back_populates="artifact",
        cascade="all, delete-orphan",
        order_by="ArtifactVersion.version",
    )


class ArtifactVersion(Base):
    """Each upload of a new body creates a new version row. The Artifact
    table only tracks `current_version`; older versions remain accessible
    via `?v=N` in the viewer."""
    __tablename__ = "artifact_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    artifact_id: Mapped[int] = mapped_column(
        ForeignKey("artifacts.id", ondelete="CASCADE"), index=True,
    )
    version: Mapped[int] = mapped_column(Integer)

    content_hash: Mapped[str] = mapped_column(String(64))  # sha256 hex
    body_size: Mapped[int] = mapped_column(Integer)
    # Path relative to settings.artifacts_storage_dir. v1 is on-disk; the
    # narrow ArtifactStorage interface lets a future commit swap S3 in
    # without touching this column's shape.
    storage_path: Mapped[str] = mapped_column(String(500))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )

    artifact = relationship("Artifact", back_populates="versions")

    __table_args__ = (
        UniqueConstraint("artifact_id", "version", name="uq_artifact_version"),
    )


class ArtifactAccessLog(Base):
    """Append-only log of /a/<short_id> views. Feeds the owner-visible
    "who opened this, when" list in the ArtifactsPanel. Stores user_id of
    the *viewer*, not the artifact owner — that's the security-relevant
    distinction noted in spec § 10."""
    __tablename__ = "artifact_access_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    artifact_id: Mapped[int] = mapped_column(
        ForeignKey("artifacts.id", ondelete="CASCADE"), index=True,
    )
    # Nullable because a public-visibility artifact can be viewed
    # anonymously when ARTIFACTS_ALLOW_PUBLIC=true.
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    version: Mapped[int] = mapped_column(Integer)
    accessed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True,
    )
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
