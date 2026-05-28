'use client';
import { useCallback, useEffect, useState } from 'react';

/** Per-user manual ordering of top-level folders.
 *
 * Stored as an array of folder paths in display order. Folders not
 * present in the list fall back to the FileTree's default alphabetical
 * sort, appended after the explicitly-ordered ones. This way the user
 * can pin the folders they care about to the top without having to
 * touch the others.
 */
const KEY = 'wiki:folder-order';

function load(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch { return []; }
}

function save(list: string[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* quota */ }
}

export function useFolderOrder() {
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => { setOrder(load()); }, []);

  /** Move `draggedPath` to land immediately before `targetPath`.
   *  Removes the drag from its old position first so reordering
   *  within the list works (no duplicates, no skipped slots). */
  const move = useCallback((draggedPath: string, targetPath: string) => {
    setOrder((prev) => {
      const next = prev.filter((p) => p !== draggedPath);
      const targetIdx = next.indexOf(targetPath);
      if (targetIdx < 0) {
        // Target wasn't in the explicit-order list yet — add target
        // first (so it gets its alphabetical position pinned), then
        // drop the dragged item right before it.
        next.push(targetPath, draggedPath);
        // Swap so dragged is right before target.
        const di = next.length - 1, ti = next.length - 2;
        [next[di], next[ti]] = [next[ti], next[di]];
      } else {
        next.splice(targetIdx, 0, draggedPath);
      }
      save(next);
      return next;
    });
  }, []);

  /** Drop the given folder out of the explicit-order list, letting
   *  it fall back to alphabetical. Called from page.tsx when a folder
   *  is renamed or deleted so we don't leak dead paths into storage. */
  const forget = useCallback((path: string) => {
    setOrder((prev) => {
      if (!prev.includes(path)) return prev;
      const next = prev.filter((p) => p !== path);
      save(next);
      return next;
    });
  }, []);

  return { order, move, forget };
}
