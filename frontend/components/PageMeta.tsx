'use client';
import useSWR from 'swr';
import { useMemo } from 'react';
import Backlinks from './Backlinks';
import { api, type Page, type Revision, type User } from '@/lib/api';

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return s; }
}

export default function PageMeta({
  page, users, onNavigate, onSelectRevision,
}: {
  page: Page;
  users: Map<number, User>;
  onNavigate: (path: string) => void;
  onSelectRevision?: (rev: Revision) => void;
}) {
  const { data: revisions = [] } = useSWR<Revision[]>(
    `revisions:${page.path}`,
    () => api.listRevisions(page.path),
    { revalidateOnFocus: false },
  );

  const accepted = useMemo(
    () => revisions.filter((r) => r.status === 'accepted' || r.status === 'superseded'),
    [revisions],
  );
  const latest = accepted[0];

  return (
    <div className="space-y-5 text-[12.5px]">
      <section>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted mb-2">Page</div>
        <dl className="space-y-1.5 text-[12.5px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Updated</dt>
            <dd>{formatDate(page.updated_at)}</dd>
          </div>
          {latest && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Last edit by</dt>
              <dd className="truncate" title={users.get(latest.author_id)?.email || ''}>
                {users.get(latest.author_id)?.name || `user #${latest.author_id}`}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Stability</dt>
            <dd><span className={`badge ${page.stability}`}>{page.stability}</span></dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Revisions</dt>
            <dd>{revisions.length}</dd>
          </div>
        </dl>
      </section>

      <section>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted mb-2">
          Backlinks
        </div>
        <Backlinks pagePath={page.path} onNavigate={onNavigate} />
      </section>

      {accepted.length > 0 && (
        <section>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted mb-2">
            History
          </div>
          <ul className="space-y-1">
            {accepted.slice(0, 6).map((r) => (
              <li key={r.id}>
                <button
                  className="w-full text-left text-[12px] hover:bg-black/5 rounded px-1.5 py-0.5 -mx-1.5 flex justify-between items-baseline gap-2"
                  onClick={() => onSelectRevision?.(r)}
                >
                  <span className="truncate">
                    {users.get(r.author_id)?.name || `user #${r.author_id}`}
                  </span>
                  <span className="text-muted text-[11px] shrink-0">
                    {formatDate(r.created_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
