"""Pydantic schemas: API surface."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    FlagKind, FlagStatus, IngestRunStatus, IngestStatus,
    LintIssueKind, LintIssueSeverity, LintIssueStatus, LintReportStatus,
    PageStability, PageStatus, RevisionStatus, Role,
)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str
    role: Role
    is_agent: bool
    owner_id: Optional[int] = None
    mcp_enabled: bool = True
    is_active: bool = True
    preferences: dict = {}


class LoginRequest(BaseModel):
    """Static-admin local login (issue #5)."""
    email: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: UserOut


class AuthConfig(BaseModel):
    """Public auth-mode discovery shown on the login screen."""
    mode: str            # 'stub' | 'oidc'
    oidc_enabled: bool
    local_admin_enabled: bool


class BookmarkOut(BaseModel):
    id: int
    page_id: int
    page_path: str
    page_title: str
    created_at: datetime


class MovePageBody(BaseModel):
    """Request body for PATCH /api/pages/{old_path}/path — move (or
    rename) a page. The frontend typically supplies a destination
    folder; constructing `new_path` as `{folder}/{filename}` is the
    caller's job."""
    new_path: str


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
    # Phase 3.6: optional reviewer feedback when rejecting an
    # agent-authored draft. Stored on revision_provenance for later
    # consumption by ingest prompts.
    reject_reason: Optional[str] = None
    reject_notes: Optional[str] = None


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
    # 'sources' = chunk-level RAG (default, back-compat with all existing
    # callers including MCP / personal API tokens).
    # 'wiki' = Karpathy-style synthesis from full pages with 1-hop wikilink
    # expansion. Citations are page-level rather than chunk-level.
    mode: str = "sources"


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


class RawSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    description: Optional[str] = None
    original_filename: str
    mime_type: str
    size_bytes: int
    source_url: Optional[str] = None
    category: Optional[str] = None
    ingest_status: IngestStatus
    last_ingested_at: Optional[datetime] = None
    last_ingest_notes: Optional[str] = None
    uploaded_by_id: Optional[int] = None
    uploaded_at: datetime


class RawSourceUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    # Folder to move the source into; "" / null clears it (back to
    # top-level). Only applied when the field is explicitly present.
    category: Optional[str] = None


class RawSourceFromUrl(BaseModel):
    """Request body for POST /api/raw/url — import knowledge by URL."""
    url: str
    title: Optional[str] = None
    description: Optional[str] = None


class SourceRef(BaseModel):
    """One reference into a RawSource.

    Both `quote_or_excerpt` and `location` are optional — a ref is valid
    as long as at least one is set. (Pre-#9 the tool schema demanded a
    verbatim quote always; some models honored that, others emitted
    location-only refs. We accept both shapes on the read side so
    legacy DB rows from looser models don't 500. See issues #8/#9/#11.)
    """
    source_id: Optional[int] = None
    quote_or_excerpt: Optional[str] = None
    location: Optional[str] = None


class RevisionProvenanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    revision_id: int
    raw_source_id: Optional[int] = None
    ingest_run_id: Optional[int] = None
    edit_id: Optional[str] = None
    confidence: Optional[str] = None
    source_refs: Optional[list[SourceRef]] = None
    conflict_notes: Optional[str] = None
    edit_kind: Optional[str] = None
    is_agent_authored: bool
    reject_reason: Optional[str] = None
    reject_notes: Optional[str] = None


# ── Lint (Phase 4) ──────────────────────────────────────────────────────────

class LintIssueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    report_id: int
    kind: LintIssueKind
    severity: LintIssueSeverity
    title: str
    description: Optional[str] = None
    affected_paths: Optional[list[str]] = None
    suggested_action: Optional[str] = None
    status: LintIssueStatus
    dismissed_by_id: Optional[int] = None
    dismissed_at: Optional[datetime] = None
    dismiss_note: Optional[str] = None
    created_at: datetime


class LintReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    triggered_by_id: Optional[int] = None
    status: LintReportStatus
    summary: Optional[str] = None
    error: Optional[str] = None
    provider_model: Optional[str] = None
    retrieval_strategy: Optional[str] = None
    total_issues: int
    started_at: datetime
    finished_at: Optional[datetime] = None


class LintIssueDismiss(BaseModel):
    note: Optional[str] = None


class IngestRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    raw_source_id: int
    triggered_by_id: Optional[int] = None
    agent_user_id: Optional[int] = None
    status: IngestRunStatus
    plan_json: Optional[dict] = None
    approved_edit_indices: Optional[list[int]] = None
    retrieval_strategy: Optional[str] = None
    provider_model: Optional[str] = None
    summary: Optional[str] = None
    error: Optional[str] = None
    edits_count: int
    skipped_count: int
    conflict_count: int
    applied_count: int = 0
    failed_count: int = 0
    started_at: datetime
    planned_at: Optional[datetime] = None
    applied_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class PendingDraftOut(BaseModel):
    """Lightweight summary used by the duplicate-draft warning dialog."""
    revision_id: int
    page_path: str
    page_title: str
    status: RevisionStatus
    ingest_run_id: Optional[int] = None


class IngestApply(BaseModel):
    """Apply-phase request body: which edits the human approved."""
    approved_indices: Optional[list[int]] = None  # None = approve all


# ── Gated artifact publishing ──────────────────────────────────────────


class ArtifactCreateResponse(BaseModel):
    """Returned by both POST /api/artifacts and the MCP publish_artifact
    tool. `url` is the full public link (includes PUBLIC_BASE_URL); the
    frontend can also build it client-side from `short_id` if it prefers."""
    short_id: str
    url: str
    version: int


class ArtifactMeta(BaseModel):
    """Metadata projection of an Artifact row, plus a `views_7d` aggregate.
    Body bytes are never included here — fetch them from the viewer route."""
    model_config = ConfigDict(from_attributes=True)
    short_id: str
    name: str
    slug: str
    owner_id: int
    mime_type: str
    visibility: str
    current_version: int
    expires_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    views_7d: int = 0


class ArtifactListResponse(BaseModel):
    """Simple offset-paginated list. Spec § 6 names cursors but the
    existing routers all use offset-style; matching that convention."""
    items: list[ArtifactMeta]
    total: int
    limit: int
    offset: int


class ArtifactPatchRequest(BaseModel):
    """All fields optional — only provided ones are updated. Visibility
    is validated server-side against VALID_VISIBILITIES; ARTIFACTS_ALLOW_PUBLIC
    further gates whether `public` is accepted."""
    name: Optional[str] = Field(default=None, max_length=200)
    visibility: Optional[str] = Field(default=None, max_length=20)
    expires_at: Optional[datetime] = None


class ArtifactAccessLogEntry(BaseModel):
    """One row of the artifact's view history. user_email may be None
    if the viewer was anonymous (visibility=public) or the user has
    since been deleted (ON DELETE SET NULL on user_id)."""
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    version: int
    accessed_at: datetime
    ip: Optional[str] = None
    user_agent: Optional[str] = None


class ArtifactAccessLogResponse(BaseModel):
    items: list[ArtifactAccessLogEntry]
    total: int
    limit: int


# Resolve forward reference
DraftCreate.model_rebuild()
