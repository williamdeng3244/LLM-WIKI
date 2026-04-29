'use client';
import { useEffect, useRef, useState } from 'react';
import { api, type SearchResult } from '@/lib/api';

/**
 * Floating search results dropdown. Debounced fetch, keyboard-navigable,
 * collapses on Escape or outside click.
 */
export default function SearchResults({
  query, onClose, onSelect,
}: {
  query: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const rs = await api.search(query.trim());
        setResults(rs.slice(0, 8));
        setActiveIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  // Keyboard nav: ArrowUp/Down to navigate, Enter to select, Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' && results[activeIndex]) {
        e.preventDefault();
        onSelect(results[activeIndex].page_path);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [results, activeIndex, onSelect, onClose]);

  // Outside-click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  if (!query.trim()) return null;

  return (
    <div
      ref={containerRef}
      className="absolute top-full left-0 right-0 mt-1 bg-panel border border-line rounded-md shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] z-30 max-h-[420px] overflow-y-auto scroll-thin"
    >
      {loading && results.length === 0 ? (
        <div className="px-3 py-3 text-[12.5px] text-muted">Searching…</div>
      ) : results.length === 0 ? (
        <div className="px-3 py-3 text-[12.5px] text-muted">No results for "{query}"</div>
      ) : (
        results.map((r, i) => (
          <button
            key={`${r.chunk_id}`}
            className={`block w-full text-left px-3 py-2 border-b border-black/5 last:border-b-0 ${
              i === activeIndex ? 'bg-accent/8' : 'hover:bg-black/5'
            }`}
            onMouseEnter={() => setActiveIndex(i)}
            onClick={() => onSelect(r.page_path)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium truncate">{r.page_title}</span>
              <span className="text-[10.5px] text-muted shrink-0">
                {r.page_path}
                {r.chunk_type === 'code' && ` · L${r.line_start}–${r.line_end}`}
              </span>
            </div>
            <div className="text-[11.5px] text-muted mt-0.5 line-clamp-2">
              {r.snippet}
            </div>
          </button>
        ))
      )}
    </div>
  );
}
