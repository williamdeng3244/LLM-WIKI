'use client';
import { useEffect, useState } from 'react';

// Folders in this app are virtual (computed from page-path prefixes), but
// users want to create empty top-level categories before any pages exist
// in them. We persist a list of "custom" folder names in localStorage and
// merge them into the tree as empty folder nodes.
const KEY = 'wiki:custom-folders';

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

export function useCustomFolders(): {
  folders: string[];
  add: (name: string) => void;
  remove: (name: string) => void;
} {
  const [folders, setFolders] = useState<string[]>([]);
  useEffect(() => { setFolders(load()); }, []);

  const add = (name: string) => {
    const clean = name.trim().replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
    if (!clean) return;
    setFolders((prev) => {
      if (prev.includes(clean)) return prev;
      const next = [...prev, clean];
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

  return { folders, add, remove };
}
