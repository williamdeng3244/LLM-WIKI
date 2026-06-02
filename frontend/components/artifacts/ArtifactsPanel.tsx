'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Share2, X, RefreshCw, Plus, Copy, ExternalLink, Trash2, Upload,
  Eye, Loader2, Check,
} from 'lucide-react';

import {
  api, type ArtifactMeta, type ArtifactAccessLogEntry,
} from '@/lib/api';

/** Owner-side artifact management panel. Opened by the Share2 icon in
 * the top bar. Lists the current user's artifacts with per-row actions
 * (Copy / Open / Update version / Rename / Visibility / Access log /
 * Delete). The Upload-new-artifact button hands off to the parent so
 * the parent can mount PublishArtifactModal with mode='file' — that
 * keeps the modal independent of this panel and reusable from the
 * file-tree right-click path too.
 */
export default function ArtifactsPanel({
  onClose, onUploadClick, refreshTick,
}: {
  onClose: () => void;
  onUploadClick: () => void;
  /** Bump from the parent to force a refresh — handy right after the
   *  publish modal succeeds so the new artifact lands at the top. */
  refreshTick?: number;
}) {
  const [items, setItems] = useState<ArtifactMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [accessLogFor, setAccessLogFor] = useState<string | null>(null);
  const [accessLog, setAccessLog] = useState<ArtifactAccessLogEntry[] | null>(null);
  const [copiedSid, setCopiedSid] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const versionFileInput = useRef<HTMLInputElement | null>(null);
  const [versionFor, setVersionFor] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.listMyArtifacts(50, 0);
      setItems(resp.items);
      setTotal(resp.total);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload, refreshTick]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (accessLogFor) { setAccessLogFor(null); return; }
        if (renaming) { setRenaming(null); return; }
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, renaming, accessLogFor]);

  async function copyURL(item: ArtifactMeta) {
    const url = `${window.location.origin}/a/${item.short_id}-${item.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSid(item.short_id);
      window.setTimeout(() => setCopiedSid(null), 1500);
    } catch { /* clipboard blocked */ }
  }

  function openInNewTab(item: ArtifactMeta) {
    window.open(`/a/${item.short_id}-${item.slug}`, '_blank', 'noreferrer');
  }

  async function commitRename(sid: string) {
    const next = renameValue.trim();
    setRenaming(null);
    if (!next) return;
    try {
      await api.patchArtifact(sid, { name: next });
      reload();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  async function toggleVisibility(item: ArtifactMeta) {
    const next = item.visibility === 'company' ? 'public' : 'company';
    try {
      await api.patchArtifact(item.short_id, { visibility: next });
      reload();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  async function deleteOne(sid: string) {
    try {
      await api.deleteArtifact(sid);
      setConfirmDelete(null);
      reload();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  async function uploadVersion(file: File) {
    if (!versionFor) return;
    try {
      await api.uploadArtifactVersion(versionFor, file);
      setVersionFor(null);
      reload();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  async function showAccessLog(sid: string) {
    setAccessLogFor(sid);
    setAccessLog(null);
    try {
      const resp = await api.getArtifactAccessLog(sid, 50);
      setAccessLog(resp.items);
    } catch (e: unknown) {
      setError((e as Error).message);
      setAccessLog([]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-stretch justify-end"
      onClick={onClose}
    >
      <div
        className="bg-panel border-l border-line h-full w-[560px] max-w-full shadow-[-12px_0_40px_-12px_rgba(0,0,0,0.7)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <Share2 size={14} className="text-accent" />
          <h3 className="font-medium text-[1rem] flex-1">
            Artifacts <span className="text-muted text-[0.82rem]">({total})</span>
          </h3>
          <button
            className="px-2 py-1 rounded text-muted hover:text-ink hover:bg-line/40"
            onClick={reload} title="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            className="px-2.5 py-1 rounded bg-accent text-paper hover:opacity-90 text-[0.82rem] flex items-center gap-1.5"
            onClick={onUploadClick}
          >
            <Plus size={13} /> Upload
          </button>
          <button
            className="text-muted hover:text-ink ml-1"
            onClick={onClose} aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 text-[0.82rem] text-rose-300 bg-rose-500/10 border-b border-rose-500/30">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {loading && items.length === 0 ? (
            <div className="px-4 py-6 text-center text-muted text-[0.86rem]">
              <Loader2 size={14} className="animate-spin inline mr-1.5" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="px-6 py-10 text-center text-muted text-[0.86rem]">
              No artifacts yet. Right-click any page and choose{' '}
              <span className="text-ink">Publish as gated link</span>,
              or hit <span className="text-ink">Upload</span> above.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.short_id} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      {renaming === item.short_id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(item.short_id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(item.short_id);
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          className="w-full bg-bg border border-line rounded px-2 py-1 text-[0.86rem]"
                        />
                      ) : (
                        <button
                          className="text-left font-medium text-[0.92rem] hover:text-accent block w-full truncate"
                          onClick={() => {
                            setRenaming(item.short_id);
                            setRenameValue(item.name);
                          }}
                          title="Click to rename"
                        >
                          {item.name}
                        </button>
                      )}
                      <div className="text-[0.78rem] text-muted flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        <code>{item.short_id}</code>
                        <span>v{item.current_version}</span>
                        <button
                          className={`px-1.5 rounded border ${
                            item.visibility === 'public'
                              ? 'border-rose-500/40 text-rose-300'
                              : 'border-line text-muted hover:text-ink'
                          }`}
                          onClick={() => toggleVisibility(item)}
                          title="Toggle visibility"
                        >
                          {item.visibility}
                        </button>
                        <span>{item.views_7d} views/7d</span>
                        {item.expires_at && (
                          <span>expires {new Date(item.expires_at).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 mt-2 text-[0.78rem]">
                    <button
                      className="px-2 py-1 rounded border border-line hover:bg-line/40 flex items-center gap-1"
                      onClick={() => copyURL(item)}
                    >
                      {copiedSid === item.short_id
                        ? <><Check size={11} className="text-accent" /> Copied</>
                        : <><Copy size={11} /> Copy link</>}
                    </button>
                    <button
                      className="px-2 py-1 rounded border border-line hover:bg-line/40 flex items-center gap-1"
                      onClick={() => openInNewTab(item)}
                    >
                      <ExternalLink size={11} /> Open
                    </button>
                    <button
                      className="px-2 py-1 rounded border border-line hover:bg-line/40 flex items-center gap-1"
                      onClick={() => {
                        setVersionFor(item.short_id);
                        versionFileInput.current?.click();
                      }}
                    >
                      <Upload size={11} /> New version
                    </button>
                    <button
                      className="px-2 py-1 rounded border border-line hover:bg-line/40 flex items-center gap-1"
                      onClick={() => showAccessLog(item.short_id)}
                    >
                      <Eye size={11} /> Access log
                    </button>
                    <div className="flex-1" />
                    {confirmDelete === item.short_id ? (
                      <>
                        <button
                          className="px-2 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                          onClick={() => deleteOne(item.short_id)}
                        >
                          Confirm delete
                        </button>
                        <button
                          className="px-2 py-1 rounded border border-line hover:bg-line/40"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="px-2 py-1 rounded border border-line hover:bg-rose-500/10 hover:text-rose-300 flex items-center gap-1"
                        onClick={() => setConfirmDelete(item.short_id)}
                      >
                        <Trash2 size={11} /> Delete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Hidden file input shared across all "New version" buttons. */}
        <input
          ref={versionFileInput}
          type="file"
          className="hidden"
          accept=".html,.htm,.md,.txt,text/html,text/markdown,text/plain"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadVersion(f);
            e.target.value = '';
          }}
        />

        {/* Access-log overlay (inside the panel, not a new modal). */}
        {accessLogFor && (
          <div
            className="absolute inset-0 bg-bg/95 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-line flex items-center gap-2">
              <Eye size={14} className="text-accent" />
              <h4 className="font-medium text-[0.92rem] flex-1">
                Access log · <code>{accessLogFor}</code>
              </h4>
              <button
                className="text-muted hover:text-ink"
                onClick={() => setAccessLogFor(null)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto px-4 py-3">
              {accessLog === null ? (
                <div className="text-muted text-[0.86rem]">
                  <Loader2 size={13} className="animate-spin inline mr-1" /> Loading…
                </div>
              ) : accessLog.length === 0 ? (
                <div className="text-muted text-[0.86rem]">No views yet.</div>
              ) : (
                <ul className="text-[0.82rem] divide-y divide-line">
                  {accessLog.map((row, idx) => (
                    <li key={idx} className="py-1.5">
                      <div>
                        <span className="text-ink">{row.user_email || '(anonymous)'}</span>
                        <span className="text-muted"> · v{row.version}</span>
                        <span className="text-muted"> · {new Date(row.accessed_at).toLocaleString()}</span>
                      </div>
                      {row.ip && <div className="text-muted text-[0.78rem]">{row.ip}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
