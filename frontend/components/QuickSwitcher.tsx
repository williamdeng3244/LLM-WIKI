'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, FileText, ArrowRight, Clock } from 'lucide-react';
import type { PageSummary } from '@/lib/api';

const RECENT_KEY = 'wiki:recent-paths';
const RECENT_MAX = 20;

// Track every navigation to a page so the empty-query view shows the
// places the user actually moves between. Called from the parent's
// navigate() — the switcher itself is read-only.
export function pushRecent(path: string) {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const next = [path, ...list.filter((p) => p !== path)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* quota */ }
}

function loadRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// Lightweight fuzzy score. Rewards prefix matches, contiguous runs, and
// matches at word/path boundaries. Returns -Infinity for no match so we
// can filter cleanly.
function score(needle: string, haystack: string): number {
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (!n) return 0;
  if (h.startsWith(n)) return 1000 - h.length;
  const idx = h.indexOf(n);
  if (idx >= 0) return 800 - idx - h.length * 0.1;
  let hi = 0;
  let s = 0;
  let prevMatched = false;
  for (let ni = 0; ni < n.length; ni++) {
    const c = n[ni];
    let found = -1;
    for (let i = hi; i < h.length; i++) {
      if (h[i] === c) { found = i; break; }
    }
    if (found < 0) return -Infinity;
    if (prevMatched && found === hi) s += 6;
    else s += 2;
    if (found === 0 || h[found - 1] === '/' || h[found - 1] === '-' || h[found - 1] === '_') s += 4;
    hi = found + 1;
    prevMatched = true;
  }
  return s - h.length * 0.05;
}

export default function QuickSwitcher({
  pages, onClose, onSelect,
}: {
  pages: PageSummary[];
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recents = useMemo(loadRecents, []);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const items = useMemo(() => {
    const trimmed = q.trim();
    if (!trimmed) {
      const recentSet = new Set(recents);
      const recentPages = recents
        .map((p) => pages.find((pg) => pg.path === p))
        .filter((p): p is PageSummary => !!p);
      const others = pages
        .filter((p) => !recentSet.has(p.path))
        .sort((a, b) => a.title.localeCompare(b.title));
      return [
        ...recentPages.map((p) => ({ p, recent: true })),
        ...others.map((p) => ({ p, recent: false })),
      ];
    }
    return pages
      .map((p) => {
        const sPath = score(trimmed, p.path);
        const sTitle = score(trimmed, p.title);
        return { p, recent: recents.includes(p.path), s: Math.max(sPath, sTitle) };
      })
      .filter((x) => x.s > -Infinity)
      .sort((a, b) => (b.s + (b.recent ? 50 : 0)) - (a.s + (a.recent ? 50 : 0)));
  }, [q, pages, recents]);

  useEffect(() => { setIdx(0); }, [q]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => Math.min(items.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const sel = items[idx];
        if (sel) onSelect(sel.p.path);
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, idx, onSelect, onClose]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[14vh]"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[92vw] bg-panel border border-line rounded-md shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.25)] flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
          <Search size={14} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a page by title or path…"
            className="flex-1 bg-transparent outline-none text-[14px] text-ink placeholder:text-muted"
          />
          <kbd className="text-[10px] text-muted bg-white/[0.06] border border-white/10 rounded px-1.5 py-0.5 font-mono">esc</kbd>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto scroll-thin py-1">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12.5px] text-muted">
              No pages match &quot;{q}&quot;
            </div>
          ) : (
            items.slice(0, 80).map(({ p, recent }, i) => (
              <button
                key={p.path}
                data-idx={i}
                onClick={() => onSelect(p.path)}
                onMouseEnter={() => setIdx(i)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors ${
                  i === idx ? 'bg-accent/15' : 'hover:bg-white/[0.04]'
                }`}
              >
                <FileText size={13} className={i === idx ? 'text-accent' : 'text-muted'} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] truncate text-ink">{p.title}</div>
                  <div className="text-[11px] text-muted truncate font-mono">{p.path}</div>
                </div>
                {recent && (
                  <Clock size={11} className="text-muted/60 shrink-0" aria-label="recent" />
                )}
                {p.stability !== 'stable' && (
                  <span className={`badge ${p.stability} shrink-0`}>{p.stability}</span>
                )}
                {i === idx && (
                  <ArrowRight size={12} className="text-accent shrink-0" />
                )}
              </button>
            ))
          )}
        </div>

        <div className="px-3 py-2 border-t border-line text-[10.5px] text-muted flex items-center gap-3">
          <span className="flex items-center gap-1">
            <kbd className="bg-white/[0.06] border border-white/10 rounded px-1 py-0.5 font-mono text-[9px]">↑</kbd>
            <kbd className="bg-white/[0.06] border border-white/10 rounded px-1 py-0.5 font-mono text-[9px]">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-white/[0.06] border border-white/10 rounded px-1 py-0.5 font-mono text-[9px]">↵</kbd>
            open
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <kbd className="bg-white/[0.06] border border-white/10 rounded px-1 py-0.5 font-mono text-[9px]">⌃O</kbd>
            quick switcher
          </span>
        </div>
      </div>
    </div>
  );
}
