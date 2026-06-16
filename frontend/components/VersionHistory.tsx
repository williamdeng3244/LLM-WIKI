'use client';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { X, RotateCcw, ChevronRight } from 'lucide-react';
import { api, type Revision, type User } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import Diff from './Diff';

/**
 * Version history (GAP-002 / GAP-004). Each revision row expands to an inline
 * diff of that version against the current published one, and published
 * versions other than the current carry a "Restore" action. Restore recreates
 * the chosen version as a fresh edit and runs it through the normal workflow,
 * so on an open page it republishes immediately and on a stable/locked page it
 * lands in the review queue — the returned status tells us which, and we
 * surface that in a banner.
 */
export default function VersionHistory({
  path, users, canRestore = false, onClose, onRestored,
}: {
  path: string;
  users: Map<number, User>;
  canRestore?: boolean;
  onClose: () => void;
  onRestored?: (result: Revision) => void;
}) {
  const { t } = useLanguage();
  const { data: revs = [], mutate } = useSWR<Revision[]>(
    `revs:${path}`,
    () => api.listRevisions(path),
    { revalidateOnFocus: false },
  );

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // The current published version is the newest `accepted` revision. The API
  // returns revisions ordered id-desc, so it's the first accepted one we find.
  const current = useMemo(() => revs.find((r) => r.status === 'accepted') ?? null, [revs]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Restorable = a published version (accepted or a superseded older one) that
  // isn't already the live version, and only when the viewer may propose edits.
  const isRestorable = (r: Revision) =>
    canRestore && (r.status === 'accepted' || r.status === 'superseded') && r.id !== current?.id;

  async function doRestore(rev: Revision) {
    setBusyId(rev.id);
    setBanner(null);
    try {
      const result = await api.restoreRevision(rev.id);
      setBanner({
        kind: 'ok',
        text: result.status === 'accepted' ? t('history.restoredLive') : t('history.restoredQueued'),
      });
      setExpandedId(null);
      await mutate();          // the restore created a new revision — refresh the list
      onRestored?.(result);    // let the page refresh its body / review queue
    } catch {
      setBanner({ kind: 'err', text: t('history.restoreFailed') });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded-md w-[640px] max-w-[92vw] max-h-[80vh] flex flex-col shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="font-medium text-[1rem] shrink-0">{t('history.title')}</h3>
            <code className="text-[0.7857rem] text-muted bg-white/[0.06] px-1.5 py-0.5 rounded font-mono truncate">
              {path}
            </code>
          </div>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </header>

        {banner && (
          <div
            role="status"
            className={`px-4 py-2 text-[0.8571rem] border-b border-line ${
              banner.kind === 'ok'
                ? 'text-emerald-300 bg-emerald-500/10'
                : 'text-red-300 bg-red-500/10'
            }`}
          >
            {banner.text}
          </div>
        )}

        <div className="flex-1 overflow-y-auto scroll-thin">
          {revs.length === 0 ? (
            <p className="p-6 text-center text-[0.9286rem] text-muted">{t('history.empty')}</p>
          ) : (
            <ul>
              {revs.map((r) => {
                const author = users.get(r.author_id);
                const isCurrent = r.id === current?.id;
                const open = expandedId === r.id;
                return (
                  <li key={r.id} className="border-b border-white/[0.04]">
                    <div
                      className="px-4 py-3 cursor-pointer hover:bg-white/[0.04]"
                      onClick={() => setExpandedId(open ? null : r.id)}
                      title={t('history.viewChanges')}
                    >
                      <div className="flex items-center gap-2 text-[0.7857rem]">
                        <ChevronRight
                          size={12}
                          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`}
                        />
                        <span className={`badge ${r.status}`}>{r.status}</span>
                        {isCurrent && <span className="badge accepted">{t('history.current')}</span>}
                        <span className="text-muted">rev #{r.id}</span>
                        <span className="text-muted">·</span>
                        <span className="text-muted">{new Date(r.created_at).toLocaleString()}</span>
                        <span className="text-muted ml-auto">
                          {author?.name || `user #${r.author_id}`}
                        </span>
                      </div>
                      <div className="mt-1 pl-[18px] text-[0.9286rem] text-ink truncate">{r.title}</div>
                      {r.rationale && (
                        <div className="mt-1 pl-[18px] text-[0.8571rem] text-muted italic line-clamp-2">
                          &ldquo;{r.rationale}&rdquo;
                        </div>
                      )}
                    </div>

                    {open && (
                      <div className="px-4 pb-3 pl-[34px]">
                        {isCurrent ? (
                          <p className="py-1 text-[0.8571rem] text-muted italic">{t('history.current')}</p>
                        ) : current ? (
                          <>
                            <div className="mb-1 text-[0.7857rem] text-muted">{t('history.diffHeading')}</div>
                            <Diff oldText={r.body} newText={current.body} />
                          </>
                        ) : null}
                        {isRestorable(r) && (
                          <div className="mt-2 flex justify-end">
                            <button
                              data-testid="history-restore"
                              className="inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1 text-[0.8214rem] text-ink hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={busyId === r.id}
                              onClick={(e) => { e.stopPropagation(); doRestore(r); }}
                            >
                              <RotateCcw size={13} />
                              {busyId === r.id ? t('history.restoring') : t('history.restore')}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
