'use client';
import useSWR from 'swr';
import { Loader2, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import Markdown from './Markdown';

/** In-app viewer for a markdown raw source — rendered in a tab so .md files
 *  display in the page (via the shared Markdown renderer) instead of opening
 *  the raw bytes in a new browser tab. Non-markdown sources (pdf/images)
 *  still open externally from the Raw Sources tree. */
export default function RawSourceView({
  sourceId, title, knownPaths, onNavigate,
}: {
  sourceId: number;
  title: string;
  knownPaths: Set<string>;
  onNavigate: (path: string, inNewTab?: boolean) => void;
}) {
  const { data, error, isLoading } = useSWR(
    `raw-text:${sourceId}`, () => api.rawSourceText(sourceId),
    { revalidateOnFocus: false },
  );
  return (
    <div className="h-full flex flex-col reading-wash">
      <div className="page-toolbar shrink-0 px-6 py-2 border-b border-black/10 backdrop-blur flex items-center gap-2 z-10">
        <FileText size={13} className="text-accent shrink-0" />
        <span className="page-crumb text-[0.75rem] uppercase tracking-[0.16em] font-medium truncate min-w-0">{title}</span>
        <span className="text-[0.7rem] text-muted shrink-0">· raw source</span>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="max-w-[820px] mx-auto px-8 pt-8 pb-16">
          {isLoading ? (
            <div className="text-muted text-sm flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="text-rose-300 text-sm">Failed to load source: {(error as Error).message}</div>
          ) : (
            <Markdown knownPaths={knownPaths} onWikiLinkClick={onNavigate}>{data || ''}</Markdown>
          )}
        </div>
      </div>
    </div>
  );
}
