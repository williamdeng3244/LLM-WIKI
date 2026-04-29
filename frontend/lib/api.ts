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
  reviewRevision: (id: number, decision: 'accept' | 'reject' | 'request_changes', comment?: string) =>
    call<Revision>(`/revisions/${id}/review`, {
      method: 'POST', body: JSON.stringify({ decision, comment }),
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
  chat: (message: string, history: { role: string; content: string }[] = []) =>
    call<ChatResponse>('/chat', {
      method: 'POST', body: JSON.stringify({ message, history }),
    }),

  // Users + agents (admin)
  listUsers: () => call<User[]>('/users'),
  setRole: (id: number, role: Role) =>
    call<User>(`/users/${id}/role?role=${role}`, { method: 'POST' }),

  // Personal agents
  listAgents: () => call<User[]>('/agents'),
  createAgent: (name: string) =>
    call<{ raw_token: string; id: number; name: string }>(
      '/agents', { method: 'POST', body: JSON.stringify({ name }) },
    ),

  // Notifications
  listNotifications: (only_unread = false) =>
    call<Notification[]>(`/notifications?only_unread=${only_unread}`),
  markRead: (id: number) =>
    call(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () =>
    call('/notifications/read-all', { method: 'POST' }),
};
