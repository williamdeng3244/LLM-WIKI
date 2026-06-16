'use client';
import {
  forwardRef, useCallback, useEffect, useImperativeHandle,
  useMemo, useRef, useState,
} from 'react';
import { ChevronRight, Lock } from 'lucide-react';
import type { PageSummary } from '@/lib/api';

export type SortMode = 'asc' | 'desc';

export type FileTreeHandle = {
  collapseAll: () => void;
  expandAll: () => void;
  reveal: (path: string) => void;
};

type TreeNode = {
  name: string;
  path: string;
  isFile: boolean;
  pagePath?: string;
  stability?: string;
  children: TreeNode[];
};

function buildTree(
  pages: PageSummary[], sort: SortMode, customFolders: string[],
  folderOrder: string[] = [],
): TreeNode {
  const root: TreeNode = { name: '', path: '', isFile: false, children: [] };
  for (const p of pages) {
    const parts = p.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const segPath = parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.path === segPath);
      if (!child) {
        child = {
          name: isLast ? p.title : part, path: segPath,
          isFile: isLast, children: [],
        };
        if (isLast) {
          child.pagePath = p.path;
          child.stability = p.stability;
        }
        node.children.push(child);
      }
      node = child;
    }
  }
  // Append empty placeholder folders for any user-created folder, at
  // arbitrary nesting depth. We walk each segment so a custom folder
  // like `meetings/hr-team` creates BOTH the `meetings` parent node
  // (if no page lives there) AND the `hr-team` child. Existing folder
  // nodes from page paths are reused so we don't duplicate them.
  for (const f of customFolders) {
    const parts = f.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const segPath = parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.path === segPath && !c.isFile);
      if (!child) {
        child = { name: parts[i], path: segPath, isFile: false, children: [] };
        node.children.push(child);
      }
      node = child;
    }
  }
  // Default sort: folders first, then alphabetical by name with the
  // file sort applied to file rows.
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      const cmp = a.name.localeCompare(b.name);
      return a.isFile && sort === 'desc' ? -cmp : cmp;
    });
    n.children.forEach(sortRec);
  };
  sortRec(root);
  // After alphabetical pass, lift any folders that the user has
  // explicitly ordered (drag-to-reorder) to the top in their chosen
  // sequence. Only applied at the root — nested folders keep
  // alphabetical because reordering nested folders is more confusing
  // than helpful at this point.
  if (folderOrder.length > 0) {
    const rank = new Map(folderOrder.map((p, i) => [p, i]));
    root.children.sort((a, b) => {
      const ra = rank.get(a.path);
      const rb = rank.get(b.path);
      // Files always stay below folders regardless of explicit order.
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return a.name.localeCompare(b.name);
    });
  }
  return root;
}

// Collect every folder path in the tree (used by expandAll).
function collectFolderPaths(node: TreeNode, out: string[] = []): string[] {
  for (const c of node.children) {
    if (!c.isFile) {
      out.push(c.path);
      collectFolderPaths(c, out);
    }
  }
  return out;
}

export type ContextMenuInfo =
  | { kind: 'file'; x: number; y: number; name: string; pagePath: string; stability?: string }
  | { kind: 'folder'; x: number; y: number; name: string; folderPath: string; isEmpty: boolean };

// Stable rainbow color index (0-6) per note path, for the Rainbow theme's
// colored file tree. Deterministic so a note keeps its color across renders.
// Only consumed by CSS under [data-theme-id="rainbow"]; inert for other themes.
function rainbowIndex(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 7;
}

function NodeRow({
  node, selected, onSelect, openSet, toggleOpen, onContextMenu, onHover,
}: {
  node: TreeNode;
  selected: string | null;
  onSelect: (path: string) => void;
  openSet: Set<string>;
  toggleOpen: (k: string) => void;
  onContextMenu?: (info: ContextMenuInfo) => void;
  // Hover signal to the graph view: emit the folder prefix being hovered
  // (or the file's own path for files) so the graph can light up the
  // corresponding nodes. Pass null on leave.
  onHover?: (info: { kind: 'file' | 'folder'; path: string } | null) => void;
}) {
  if (node.isFile) {
    const isSel = node.pagePath === selected;
    const locked = node.stability === 'locked';
    return (
      <button
        data-path={node.pagePath}
        data-rainbow={rainbowIndex(node.pagePath || node.name)}
        title={node.name}
        className={`w-full text-left px-2 py-[3px] rounded text-[0.8929rem] flex items-center gap-1.5 transition-colors ${
          isSel
            ? 'bg-accent/[0.18] text-ink font-medium'
            : 'hover:bg-white/[0.05] text-muted hover:text-ink'
        }`}
        onClick={() => onSelect(node.pagePath!)}
        onMouseEnter={() => onHover?.({ kind: 'file', path: node.pagePath! })}
        onMouseLeave={() => onHover?.(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu?.({
            kind: 'file',
            x: e.clientX, y: e.clientY,
            name: node.name,
            pagePath: node.pagePath!,
            stability: node.stability,
          });
        }}
      >
        <span className="w-3 shrink-0" />
        <span className="flex-1 truncate">{node.name}</span>
        {locked && <Lock size={10} className="shrink-0 text-muted/70" />}
      </button>
    );
  }
  const open = openSet.has(node.path);
  return (
    <div>
      <button
        data-rainbow={rainbowIndex(node.path || node.name)}
        title={node.name || 'Wiki'}
        className="w-full text-left px-2 py-[3px] rounded text-[0.8929rem] font-medium flex items-center gap-1.5 hover:bg-white/[0.05] text-ink select-none transition-colors"
        onClick={() => toggleOpen(node.path)}
        onMouseEnter={() => onHover?.({ kind: 'folder', path: node.path })}
        onMouseLeave={() => onHover?.(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu?.({
            kind: 'folder',
            x: e.clientX, y: e.clientY,
            name: node.name,
            folderPath: node.path,
            isEmpty: node.children.length === 0,
          });
        }}
      >
        <ChevronRight
          size={12}
          className={`shrink-0 text-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        <span className="flex-1 truncate">{node.name || 'Wiki'}</span>
      </button>
      {open && node.children.length > 0 && (
        <div className="ml-[10px] pl-[8px] border-l border-white/[0.06]">
          {node.children.map((c) => (
            <NodeRow
              key={c.path}
              node={c}
              selected={selected}
              onSelect={onSelect}
              openSet={openSet}
              toggleOpen={toggleOpen}
              onContextMenu={onContextMenu}
              onHover={onHover}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PendingFolderRow({
  initial, onConfirm, onCancel,
}: {
  initial: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const settle = useCallback((value: string) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const v = value.trim();
    if (v) onConfirm(v); else onCancel();
  }, [onConfirm, onCancel]);

  return (
    <div className="flex items-center gap-1.5 px-2 py-[3px]">
      <ChevronRight size={12} className="shrink-0 text-muted" />
      <input
        ref={inputRef}
        defaultValue={initial}
        className="flex-1 bg-elev/80 border border-accent/60 rounded px-1.5 py-[1px] text-[0.8929rem] outline-none text-ink focus:border-accent focus:shadow-[0_0_0_2px_rgba(124,156,255,0.18)]"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            settle((e.target as HTMLInputElement).value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            settledRef.current = true;
            onCancel();
          }
        }}
        onBlur={(e) => settle(e.currentTarget.value)}
      />
    </div>
  );
}

const FileTree = forwardRef<FileTreeHandle, {
  pages: PageSummary[];
  selected: string | null;
  onSelect: (path: string) => void;
  sort?: SortMode;
  customFolders?: string[];
  pendingFolder?: { initial: string } | null;
  onPendingFolderConfirm?: (name: string) => void;
  onPendingFolderCancel?: () => void;
  onOpenChange?: (count: number) => void;
  onContextMenu?: (info: ContextMenuInfo) => void;
  // Hover bridge: fires for every row mouseenter/mouseleave. Page.tsx
  // forwards this to GraphView so hovering a folder/file in the tree
  // lights up the corresponding node(s) in the graph.
  onHover?: (info: { kind: 'file' | 'folder'; path: string } | null) => void;
  /** Optional manual ordering of top-level folders (drag-to-reorder).
   *  Folders listed here render in this order before the rest sort
   *  alphabetically. */
  folderOrder?: string[];
  /** Fires when the user drops folder `draggedPath` immediately
   *  before folder `targetPath`. Parent persists; FileTree just
   *  surfaces the event. */
  onReorderFolders?: (draggedPath: string, targetPath: string) => void;
}>(function FileTree({
  pages, selected, onSelect,
  sort = 'asc',
  customFolders = [],
  pendingFolder = null,
  onPendingFolderConfirm,
  onPendingFolderCancel,
  onOpenChange,
  onContextMenu,
  onHover,
  folderOrder = [],
  onReorderFolders,
}, ref) {
  const tree = useMemo(
    () => buildTree(pages, sort, customFolders, folderOrder),
    [pages, sort, customFolders, folderOrder],
  );
  const [openSet, setOpenSet] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const c of tree.children) if (!c.isFile) s.add(c.path);
    return s;
  });
  const rootRef = useRef<HTMLDivElement>(null);

  // Top-level folder reorder via drag. Local state holds the drag
  // source while a drop target is under the cursor; we don't store
  // the dragged path in dataTransfer alone because Firefox refuses
  // to expose its value during dragover for security reasons.
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  const [dropOnFolder, setDropOnFolder] = useState<string | null>(null);
  const canReorder = !!onReorderFolders;

  // Notify parent on open-state change so the toolbar can flip
  // collapse-all ↔ expand-all without lifting state.
  useEffect(() => {
    onOpenChange?.(openSet.size);
  }, [openSet, onOpenChange]);

  const toggle = useCallback((k: string) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  useImperativeHandle(ref, () => ({
    collapseAll() { setOpenSet(new Set()); },
    expandAll() { setOpenSet(new Set(collectFolderPaths(tree))); },
    reveal(path: string) {
      const parts = path.split('/');
      const ancestors: string[] = [];
      for (let i = 0; i < parts.length - 1; i++) {
        ancestors.push(parts.slice(0, i + 1).join('/'));
      }
      setOpenSet((prev) => {
        const next = new Set(prev);
        for (const a of ancestors) next.add(a);
        return next;
      });
      setTimeout(() => {
        const el = rootRef.current?.querySelector(
          `[data-path="${CSS.escape(path)}"]`,
        ) as HTMLElement | null;
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 60);
    },
  }), [tree]);

  return (
    <div ref={rootRef} className="file-tree py-2">
      {pendingFolder && onPendingFolderConfirm && onPendingFolderCancel && (
        <PendingFolderRow
          initial={pendingFolder.initial}
          onConfirm={onPendingFolderConfirm}
          onCancel={onPendingFolderCancel}
        />
      )}
      {tree.children.map((c) => {
        // Only top-level FOLDERS are draggable. Files stay as-is (no
        // tree-reorder gesture for them; users move files via the
        // right-click "Move file to…" dialog). Wrap the folder row in
        // a drop-aware div that handles reorder events at this level.
        const isReorderable = !c.isFile && canReorder;
        const draggingThis = dragFolder === c.path;
        const dropHere = dropOnFolder === c.path && dragFolder && dragFolder !== c.path;
        return (
          <div
            key={c.path}
            draggable={isReorderable}
            onDragStart={isReorderable ? (e) => {
              setDragFolder(c.path);
              // Firefox requires dataTransfer to have SOMETHING set or
              // the drag is aborted; we use the React-state path as
              // the source of truth and only use dataTransfer to
              // signal "this is a folder drag".
              e.dataTransfer.setData('text/x-wiki-folder', c.path);
              e.dataTransfer.effectAllowed = 'move';
            } : undefined}
            onDragEnd={isReorderable ? () => {
              setDragFolder(null);
              setDropOnFolder(null);
            } : undefined}
            onDragOver={isReorderable ? (e) => {
              if (!dragFolder || dragFolder === c.path) return;
              e.preventDefault();          // required to allow drop
              e.dataTransfer.dropEffect = 'move';
              if (dropOnFolder !== c.path) setDropOnFolder(c.path);
            } : undefined}
            onDragLeave={isReorderable ? () => {
              if (dropOnFolder === c.path) setDropOnFolder(null);
            } : undefined}
            onDrop={isReorderable ? (e) => {
              e.preventDefault();
              const src = dragFolder;
              setDragFolder(null);
              setDropOnFolder(null);
              if (src && src !== c.path) onReorderFolders?.(src, c.path);
            } : undefined}
            className={`${draggingThis ? 'opacity-40' : ''} ${
              dropHere ? 'relative before:absolute before:left-1.5 before:right-1.5 before:-top-px before:h-0.5 before:bg-accent before:rounded-full' : ''
            }`}
          >
            <NodeRow
              node={c}
              selected={selected}
              onSelect={onSelect}
              openSet={openSet}
              toggleOpen={toggle}
              onContextMenu={onContextMenu}
              onHover={onHover}
            />
          </div>
        );
      })}
    </div>
  );
});

export default FileTree;
