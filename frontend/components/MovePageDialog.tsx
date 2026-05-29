'use client';
import { useEffect, useMemo, useState } from 'react';
import { X, FolderInput, Loader2, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

// Local tree node used only by the folder picker. We rebuild it from
// the flat list of folder paths because the parent doesn't have an
// API for "get me a folder tree" — and computing it locally keeps the
// dialog independent of FileTree's own buildTree.
type FolderNode = {
  path: string;       // full slash path, '' for root
  name: string;       // last segment (or 'root')
  children: FolderNode[];
};

function buildFolderTree(folderPaths: string[]): FolderNode {
  const root: FolderNode = { path: '', name: '', children: [] };
  const sorted = [...folderPaths].sort();
  for (const p of sorted) {
    const parts = p.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const segPath = parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.path === segPath);
      if (!child) {
        child = { path: segPath, name: parts[i], children: [] };
        node.children.push(child);
      }
      node = child;
    }
  }
  return root;
}

/** Move a page to another folder.
 *
 * Filename is preserved automatically — the dialog only chooses the
 * destination folder. So `concepts/foo.md` moved into folder `people/`
 * becomes `people/foo.md`. The "(root)" option moves the file out of
 * any folder. */
export default function MovePageDialog({
  page, allPaths, customFolders, onClose, onConfirm,
}: {
  page: { path: string; title: string };
  allPaths: Set<string>;
  customFolders: readonly string[];
  onClose: () => void;
  onConfirm: (newPath: string) => Promise<void> | void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string>('');

  // Folder paths to pick from: every path-prefix that exists in any
  // page's path, plus every nested segment from those prefixes (so
  // we surface intermediate folders even if no page sits directly
  // inside them), plus user-created custom folders.
  const folderTree = useMemo(() => {
    const set = new Set<string>();
    const addAllPrefixes = (p: string) => {
      const parts = p.split('/').filter(Boolean);
      // Up to but not including the last segment — that segment is the file.
      for (let i = 1; i < parts.length; i++) {
        set.add(parts.slice(0, i).join('/'));
      }
    };
    for (const p of allPaths) addAllPrefixes(p);
    for (const f of customFolders) {
      // Custom folders are pure-folder paths — include all prefix levels
      // so a path like `meeting-notes/hr/q3` exposes its parents too.
      const parts = f.split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        set.add(parts.slice(0, i).join('/'));
      }
    }
    return buildFolderTree(Array.from(set));
  }, [allPaths, customFolders]);

  // Expand every node that is an ancestor of the page's current
  // folder so the user can see context immediately.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const out = new Set<string>(['']);
    const cur = page.path.split('/').slice(0, -1);
    for (let i = 0; i < cur.length; i++) {
      out.add(cur.slice(0, i + 1).join('/'));
    }
    return out;
  });
  const toggle = (p: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });

  const currentFolder = page.path.lastIndexOf('/') > 0
    ? page.path.slice(0, page.path.lastIndexOf('/'))
    : '';

  // Esc closes; body scroll lock.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const filename = useMemo(() => {
    const i = page.path.lastIndexOf('/');
    return i >= 0 ? page.path.slice(i + 1) : page.path;
  }, [page.path]);

  const newPath = target ? `${target}/${filename}` : filename;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await onConfirm(newPath);
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
         onClick={onClose}>
      <div
        className="bg-panel border border-line rounded-lg w-[460px] max-w-[92vw] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-black/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderInput size={14} className="text-accent" />
            <h3 className="font-medium text-[1rem]">{t('movePage.title')}</h3>
          </div>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="text-[0.8214rem] text-muted">
            {t('movePage.description').replace('{title}', page.title)}
          </div>

          <div>
            <div className="text-[0.7143rem] uppercase tracking-[0.12em] text-muted mb-1.5">
              {t('movePage.target')}
            </div>
            {/* Collapsible folder tree. The root (no folder) is always
                offered as a target. Sub-folders expand on chevron
                click so a deep tree doesn't dominate the dialog. */}
            <div className="max-h-[260px] overflow-y-auto scroll-thin border border-white/[0.08] rounded bg-black/15 py-1">
              <FolderTreeRow
                node={folderTree}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                selected={target}
                onSelect={setTarget}
                currentFolder={currentFolder}
                t={t}
                isRoot
              />
            </div>
          </div>

          <div className="text-[0.7857rem] text-muted">
            {t('movePage.preview')}{' '}
            <code className="text-ink/85 bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">
              {newPath}
            </code>
          </div>

          {error && (
            <div className="text-[0.8214rem] bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2 rounded">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 pb-4 pt-2 border-t border-black/10 flex items-center justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={busy}>
            {t('movePage.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={busy || newPath === page.path}
          >
            {busy
              ? <><Loader2 size={13} className="animate-spin" /> {t('movePage.moving')}</>
              : t('movePage.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Recursive row for the folder tree picker. Children render with
 *  increased left padding so depth is visible. Clicking the row
 *  body selects the folder; clicking the chevron expands/collapses
 *  children without disturbing the selection. */
function FolderTreeRow({
  node, depth, expanded, onToggle, selected, onSelect, currentFolder, t, isRoot = false,
}: {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selected: string;
  onSelect: (path: string) => void;
  currentFolder: string;
  // Match useLanguage's strict literal-keys signature so the call
  // site doesn't widen back to plain (k: string) => string.
  t: ReturnType<typeof useLanguage>['t'];
  isRoot?: boolean;
}) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selected === node.path;
  const isCurrent = node.path === currentFolder;
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className={`flex items-center gap-1 pr-2 py-[3px] text-[0.8929rem] cursor-pointer transition-colors ${
          isSelected
            ? 'bg-accent/[0.20] text-ink'
            : isCurrent
              ? 'text-muted/50 cursor-not-allowed'
              : 'text-muted hover:bg-white/[0.05] hover:text-ink'
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => { if (!isCurrent) onSelect(node.path); }}
        title={isCurrent ? 'Current folder' : node.path || '(root)'}
      >
        {hasChildren ? (
          <button
            className="w-3.5 h-3.5 grid place-items-center shrink-0 text-muted hover:text-ink"
            onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              size={11}
              className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
            />
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isExpanded
          ? <FolderOpen size={12} className="shrink-0 text-muted/80" />
          : <Folder size={12} className="shrink-0 text-muted/80" />}
        <span className="truncate flex-1">
          {isRoot ? t('movePage.root') : node.name}
        </span>
      </div>
      {isExpanded && node.children.map((c) => (
        <FolderTreeRow
          key={c.path}
          node={c}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          selected={selected}
          onSelect={onSelect}
          currentFolder={currentFolder}
          t={t}
        />
      ))}
    </div>
  );
}
