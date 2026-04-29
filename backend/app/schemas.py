"""Pydantic schemas: API surface."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    FlagKind, FlagStatus, PageStability, PageStatus,
    RevisionStatus, Role,
)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str
    role: Role
    is_agent: bool
    owner_id: Optional[int] = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    slug: str
    name: str
    description: Optional[str] = None


class PageSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    path: str
    title: str
    category_id: Optional[int]
    stability: PageStability
    status: PageStatus
    tags: list[str]


class PageOut(PageSummary):
    body: Optional[str] = None  # latest published body
    current_revision_id: Optional[int] = None
    updated_at: datetime


class RevisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    page_id: int
    parent_revision_id: Optional[int]
    title: str
    body: str
    tags: list[str]
    status: RevisionStatus
    author_id: int
    rationale: Optional[str]
    reviewer_id: Optional[int]
    review_comment: Optional[str]
    reviewed_at: Optional[datetime]
    created_at: datetime


class DraftCreate(BaseModel):
    """Create a draft. Either page_path or new page params required."""
    page_path: Optional[str] = None  # for edits
    new_page: Optional["NewPageSpec"] = None  # for new-page proposals
    title: str
    body: str
    tags: list[str] = []
    rationale: Optional[str] = None


class NewPageSpec(BaseModel):
    path: str
    category_slug: Optional[str] = None
    stability: PageStability = PageStability.stable


class ReviewBody(BaseModel):
    decision: str  # 'accept' | 'reject' | 'request_changes'
    comment: Optional[str] = None


class CommentCreate(BaseModel):
    body: str
    revision_id: Optional[int] = None
    anchor: Optional[str] = None


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    page_id: int
    revision_id: Optional[int]
    author_id: int
    body: str
    anchor: Optional[str]
    created_at: datetime


class FlagCreate(BaseModel):
    kind: FlagKind
    body: str


class FlagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    page_id: int
    kind: FlagKind
    body: str
    status: FlagStatus
    raised_by_id: int
    resolved_by_id: Optional[int]
    created_at: datetime
    resolved_at: Optional[datetime]


class GraphNode(BaseModel):
    id: str  # page.path
    title: str
    category: Optional[str]
    tags: list[str]
    backlinks: int = 0


class GraphEdge(BaseModel):
    source: str
    target: str


class GraphData(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class SearchResult(BaseModel):
    page_id: int
    page_path: str
    page_title: str
    chunk_id: int
    chunk_type: str
    snippet: str
    line_start: int
    line_end: int
    score: float


class Citation(BaseModel):
    n: int
    page_path: str
    page_title: str
    chunk_id: int
    chunk_type: str
    snippet: str
    language: Optional[str] = None
    symbol: Optional[str] = None
    line_start: int
    line_end: int


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    citations: list[Citation]


class TokenCreate(BaseModel):
    name: str
    expires_in_days: Optional[int] = None  # None = no expiry


class TokenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    last_used_at: Optional[datetime]
    expires_at: Optional[datetime]
    created_at: datetime
    revoked_at: Optional[datetime]


class TokenCreated(TokenOut):
    """Returned only on creation. The raw token is shown ONCE."""
    raw_token: str


class AgentCreate(BaseModel):
    name: str  # e.g. "My research assistant"


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    body: str
    link: Optional[str]
    is_read: bool
    created_at: datetime


# Resolve forward reference
DraftCreate.model_rebuild()
