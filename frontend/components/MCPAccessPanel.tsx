'use client';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import {
  X, Check, Copy, Plug, Trash2, Lock, Loader2, ShieldCheck, ShieldOff, Eye, EyeOff,
} from 'lucide-react';
import { api, type User } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';

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
  const { t } = useLanguage();
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
  const [copiedKind, setCopiedKind] = useState<'token' | 'config' | null>(null);
  const [revealed, setRevealed] = useState(true);
  // Which listed token's config template is expanded (the eye in Your tokens).
  const [templateFor, setTemplateFor] = useState<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A freshly created token always starts revealed (the eye toggle below can
  // mask it on screen without destroying it).
  useEffect(() => { if (newToken) setRevealed(true); }, [newToken]);

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
    if (!confirm(t('mcp.revokeConfirm'))) return;
    try {
      await api.revokeMcpToken(id);
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function copy(text: string, kind: 'token' | 'config') {
    try { await navigator.clipboard.writeText(text); setCopiedKind(kind); setTimeout(() => setCopiedKind(null), 1500); } catch {}
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

  // Re-viewable config for an EXISTING listed token: the server URL + header
  // shape with a placeholder, since the raw token is one-time (hash-only) and
  // can't be re-shown. Surfaced by the eye in the Your-tokens list.
  const mcpUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin.replace(/:\d+$/, ':8000')}/mcp`
      : '/mcp';
  const configTemplate = JSON.stringify(
    {
      mcpServers: {
        'enflame-wiki': {
          url: mcpUrl,
          headers: { Authorization: 'Bearer <paste-your-saved-token>' },
        },
      },
    },
    null,
    2,
  );

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
            <h3 className="font-medium text-[1rem] flex items-center gap-2">
              <Plug size={15} className="text-accent" /> {t('mcp.title')}
            </h3>
            <div className="text-[0.8214rem] text-muted">
              {t('mcp.subtitle')}
            </div>
          </div>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label={t('mcp.close')}>
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto scroll-thin p-5 space-y-5">
          {!meEnabled ? (
            <div className="bg-rose-500/[0.08] border border-rose-500/30 rounded-md p-3.5 flex items-start gap-3">
              <Lock size={16} className="text-rose-300 shrink-0 mt-0.5" />
              <div className="text-[0.8929rem] text-rose-300">
                <strong>{t('mcp.notGranted')}</strong> {t('mcp.notGrantedBody')}
              </div>
            </div>
          ) : (
            <>
              {newToken && configSnippet && (
                <div className="bg-emerald-500/[0.08] border border-emerald-500/30 rounded-md p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-[0.8929rem] text-emerald-300 font-medium">
                      {t('mcp.tokenCreated')}
                    </div>
                    {revealed && (
                      <button
                        className="text-muted hover:text-ink shrink-0"
                        onClick={() => setRevealed(false)}
                        title={t('mcp.hide')}
                        aria-label={t('mcp.hide')}
                      >
                        <EyeOff size={15} />
                      </button>
                    )}
                  </div>
                  {revealed ? (
                    <>
                      <div className="flex gap-2 items-stretch">
                        <code className="flex-1 bg-[#0a0f1e] border border-emerald-500/30 rounded px-3 py-2 text-[0.8214rem] break-all font-mono text-emerald-200">
                          {newToken}
                        </code>
                        <button className="btn shrink-0" onClick={() => copy(newToken, 'token')}>
                          {copiedKind === 'token' ? <><Check size={13} /> {t('mcp.tokenCopied')}</> : <><Copy size={13} /> {t('mcp.tokenCopy')}</>}
                        </button>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="text-[0.7857rem] uppercase tracking-[0.18em] text-muted">
                          {t('mcp.dropConfig')}
                        </div>
                        <button className="btn shrink-0" onClick={() => copy(configSnippet, 'config')}>
                          {copiedKind === 'config' ? <><Check size={13} /> {t('mcp.tokenCopied')}</> : <><Copy size={13} /> {t('mcp.configCopy')}</>}
                        </button>
                      </div>
                      <pre className="mt-1 bg-[#0a0f1e] border border-line rounded p-3 text-[0.8214rem] font-mono text-ink/85 overflow-x-auto">
{configSnippet}
                      </pre>
                    </>
                  ) : (
                    <button
                      className="text-[0.8214rem] text-muted hover:text-ink flex items-center gap-2"
                      onClick={() => setRevealed(true)}
                    >
                      <Eye size={14} /> {t('mcp.tokenHidden')}
                    </button>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  className="form-input flex-1"
                  placeholder={t('mcp.namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && create()}
                />
                <button className="btn btn-primary" onClick={create} disabled={!name.trim() || creating}>
                  {creating ? <><Loader2 size={13} className="animate-spin" /> {t('mcp.creating')}</> : t('mcp.create')}
                </button>
              </div>
              {error && (
                <div className="text-[0.8214rem] bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2 rounded">
                  {error}
                </div>
              )}

              <div>
                <div className="text-[0.7143rem] uppercase tracking-[0.18em] text-muted mb-2">
                  {t('mcp.yourTokens')} ({tokens.length})
                </div>
                {tokens.length === 0 ? (
                  <div className="text-[0.8571rem] text-muted italic">{t('mcp.activeNone')}</div>
                ) : (
                  <div className="border border-white/[0.06] rounded-md overflow-hidden">
                    {tokens.map((tok, i) => (
                      <div key={tok.id} className={`text-[0.9286rem] ${i > 0 ? 'border-t border-white/[0.04]' : ''}`}>
                        <div className="px-4 py-3 flex items-center gap-3">
                          <Plug size={13} className="text-accent shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{tok.name}</div>
                            <div className="text-[0.7857rem] text-muted truncate">
                              {t('mcp.created')} {new Date(tok.created_at).toLocaleString()}
                              {tok.last_used_at && <> · {t('mcp.lastUsed')} {new Date(tok.last_used_at).toLocaleString()}</>}
                            </div>
                          </div>
                          <button
                            className="btn btn-icon"
                            onClick={() => setTemplateFor(templateFor === tok.id ? null : tok.id)}
                            title={t('mcp.showConfig')}
                            aria-label={t('mcp.showConfig')}
                          >
                            {templateFor === tok.id ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                          <button className="btn btn-icon" onClick={() => revoke(tok.id)} title={t('mcp.revoke')}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                        {templateFor === tok.id && (
                          <div className="px-4 pb-3">
                            <div className="text-[0.7857rem] text-muted mb-1.5">{t('mcp.templateNote')}</div>
                            <div className="flex items-start gap-2">
                              <pre className="flex-1 bg-[#0a0f1e] border border-line rounded p-3 text-[0.7857rem] font-mono text-ink/85 overflow-x-auto">
{configTemplate}
                              </pre>
                              <button className="btn shrink-0" onClick={() => copy(configTemplate, 'config')}>
                                {copiedKind === 'config' ? <><Check size={13} /> {t('mcp.tokenCopied')}</> : <><Copy size={13} /> {t('mcp.configCopy')}</>}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {isAdmin && (
            <div className="pt-4 border-t border-white/[0.06]">
              <div className="text-[0.7143rem] uppercase tracking-[0.18em] text-muted mb-2">
                {t('mcp.admin.heading')}
              </div>
              <div className="text-[0.8214rem] text-muted mb-2.5">
                {t('mcp.admin.body')}
              </div>
              <div className="border border-white/[0.06] rounded-md overflow-hidden">
                {users.filter((u) => !u.is_agent).map((u, i) => {
                  const enabled = u.mcp_enabled ?? true;
                  return (
                    <div key={u.id} className={`px-4 py-2.5 text-[0.8929rem] flex items-center gap-3 ${i > 0 ? 'border-t border-white/[0.04]' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{u.name} <span className="text-muted">· {u.email}</span></div>
                        <div className="text-[0.75rem] text-muted">{t('mcp.admin.role')}: {u.role}</div>
                      </div>
                      <button
                        className={`btn ${enabled ? '' : 'btn-primary'}`}
                        onClick={() => toggleUserMcp(u)}
                        title={enabled ? t('mcp.admin.revokeTitle') : t('mcp.admin.grantTitle')}
                      >
                        {enabled ? <><ShieldCheck size={13} /> {t('mcp.admin.enabled')}</> : <><ShieldOff size={13} /> {t('mcp.admin.disabled')}</>}
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
