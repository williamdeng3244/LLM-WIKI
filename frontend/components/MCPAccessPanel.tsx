'use client';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import {
  X, Check, Copy, Plug, Trash2, Lock, Loader2, ShieldCheck, ShieldOff,
} from 'lucide-react';
import { api, type User } from '@/lib/api';

type Token = {
  id: number; name: string; last_used_at: string | null;
  expires_at: string | null; created_at: string; revoked_at: string | null;
};

export default function MCPAccessPanel({
  onClose, currentUser,
}: {
  onClose: () => void;
  currentUser: User | null;
}) {
  const isAdmin = currentUser?.role === 'admin';
  // mcp_enabled comes back from /api/users; if missing on the cached
  // current user record we optimistically assume enabled (the backend
  // default) and let the create-token call surface a 403 if not.
  const meEnabled = currentUser?.mcp_enabled ?? true;

  const { data: tokens = [], mutate } = useSWR<Token[]>(
    'mcp-tokens', api.listMcpTokens, { revalidateOnFocus: false },
  );
  const { data: users = [], mutate: mutateUsers } = useSWR<User[]>(
    isAdmin ? 'users-mcp' : null, api.listUsers, { revalidateOnFocus: false },
  );

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const t = await api.createMcpToken(name.trim());
      setNewToken(t.raw_token);
      setName('');
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: number) {
    if (!confirm('Revoke this token? Any MCP client using it will lose access.')) return;
    try {
      await api.revokeMcpToken(id);
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }

  async function toggleUserMcp(u: User) {
    try {
      await api.setUserMcpAccess(u.id, !(u.mcp_enabled ?? true));
      await mutateUsers();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const configSnippet = newToken
    ? JSON.stringify({
        mcpServers: {
          'enflame-wiki': {
            url: `${window.location.origin.replace(/:\d+$/, ':8000')}/mcp`,
            headers: { Authorization: `Bearer ${newToken}` },
          },
        },
      }, null, 2)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded-md w-[720px] max-w-[94vw] max-h-[90vh] flex flex-col shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-line flex items-center justify-between">
          <div>
            <h3 className="font-medium text-[14px] flex items-center gap-2">
              <Plug size={15} className="text-accent" /> MCP access
            </h3>
            <div className="text-[11.5px] text-muted">
              Connect external LLM clients (Claude Desktop, Claude Code, Cursor)
              to this wiki. Tokens authenticate as YOU — operations honor your
              role and category scope.
            </div>
          </div>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto scroll-thin p-5 space-y-5">
          {!meEnabled ? (
            <div className="bg-rose-500/[0.08] border border-rose-500/30 rounded-md p-3.5 flex items-start gap-3">
              <Lock size={16} className="text-rose-300 shrink-0 mt-0.5" />
              <div className="text-[12.5px] text-rose-300">
                <strong>MCP access not granted.</strong> An admin needs to enable
                MCP for your account before you can create tokens.
              </div>
            </div>
          ) : (
            <>
              {newToken && configSnippet && (
                <div className="bg-emerald-500/[0.08] border border-emerald-500/30 rounded-md p-3.5">
                  <div className="text-[12.5px] text-emerald-300 font-medium mb-2">
                    Token created. Copy it now — you won't see it again.
                  </div>
                  <div className="flex gap-2 items-stretch">
                    <code className="flex-1 bg-[#0a0f1e] border border-emerald-500/30 rounded px-3 py-2 text-[11.5px] break-all font-mono text-emerald-200">
                      {newToken}
                    </code>
                    <button className="btn shrink-0" onClick={() => copy(newToken)}>
                      {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                    </button>
                  </div>
                  <div className="mt-3 text-[11px] uppercase tracking-[0.18em] text-muted">
                    Drop this into your MCP client config:
                  </div>
                  <pre className="mt-1 bg-[#0a0f1e] border border-line rounded p-3 text-[11.5px] font-mono text-ink/85 overflow-x-auto">
{configSnippet}
                  </pre>
                  <button className="mt-2 text-[11px] text-muted hover:text-ink underline" onClick={() => setNewToken(null)}>
                    Hide
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  className="form-input flex-1"
                  placeholder="Token name (e.g. 'Claude Desktop on laptop')"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && create()}
                />
                <button className="btn btn-primary" onClick={create} disabled={!name.trim() || creating}>
                  {creating ? <><Loader2 size={13} className="animate-spin" /> Creating…</> : 'Create token'}
                </button>
              </div>
              {error && (
                <div className="text-[11.5px] bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2 rounded">
                  {error}
                </div>
              )}

              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">
                  Your tokens ({tokens.length})
                </div>
                {tokens.length === 0 ? (
                  <div className="text-[12px] text-muted italic">No active tokens.</div>
                ) : (
                  <div className="border border-white/[0.06] rounded-md overflow-hidden">
                    {tokens.map((t, i) => (
                      <div key={t.id} className={`px-4 py-3 text-[13px] flex items-center gap-3 ${i > 0 ? 'border-t border-white/[0.04]' : ''}`}>
                        <Plug size={13} className="text-accent shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{t.name}</div>
                          <div className="text-[11px] text-muted truncate">
                            Created {new Date(t.created_at).toLocaleString()}
                            {t.last_used_at && <> · last used {new Date(t.last_used_at).toLocaleString()}</>}
                          </div>
                        </div>
                        <button className="btn btn-icon" onClick={() => revoke(t.id)} title="Revoke">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {isAdmin && (
            <div className="pt-4 border-t border-white/[0.06]">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">
                Admin · MCP access per user
              </div>
              <div className="text-[11.5px] text-muted mb-2.5">
                Toggle whether each user can create personal MCP tokens. New users default to enabled.
              </div>
              <div className="border border-white/[0.06] rounded-md overflow-hidden">
                {users.filter((u) => !u.is_agent).map((u, i) => {
                  const enabled = u.mcp_enabled ?? true;
                  return (
                    <div key={u.id} className={`px-4 py-2.5 text-[12.5px] flex items-center gap-3 ${i > 0 ? 'border-t border-white/[0.04]' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{u.name} <span className="text-muted">· {u.email}</span></div>
                        <div className="text-[10.5px] text-muted">role: {u.role}</div>
                      </div>
                      <button
                        className={`btn ${enabled ? '' : 'btn-primary'}`}
                        onClick={() => toggleUserMcp(u)}
                        title={enabled ? 'Click to revoke MCP access' : 'Click to grant MCP access'}
                      >
                        {enabled ? <><ShieldCheck size={13} /> Enabled</> : <><ShieldOff size={13} /> Disabled</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
