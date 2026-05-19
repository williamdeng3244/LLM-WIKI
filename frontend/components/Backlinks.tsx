'use client';
import useSWR from 'swr';
import { api, type PageSummary } from '@/lib/api';

export default function Backlinks({
  pagePath, onNavigate,
}: {
  pagePath: string;
  onNavigate: (path: string) => void;
}) {
  const { data, isLoading } = useSWR<PageSummary[]>(
    `backlinks:${pagePath}`,
    () => api.backlinks(pagePath),
    { revalidateOnFocus: false },
  );

  if (isLoading) {
    return <div className="text-[0.7857rem] text-muted italic">Loading…</div>;
  }
  if (!data || data.length === 0) {
    return <div className="text-[0.7857rem] text-muted italic">No pages link here yet.</div>;
  }
  return (
    <ul className="space-y-1">
      {data.map((p) => (
        <li key={p.id}>
          <button
            className="text-left text-[0.8929rem] text-accent hover:underline truncate w-full"
            onClick={() => onNavigate(p.path)}
            title={p.path}
          >
            {p.title}
          </button>
        </li>
      ))}
    </ul>
  );
}
