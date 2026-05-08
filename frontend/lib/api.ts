/**
 * API client for the wiki backend.
 *
 * In stub auth mode, identity comes from localStorage (set via dev-login or
 * the role switcher). In oidc mode, it comes from a session JWT cookie.
 */
const API_BASE = '/api';

// ── Types ────────────────────────────────────────────────────────────
export type Role = 'reader' | 'contributor' | 'editor' | 'admin';
export type Stability = 'open' | 'stable' | 'locked';
export type RevisionStatus = 'draft' | 'proposed' | 'accepted' | 'rejected' | 'superseded';
export type FlagKind = 'incorrect' | 'outdated' | 'needs_source' | 'duplicate' | 'other';
export type FlagStatus = 'open' | 'resolved' | 'dismissed';

export type User = {
  id: number; email: string; name: string; role: Role;
  is_agent: boolean; owner_id: number | null;
  mcp_enabled?: boolean; is_active?: boolean;
};
export type Category = {
  id: number; slug: string; name: string; description: string | null;
};
export type PageSummary = {
  id: number; path: string; title: string; category_id: number | null;
  stability: Stability; status: 'active' | 'archived'; tags: string[];
};
export type Page = PageSummary & {
  body: string; current_revision_id: number | null; updated_at: string;
};
export type Revision = {
  id: number; page_id: number; parent_revision_id: number | null;
  title: string; body: string; tags: string[]; status: RevisionStatus;
  author_id: number; rationale: string | null; reviewer_id: number | null;
  review_comment: string | null; reviewed_at: string | null; created_at: string;
};
export type Comment = {
  id: number; page_id: number; revision_id: number | null;
  author_id: number; body: string; anchor: string | null; created_at: string;
};
export type Flag = {
  id: number; page_id: number; kind: FlagKind; body: string; status: FlagStatus;
  raised_by_id: number; resolved_by_id: number | null;
  created_at: string; resolved_at: string | null;
};
export type GraphNode = {
  id: string; title: string; category: string | null;
  tags: string[]; backlinks: number;
};
export type GraphEdge = { source: string; target: string };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };
export type Citation = {
  n: number; page_path: string; page_title: string; chunk_id: number;
  chunk_type: string; snippet: string; language: string | null;
  symbol: string | null; line_start: number; line_end: number;
};
export type ChatResponse = { answer: string; citations: Citation[] };
export type Notification = {
  id: number; kind: string; body: string; link: string | null;
  is_read: boolean; created_at: string;
};
export type SearchResult = {
  page_id: number; page_path: string; page_title: string;
  chunk_id: number; chunk_type: string; snippet: string;
  line_start: number; line_end: number; score: number;
};

export type IngestStatus = 'pending' | 'ingesting' | 'done' | 'failed';

export type LintReportStatus = 'planning' | 'done' | 'failed';
export type LintIssueKind = 'orphan' | 'broken_link' | 'conflict' | 'stale' | 'source_drift' | 'other';
export type LintIssueSeverity = 'low' | 'medium' | 'high';
export type LintIssueStatus = 'open' | 'dismissed' | 'acted';

export type LintReport = {
  id: number;
  triggered_by_id: number | null;
  status: LintReportStatus;
  summary: string | null;
  error: string | null;
  provider_model: string | null;
  retrieval_strategy: string | null;
  total_issues: number;
  started_at: string;
  finished_at: string | null;
};

export type LintIssue = {
  id: number;
  report_id: number;
  kind: LintIssueKind;
  severity: LintIssueSeverity;
  title: string;
  description: string | null;
  affected_paths: string[] | null;
  suggested_action: string | null;
  status: LintIssueStatus;
  dismissed_by_id: number | null;
  dismissed_at: string | null;
  dismiss_note: string | null;
  created_at: string;
};
export type IngestRunStatus =
  | 'planning' | 'pending_review' | 'applying'
  | 'done' | 'dismissed' | 'superseded' | 'failed' | 'partially_failed';

export type IngestEdit = {
  kind: 'edit_existing' | 'create_new' | 'source_summary' | 'conflict';
  path: string;
  title: string;
  body: string;
  tags?: string[];
  category_slug?: string;
  stability?: 'open' | 'stable' | 'locked';
  rationale: string;
  confidence?: 'high' | 'medium' | 'low';
  source_refs?: { source_id?: number | null; quote_or_excerpt: string; location?: string | null }[];
  conflict_notes?: string;
};

export type IngestRun = {
  id: number;
  raw_source_id: number;
  triggered_by_id: number | null;
  agent_user_id: number | null;
  status: IngestRunStatus;
  plan_json: { summary?: string; edits?: IngestEdit[] } | null;
  approved_edit_indices: number[] | null;
  retrieval_strategy: string | null;
  provider_model: string | null;
  summary: string | null;
  error: string | null;
  edits_count: number;
  skipped_count: number;
  conflict_count: number;
  applied_count: number;
  failed_count: number;
  started_at: string;
  planned_at: string | null;
  applied_at: string | null;
  finished_at: string | null;
};
export type RawSource = {
  id: number;
  title: string;
  description: string | null;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  ingest_status: IngestStatus;
  last_ingested_at: string | null;
  last_ingest_notes: string | null;
  uploaded_by_id: number | null;
  uploaded_at: string;
};

// ── Auth helpers ─────────────────────────────────────────────────────
function authHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const jwt = localStorage.getItem('wiki:jwt');
  if (jwt) return { Authorization: `Bearer ${jwt}` };
  // Stub fallback: identify via headers
  return {
    'X-User-Email': localStorage.getItem('wiki:email') || 'admin@example.com',
    'X-User-Role': localStorage.getItem('wiki:role') || 'admin',
  };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── API ──────────────────────────────────────────────────────────────
export const api = {
  // Auth
  whoami: () => call<User>('/auth/whoami'),
  devLogin: (email: string, name: string, role: Role) =>
    call<{ token: string; user: User }>(
      `/auth/dev-login?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&role=${role}`,
      { method: 'POST' },
    ),

  // Pages
  listPages: () => call<PageSummary[]>('/pages'),
  getPage: (path: string) => call<Page>(`/pages/${path}`),
  listRevisions: (path: string) => call<Revision[]>(`/pages/${path}/revisions`),
  backlinks: (path: string) => call<PageSummary[]>(`/pages/${path}/backlinks`),
  lockPage: (path: string, locked: boolean) =>
    call<Page>(`/pages/${path}/lock?locked=${locked}`, { method: 'POST' }),

  // Drafts and review
  createDraft: (payload: {
    page_path?: string;
    new_page?: { path: string; category_slug?: string; stability?: Stability };
    title: string; body: string; tags?: string[]; rationale?: string;
  }) => call<Revision>('/pages/draft', { method: 'POST', body: JSON.stringify(payload) }),
  myDrafts: () => call<Revision[]>('/revisions/my-drafts'),
  reviewQueue: () => call<Revision[]>('/revisions/review-queue'),
  getRevision: (id: number) => call<Revision>(`/revisions/${id}`),
  submitRevision: (id: number) =>
    call<Revision>(`/revisions/${id}/submit`, { method: 'POST' }),
  reviewRevision: (
    id: number,
    decision: 'accept' | 'reject' | 'request_changes',
    comment?: string,
    extras?: { reject_reason?: string; reject_notes?: string },
  ) =>
    call<Revision>(`/revisions/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment, ...(extras || {}) }),
    }),
  updateDraft: (id: number, title: string, body: string, tags: string[], rationale?: string) => {
    const params = new URLSearchParams();
    params.set('title', title);
    params.set('body', body);
    if (rationale) params.set('rationale', rationale);
    tags.forEach((t) => params.append('tags', t));
    return call<Revision>(`/revisions/${id}?${params}`, { method: 'PUT' });
  },

  // Comments and flags
  listComments: (path: string) => call<Comment[]>(`/pages/${path}/comments`),
  createComment: (path: string, body: string, revision_id?: number, anchor?: string) =>
    call<Comment>(`/pages/${path}/comments`, {
      method: 'POST', body: JSON.stringify({ body, revision_id, anchor }),
    }),
  listFlags: (path: string) => call<Flag[]>(`/pages/${path}/flags`),
  createFlag: (path: string, kind: FlagKind, body: string) =>
    call<Flag>(`/pages/${path}/flags`, {
      method: 'POST', body: JSON.stringify({ kind, body }),
    }),
  resolveFlag: (id: number, dismiss = false) =>
    call<Flag>(`/flags/${id}/resolve?dismiss=${dismiss}`, { method: 'POST' }),

  // Graph + search + chat
  graph: () => call<GraphData>('/graph'),
  search: (q: string) => call<SearchResult[]>(`/search?q=${encodeURIComponent(q)}`),
  chat: (
    message: string,
    history: { role: string; content: string }[] = [],
    mode: 'sources' | 'wiki' = 'sources',
  ) =>
    call<ChatResponse>('/chat', {
      method: 'POST', body: JSON.stringify({ message, history, mode }),
    }),

  // Users + agents (admin)
  listUsers: () => call<User[]>('/users'),
  setRole: (id: number, role: Role) =>
    call<User>(`/users/${id}/role?role=${role}`, { method: 'POST' }),

  // Personal MCP tokens (agents connect through MCP using these)
  listMcpTokens: () =>
    call<{ id: number; name: string; last_used_at: string | null;
           expires_at: string | null; created_at: string;
           revoked_at: string | null }[]>('/mcp-tokens'),
  createMcpToken: (name: string) =>
    call<{ raw_token: string; id: number; name: string;
           last_used_at: string | null; expires_at: string | null;
           created_at: string; revoked_at: string | null }>(
      '/mcp-tokens', { method: 'POST', body: JSON.stringify({ name }) },
    ),
  revokeMcpToken: (id: number) =>
    call<{ ok: boolean }>(`/mcp-tokens/${id}`, { method: 'DELETE' }),
  setUserMcpAccess: (userId: number, enabled: boolean) =>
    call<User>(`/users/${userId}/mcp-access?enabled=${enabled}`, { method: 'POST' }),

  // Lint pipeline (Phase 4)
  listLintReports: () => call<LintReport[]>('/admin/lint/reports'),
  getLintReport: (id: number) => call<LintReport>(`/admin/lint/reports/${id}`),
  listLintIssues: (reportId: number) =>
    call<LintIssue[]>(`/admin/lint/reports/${reportId}/issues`),
  runLint: () => call<LintReport>('/admin/lint/run', { method: 'POST' }),
  dismissLintIssue: (id: number, note?: string) =>
    call<LintIssue>(`/admin/lint/issues/${id}/dismiss`, {
      method: 'POST', body: JSON.stringify({ note }),
    }),
  markLintIssueActed: (id: number) =>
    call<LintIssue>(`/admin/lint/issues/${id}/act`, { method: 'POST' }),

  // Notifications
  listNotifications: (only_unread = false) =>
    call<Notification[]>(`/notifications?only_unread=${only_unread}`),
  markRead: (id: number) =>
    call(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () =>
    call('/notifications/read-all', { method: 'POST' }),

  // Schema layer — agents.md (Karpathy's "idea file")
  getIdeaFile: () => call<{
    path: string; content: string; last_modified: string; can_edit: boolean;
  }>('/admin/idea-file'),
  updateIdeaFile: (content: string) => call<{
    path: string; content: string; last_modified: string; can_edit: boolean;
  }>('/admin/idea-file', { method: 'PUT', body: JSON.stringify({ content }) }),

  // Revision provenance (only present for agent-authored revisions)
  getRevisionProvenance: (id: number) =>
    call<{
      revision_id: number;
      raw_source_id: number | null;
      confidence: 'high' | 'medium' | 'low' | null;
      source_refs: { source_id: number | null; quote_or_excerpt: string; location: string | null }[] | null;
      conflict_notes: string | null;
      edit_kind: string | null;
      is_agent_authored: boolean;
    }>(`/revisions/${id}/provenance`),

  // Raw sources (Karpathy-style raw layer)
  listRawSources: () => call<RawSource[]>('/raw'),
  ingestRawSource: (id: number) =>
    call<IngestRun>(`/raw/${id}/ingest`, { method: 'POST' }),
  rawSourcePendingDrafts: (id: number) =>
    call<{ revision_id: number; page_path: string; page_title: string; status: string; ingest_run_id: number | null }[]>(
      `/raw/${id}/pending-drafts`,
    ),
  rawSourceRuns: (id: number) =>
    call<IngestRun[]>(`/raw/${id}/runs`),

  // Ingest runs
  getIngestRun: (id: number) => call<IngestRun>(`/ingest-runs/${id}`),
  applyIngestRun: (id: number, approved_indices?: number[]) =>
    call<IngestRun>(`/ingest-runs/${id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ approved_indices: approved_indices ?? null }),
    }),
  dismissIngestRun: (id: number) =>
    call<IngestRun>(`/ingest-runs/${id}/dismiss`, { method: 'POST' }),
  retryIngestRun: (id: number) =>
    call<IngestRun>(`/ingest-runs/${id}/retry`, { method: 'POST' }),
  uploadRawSource: async (file: File, title?: string, description?: string): Promise<RawSource> => {
    const fd = new FormData();
    fd.append('file', file);
    if (title) fd.append('title', title);
    if (description) fd.append('description', description);
    const res = await fetch(`${API_BASE}/raw`, {
      method: 'POST', body: fd, headers: { ...authHeaders() },
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  },
  updateRawSource: (id: number, body: { title?: string; description?: string }) =>
    call<RawSource>(`/raw/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRawSource: (id: number) =>
    call<void>(`/raw/${id}`, { method: 'DELETE' }),
  rawSourceDownloadURL: (id: number) => `${API_BASE}/raw/${id}/download`,
};
