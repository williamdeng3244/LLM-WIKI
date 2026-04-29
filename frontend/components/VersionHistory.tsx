'use client';
import { useEffect } from 'react';
import useSWR from 'swr';
import { X } from 'lucide-react';
import { api, type Revision, type User } from '@/lib/api';

export default function VersionHistory({
  path, users, onClose, onOpenRevision,
}: {
  path: string;
  users: Map<number, User>;
  onClose: () => void;
  onOpenRevision?: (rev: Revision) => void;
}) {
  const { data: revs = [] } = useSWR<Revision[]>(
    `revs:${path}`,
    () => api.listRevisions(path),
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
            <h3 className="font-medium text-[14px] shrink-0">Version history</h3>
            <code className="text-[11px] text-muted bg-white/[0.06] px-1.5 py-0.5 rounded font-mono truncate">
              {path}
            </code>
          </div>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto scroll-thin">
          {revs.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-muted">No revisions yet.</p>
          ) : (
            <ul>
              {revs.map((r) => {
                const author = users.get(r.author_id);
                return (
                  <li
                    key={r.id}
                    className={`px-4 py-3 border-b border-white/[0.04] ${
                      onOpenRevision ? 'cursor-pointer hover:bg-white/[0.04]' : ''
                    }`}
                    onClick={() => onOpenRevision?.(r)}
                  >
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className={`badge ${r.status}`}>{r.status}</span>
                      <span className="text-muted">rev #{r.id}</span>
                      <span className="text-muted">·</span>
                      <span className="text-muted">{new Date(r.created_at).toLocaleString()}</span>
                      <span className="text-muted ml-auto">
                        {author?.name || `user #${r.author_id}`}
                      </span>
                    </div>
                    <div className="mt-1 text-[13px] text-ink truncate">{r.title}</div>
                    {r.rationale && (
                      <div className="mt-1 text-[12px] text-muted italic line-clamp-2">
                        &ldquo;{r.rationale}&rdquo;
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
