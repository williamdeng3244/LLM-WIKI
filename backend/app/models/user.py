"""User, role, and API token models.

Role hierarchy (highest first):
- admin: manages users, roles, categories; can lock pages; force-publish
- editor: scoped via CategoryEditor — reviews and publishes within their categories
- contributor: drafts pages, suggests edits, comments (default for employees)
- reader: read-only (default for contractors, optional for guests)

Agent users are real User rows owned by a human via owner_id, with is_agent=True.
This means agents inherit permissions from their owner but route through normal
authorization just like any other user.
"""
import enum
from datetime import datetime
from typing import Optional
from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.db import Base


class Role(str, enum.Enum):
    reader = "reader"
    contributor = "contributor"
    editor = "editor"
    admin = "admin"


# numeric ranks for comparisons
ROLE_RANK = {Role.reader: 0, Role.contributor: 1, Role.editor: 2, Role.admin: 3}


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String)
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.contributor)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # MCP接入开关:每个真人用户可独立控制是否允许通过MCP协议接入。
    # 默认开启;管理员可在用户管理界面单独关闭某个用户。
    # 全局开关settings.mcp_enabled优先级更高。
    mcp_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # Agent ownership: 历史遗留(已弃用)。新方案下agent通过MCP协议以
    # 真人身份接入,不再创建独立的agent user。保留这两列以兼容旧数据。
    is_agent: Mapped[bool] = mapped_column(Boolean, default=False)
    owner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    tokens = relationship("ApiToken", back_populates="user", cascade="all, delete-orphan")
    agents = relationship("User", foreign_keys=[owner_id], backref="owner", remote_side="User.id")


class ApiToken(Base):
    __tablename__ = "api_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String)  # human-readable description
    token_hash: Mapped[str] = mapped_column(String, unique=True, index=True)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="tokens")
