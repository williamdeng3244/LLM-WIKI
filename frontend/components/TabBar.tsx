'use client';
import { Plus, X, FileText, Network, Box, FilePlus2 } from 'lucide-react';
import type { Tab } from '@/lib/tabs';

function tabMeta(t: Tab, getTitle: (path: string) => string) {
  if (t.kind === 'page') {
    return { label: getTitle(t.path), Icon: FileText };
  }
  if (t.kind === 'graph') {
    return {
      label: t.graphMode === '3d' ? 'Graph (3D)' : 'Graph (2D)',
      Icon: t.graphMode === '3d' ? Box : Network,
    };
  }
  return { label: 'New tab', Icon: FilePlus2 };
}

export default function TabBar({
  tabs, activeId, getTitle, onActivate, onClose, onNew,
}: {
  tabs: Tab[];
  activeId: string;
  getTitle: (path: string) => string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="h-9 flex items-stretch bg-panel/55 border-b border-white/[0.06] overflow-x-auto scroll-thin shrink-0">
      {tabs.map((t) => {
        const isActive = t.id === activeId;
        const { label, Icon } = tabMeta(t, getTitle);
        return (
          <div
            key={t.id}
            onClick={() => onActivate(t.id)}
            className={`group h-9 flex items-center gap-1.5 px-3 cursor-pointer border-r border-white/[0.04] min-w-[140px] max-w-[220px] text-[11.5px] transition-colors ${
              isActive
                ? 'bg-paper/40 text-ink'
                : 'text-muted hover:text-ink hover:bg-white/[0.03]'
            }`}
            onMouseDown={(e) => {
              // Middle-click to close — convention from browsers/Obsidian.
              if (e.button === 1) {
                e.preventDefault();
                onClose(t.id);
              }
            }}
          >
            <Icon size={11} className={`shrink-0 ${isActive ? 'text-accent' : ''}`} />
            <span className="flex-1 truncate">{label}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              className="opacity-0 group-hover:opacity-100 hover:bg-white/[0.10] rounded p-0.5 -mr-1 transition-opacity text-muted hover:text-ink"
              title="Close"
              aria-label="Close tab"
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
      <button
        onClick={onNew}
        className="h-9 px-3 text-muted hover:text-ink hover:bg-white/[0.03] transition-colors shrink-0"
        title="New tab (Ctrl+T)"
        aria-label="New tab"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
