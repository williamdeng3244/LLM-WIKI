'use client';
import { useEffect, useState } from 'react';

// User-created Raw Sources folders ("sections"). Like the wiki tree's
// customFolders, these persist in localStorage so an empty section the
// user made (right-click 原始资料 → New folder) survives before any source
// is moved into it. Emergent folders — a source's auto-set category such
// as "archive" — are merged in by the consumer and don't live here.
const KEY = 'wiki:raw-folders';

function load(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch { return []; }
}

function save(list: string[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* quota */ }
}

export function useRawFolders(): {
  folders: string[];
  add: (name: string) => void;
  remove: (name: string) => void;
  rename: (oldName: string, newName: string) => void;
} {
  const [folders, setFolders] = useState<string[]>([]);
  useEffect(() => { setFolders(load()); }, []);

  const add = (name: string) => {
    const cleaned = name.trim();
    if (!cleaned) return;
    setFolders((prev) => {
      if (prev.includes(cleaned)) return prev;
      const next = [...prev, cleaned];
      save(next);
      return next;
    });
  };
  const remove = (name: string) => {
    setFolders((prev) => {
      const next = prev.filter((f) => f !== name);
      save(next);
      return next;
    });
  };
  const rename = (oldName: string, newName: string) => {
    const cleaned = newName.trim();
    if (!cleaned || cleaned === oldName) return;
    setFolders((prev) => {
      const next = Array.from(new Set(prev.map((f) => (f === oldName ? cleaned : f))));
      save(next);
      return next;
    });
  };
  return { folders, add, remove, rename };
}
