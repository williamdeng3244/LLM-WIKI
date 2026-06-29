'use client';
import { useState } from 'react';
import useSWR from 'swr';
import {
  ChevronRight, FileText, FileImage, FileType, Upload, FolderInput, Folder,
  FolderPlus, Pencil, Trash2,
} from 'lucide-react';
import { api, type RawSource } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import { useRawFolders } from '@/lib/rawFolders';
import ContextMenu, { type MenuItem } from './ContextMenu';

function iconFor(mime: string) {
  if (mime.startsWith('image/')) return FileImage;
  if (mime === 'application/pdf') return FileType;
  return FileText;
}

// The one category the backend assigns automatically (on a successful
// ingest); it gets a localized label. Every other folder is user-created
// (persisted via useRawFolders) and shows exactly as typed.
const ARCHIVE = 'archive';

/** "Raw Sources" tree section — lists the uploaded originals, organized
 *  into folders the user creates by right-clicking 原始资料 (→ New folder)
 *  or a folder (→ New / Rename / Delete). Clicking a row opens the file in
 *  a new tab; the per-row move button reassigns its folder via a shared
 *  ContextMenu (portals to <body>, so it's never clipped by the sidebar's
 *  scroll area). The "archive" folder auto-fills when a source's ingest
 *  completes. Shares the SWR key 'raw-sources' with SourcesPanel. */
export default function SourcesTreeSection({
  enabled, onOpenPanel, onOpenMarkdown,
}: {
  enabled: boolean;
  onOpenPanel: () => void;
  /** Open a markdown source in-app (rendered in a tab) instead of a new
   *  browser tab. PDFs/images still open externally. */
  onOpenMarkdown?: (s: RawSource) => void;
}) {
  const { t } = useLanguage();
  const rawFolders = useRawFolders();
  const [open, setOpen] = useState(true);
  // Folders are open by default; this set tracks the ones collapsed.
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  // One menu drives section (no source/folder), folder (folder set), and
  // per-source move (source set) — all via the viewport-aware ContextMenu.
  const [ctx, setCtx] = useState<
    { x: number; y: number; folder?: string; source?: RawSource } | null
  >(null);
  const { data: sources = [], mutate } = useSWR<RawSource[]>(
    enabled ? 'raw-sources' : null, api.listRawSources,
    { revalidateOnFocus: false },
  );

  const catLabel = (cat: string): string =>
    (cat === ARCHIVE ? t('tree.rawCat.archive') : cat);

  const uncategorized = sources.filter((s) => !s.category);
  // Folders shown = user-created (persisted) ∪ emergent (a source's
  // category, e.g. auto-"archive"), de-duplicated, persisted-first.
  const present = Array.from(
    new Set(sources.map((s) => s.category).filter(Boolean) as string[]),
  );
  const folders = Array.from(new Set([...rawFolders.folders, ...present]));

  async function move(s: RawSource, category: string) {
    if ((s.category || '') === category) return;
    try { await api.updateRawSource(s.id, { category }); }
    finally { await mutate(); }
  }

  function toggleFolder(key: string) {
    setClosedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function promptNewFolder() {
    const name = window.prompt(t('tree.rawCat.newPrompt'), '');
    const clean = (name || '').trim();
    if (clean) rawFolders.add(clean);
  }

  async function renameFolder(f: string) {
    const name = window.prompt(t('tree.rawCat.renamePrompt'), catLabel(f));
    const clean = (name || '').trim();
    if (!clean || clean === f) return;
    for (const s of sources.filter((x) => x.category === f)) {
      await api.updateRawSource(s.id, { category: clean });
    }
    rawFolders.rename(f, clean);
    await mutate();
  }

  async function deleteFolder(f: string) {
    for (const s of sources.filter((x) => x.category === f)) {
      await api.updateRawSource(s.id, { category: '' });
    }
    rawFolders.remove(f);
    await mutate();
  }

  const sectionMenu: MenuItem[] = [
    { kind: 'item', label: t('tree.rawCat.newFolder'), icon: <FolderPlus size={13} />, onClick: promptNewFolder },
  ];
  const folderMenu = (f: string): MenuItem[] => [
    { kind: 'item', label: t('tree.rawCat.newFolder'), icon: <FolderPlus size={13} />, onClick: promptNewFolder },
    { kind: 'item', label: t('tree.rawCat.rename'), icon: <Pencil size={13} />, onClick: () => renameFolder(f) },
    { kind: 'divider' },
    { kind: 'item', label: t('tree.rawCat.delete'), icon: <Trash2 size={13} />, danger: true, onClick: () => deleteFolder(f) },
  ];
  const moveMenu = (s: RawSource): MenuItem[] => [
    { kind: 'item', label: t('tree.rawCat.topLevel'), checked: !s.category, onClick: () => move(s, '') },
    ...folders.map((f): MenuItem => ({
      kind: 'item', label: catLabel(f), checked: s.category === f, onClick: () => move(s, f),
    })),
    { kind: 'divider' },
    {
      kind: 'item', label: t('tree.rawCat.newFolder'), icon: <FolderPlus size={13} />,
      onClick: () => {
        const name = window.prompt(t('tree.rawCat.newPrompt'), '');
        const clean = (name || '').trim();
        if (clean) { rawFolders.add(clean); move(s, clean); }
      },
    },
  ];

  const renderRow = (s: RawSource) => {
    const Icon = iconFor(s.mime_type);
    return (
      <div key={s.id} className="group flex items-center">
        <button
          title={s.title}
          onClick={() => {
            const isMarkdown = s.mime_type === 'text/markdown'
              || /\.(md|markdown)$/i.test(s.original_filename || '');
            if (isMarkdown && onOpenMarkdown) onOpenMarkdown(s);
            else window.open(api.rawSourceViewURL(s.id), '_blank', 'noopener,noreferrer');
          }}
          className="flex-1 min-w-0 text-left px-2 py-[3px] rounded text-[0.8929rem] flex items-center gap-1.5 text-muted hover:text-ink hover:bg-white/[0.05] transition-colors"
        >
          <Icon size={12} className="shrink-0 text-accent/70" />
          <span className="flex-1 truncate">{s.title}</span>
          {s.ingest_status === 'done' && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 shrink-0" title="ingested" />
          )}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setCtx({ x: Math.round(r.right), y: Math.round(r.bottom + 4), source: s });
          }}
          title={t('tree.rawCat.moveTo')}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 px-1 text-muted hover:text-ink transition-opacity shrink-0"
        >
          <FolderInput size={12} />
        </button>
      </div>
    );
  };

  return (
    <div className="px-1.5 mt-1 mb-2">
      <button
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY }); }}
        title={t('tree.section.rawSources.open')}
        className="w-full flex items-center gap-1 px-2 py-1 text-[0.6875rem] uppercase tracking-[0.12em] text-muted/80 hover:text-ink transition-colors"
      >
        <ChevronRight size={11} className={`shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        <span className="flex-1 text-left">{t('tree.section.rawSources')}</span>
        {sources.length > 0 && <span className="text-muted/60 tracking-normal">{sources.length}</span>}
      </button>
      {open && (
        <div className="ml-[10px] pl-[8px] border-l border-white/[0.06]">
          {sources.length === 0 && folders.length === 0 ? (
            <button
              onClick={onOpenPanel}
              className="w-full text-left px-2 py-[3px] rounded text-[0.8214rem] flex items-center gap-1.5 text-muted/70 hover:text-ink hover:bg-white/[0.05] transition-colors"
            >
              <Upload size={11} className="shrink-0" />
              <span className="flex-1 truncate">{t('tree.section.rawSources.empty')}</span>
            </button>
          ) : (
            <>
              {uncategorized.map(renderRow)}
              {folders.map((f) => {
                const items = sources.filter((s) => s.category === f);
                const fopen = !closedFolders.has(f);
                return (
                  <div key={f}>
                    <button
                      onClick={() => toggleFolder(f)}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, folder: f }); }}
                      className="w-full flex items-center gap-1 px-2 py-[3px] rounded text-[0.8214rem] text-muted hover:text-ink hover:bg-white/[0.04] transition-colors"
                    >
                      <ChevronRight size={10} className={`shrink-0 transition-transform duration-150 ${fopen ? 'rotate-90' : ''}`} />
                      <Folder size={11} className="shrink-0 opacity-70" />
                      <span className="flex-1 text-left truncate">{catLabel(f)}</span>
                      {items.length > 0 && <span className="text-muted/50 text-[0.7rem]">{items.length}</span>}
                    </button>
                    {fopen && (
                      <div className="ml-[10px] pl-[8px] border-l border-white/[0.05]">
                        {items.length === 0
                          ? <div className="px-2 py-[3px] text-[0.75rem] text-muted/50 italic">{t('tree.rawCat.empty')}</div>
                          : items.map(renderRow)}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={ctx.source ? moveMenu(ctx.source) : ctx.folder !== undefined ? folderMenu(ctx.folder) : sectionMenu}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  );
}
