'use client';
import { useCallback, useEffect, useState } from 'react';

export type Tab =
  | { id: string; kind: 'page'; path: string }
  | { id: string; kind: 'graph'; graphMode: '2d' | '3d' }
  | { id: string; kind: 'new' };

const KEY = 'wiki:tabs';

function makeId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultState(): { tabs: Tab[]; activeId: string } {
  const id = makeId();
  return { tabs: [{ id, kind: 'new' }], activeId: id };
}

function load(): { tabs: Tab[]; activeId: string } {
  if (typeof window === 'undefined') return defaultState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return defaultState();
    return parsed;
  } catch { return defaultState(); }
}

function save(state: { tabs: Tab[]; activeId: string }) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
}

export function useTabs() {
  const [state, setState] = useState<{ tabs: Tab[]; activeId: string }>(defaultState);

  useEffect(() => { setState(load()); }, []);

  const update = useCallback((
    updater: (s: { tabs: Tab[]; activeId: string }) => { tabs: Tab[]; activeId: string },
  ) => {
    setState((prev) => {
      const next = updater(prev);
      save(next);
      return next;
    });
  }, []);

  const active: Tab | null = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0] ?? null;

  const openPage = useCallback((path: string, asNewTab = false) => {
    update((s) => {
      if (asNewTab) {
        const nt: Tab = { id: makeId(), kind: 'page', path };
        return { tabs: [...s.tabs, nt], activeId: nt.id };
      }
      const tabs: Tab[] = s.tabs.map((t) =>
        t.id === s.activeId ? { id: t.id, kind: 'page', path } : t
      );
      return { tabs, activeId: s.activeId };
    });
  }, [update]);

  const openGraph = useCallback((mode: '2d' | '3d', asNewTab = false) => {
    update((s) => {
      if (asNewTab) {
        const nt: Tab = { id: makeId(), kind: 'graph', graphMode: mode };
        return { tabs: [...s.tabs, nt], activeId: nt.id };
      }
      const activeTab = s.tabs.find((t) => t.id === s.activeId);
      if (activeTab?.kind === 'graph') {
        const tabs: Tab[] = s.tabs.map((t) =>
          t.id === s.activeId ? { id: t.id, kind: 'graph', graphMode: mode } : t
        );
        return { tabs, activeId: s.activeId };
      }
      // Reuse an existing graph tab if one exists; else replace active.
      const existingGraph = s.tabs.find((t) => t.kind === 'graph');
      if (existingGraph) {
        const tabs: Tab[] = s.tabs.map((t) =>
          t.id === existingGraph.id ? { id: t.id, kind: 'graph', graphMode: mode } : t
        );
        return { tabs, activeId: existingGraph.id };
      }
      const tabs: Tab[] = s.tabs.map((t) =>
        t.id === s.activeId ? { id: t.id, kind: 'graph', graphMode: mode } : t
      );
      return { tabs, activeId: s.activeId };
    });
  }, [update]);

  const newTab = useCallback(() => {
    update((s) => {
      const id = makeId();
      return { tabs: [...s.tabs, { id, kind: 'new' }], activeId: id };
    });
  }, [update]);

  const closeTab = useCallback((id: string) => {
    update((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return s;
      const remaining = s.tabs.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        const nid = makeId();
        return { tabs: [{ id: nid, kind: 'new' }], activeId: nid };
      }
      const activeId = s.activeId === id
        ? remaining[Math.max(0, idx - 1)].id
        : s.activeId;
      return { tabs: remaining, activeId };
    });
  }, [update]);

  const activate = useCallback((id: string) => {
    update((s) => ({ ...s, activeId: id }));
  }, [update]);

  return {
    tabs: state.tabs,
    activeId: state.activeId,
    active,
    openPage,
    openGraph,
    newTab,
    closeTab,
    activate,
  };
}
