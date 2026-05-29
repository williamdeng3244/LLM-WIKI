'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  Bell, Plug, Pencil, Inbox, Search, BookOpen, Sliders,
  SquarePen, FolderPlus, ArrowDownAZ, ArrowDownZA,
  ChevronsDownUp, ChevronsUpDown,
  Copy, Clipboard, History, Bookmark, BookmarkCheck, FolderInput, Trash2,
  ExternalLink, FilePlus, Files, BookText, ShieldCheck, Sun, Moon, HelpCircle,
} from 'lucide-react';
import FileTree, {
  type FileTreeHandle, type SortMode, type ContextMenuInfo,
} from '@/components/FileTree';
import { useCustomFolders } from '@/lib/customFolders';
import { useFolderOrder } from '@/lib/folderOrder';
import ContextMenu, { type MenuItem } from '@/components/ContextMenu';
import VersionHistory from '@/components/VersionHistory';
import TabBar from '@/components/TabBar';
import NewTab from '@/components/NewTab';
import { useTabs } from '@/lib/tabs';
import GraphView from '@/components/GraphView';
import GraphSettings from '@/components/GraphSettings';
import PageView from '@/components/PageView';
import ProposeDialog from '@/components/ProposeDialog';
import ReviewQueue from '@/components/ReviewQueue';
import ChatPanel from '@/components/ChatPanel';
import MCPAccessPanel from '@/components/MCPAccessPanel';
import SearchResults from '@/components/SearchResults';
import NotificationsPanel from '@/components/NotificationsPanel';
import QuickSwitcher, { pushRecent } from '@/components/QuickSwitcher';
import SourcesPanel from '@/components/SourcesPanel';
import SchemaEditor from '@/components/SchemaEditor';
import LintPanel from '@/components/LintPanel';
import UserManual from '@/components/UserManual';
import ShortcutSheet from '@/components/ShortcutSheet';
import VersionLog from '@/components/VersionLog';
import LoginModal from '@/components/LoginModal';
import MovePageDialog from '@/components/MovePageDialog';
import { useTheme } from '@/lib/theme';
import { useLanguage } from '@/lib/i18n';
import { api, type Page, type Role, type User } from '@/lib/api';
import { useGraphSettings } from '@/lib/graphSettings';

// Default SWR options: don't refetch on focus everywhere, keep previous data
const SWR_OPTS = { revalidateOnFocus: false, keepPreviousData: true };

export default function Home() {
  const [user, setUser] = useState<User | null>(null);

  // Tab state replaces the old selected / centerMode / graphMode trio.
  const tabs = useTabs();
  const activeTab = tabs.active;
  const selected = activeTab?.kind === 'page' ? activeTab.path : null;

  const [showPropose, setShowPropose] = useState(false);
  // When true, ProposeDialog opens in *new* mode regardless of which page
  // the active tab is on — used by the "New note" toolbar buttons.
  const [proposeAsNew, setProposeAsNew] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();
  const { lang, toggle: toggleLang, t } = useLanguage();
  const [showSources, setShowSources] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [showLint, setShowLint] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showGraphSettings, setShowGraphSettings] = useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Chat panel collapse: hydrate from localStorage on mount, persist on
  // every flip. Mirrors the useTheme/useLanguage pattern.
  const [chatCollapsed, setChatCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('wiki:chat-collapsed');
      if (saved === '1') setChatCollapsed(true);
    } catch { /* localStorage unavailable */ }
  }, []);
  const toggleChat = useCallback(() => {
    setChatCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem('wiki:chat-collapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  // Resizable file tree (left sidebar). Width persists across reloads.
  // Bounds: 180px (cramped floor) – 480px (don't dominate the layout).
  // Default 240px matches the literal width used before this change.
  const TREE_DEFAULT_W = 240;
  const TREE_MIN_W = 180;
  const TREE_MAX_W = 480;
  const clampTreeW = (n: number) =>
    Math.max(TREE_MIN_W, Math.min(TREE_MAX_W, Math.round(n)));
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return TREE_DEFAULT_W;
    try {
      const raw = localStorage.getItem('wiki:tree-width');
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) ? clampTreeW(n) : TREE_DEFAULT_W;
    } catch { return TREE_DEFAULT_W; }
  });
  // Drag context lives in a ref so the mousemove listener reads fresh
  // values without stale-closure shenanigans, and so updating it on
  // 60–120 Hz doesn't trigger React re-renders.
  const treeDragRef = useRef<{
    startX: number; startWidth: number; lastWidth: number;
  } | null>(null);
  // Ref to the grid container so the drag can mutate --tree-w
  // directly on the DOM. Bypasses React re-renders AND bypasses the
  // grid-template-columns transition (which would otherwise tween the
  // column toward the new width over 200ms and feel ~200ms laggy).
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const startTreeDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    treeDragRef.current = {
      startX: e.clientX, startWidth: treeWidth, lastWidth: treeWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // Disable the grid-column transition for the duration of the drag —
    // otherwise every mousemove queues a 200ms tween and the column
    // never catches up to the cursor.
    const container = gridContainerRef.current;
    if (container) container.style.transition = 'none';

    const onMove = (ev: MouseEvent) => {
      const ctx = treeDragRef.current;
      if (!ctx) return;
      const next = clampTreeW(ctx.startWidth + (ev.clientX - ctx.startX));
      if (next === ctx.lastWidth) return;
      ctx.lastWidth = next;
      // Write straight to the DOM — no React state churn during the
      // gesture. State syncs once on teardown for persistence + re-
      // render correctness.
      if (container) container.style.setProperty('--tree-w', `${next}px`);
    };
    const teardown = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', teardown);
      window.removeEventListener('blur', teardown);
      document.removeEventListener('mouseleave', teardown);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (container) container.style.transition = '';
      const finalWidth = treeDragRef.current?.lastWidth ?? treeWidth;
      treeDragRef.current = null;
      // One React update at the end: persist + bring state in line
      // with the DOM so the next render doesn't snap back.
      setTreeWidth(finalWidth);
      try { localStorage.setItem('wiki:tree-width', String(finalWidth)); } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', teardown);
    window.addEventListener('blur', teardown);
    document.addEventListener('mouseleave', teardown);
  }, [treeWidth]);

  const resetTreeWidth = useCallback(() => {
    setTreeWidth(TREE_DEFAULT_W);
    try { localStorage.setItem('wiki:tree-width', String(TREE_DEFAULT_W)); } catch {}
  }, []);

  const nudgeTreeWidth = useCallback((delta: number) => {
    setTreeWidth((w) => {
      const next = clampTreeW(w + delta);
      try { localStorage.setItem('wiki:tree-width', String(next)); } catch {}
      return next;
    });
  }, []);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<FileTreeHandle>(null);

  // File-tree sort, persisted across reloads. Cycles asc → desc on click.
  const [treeSort, setTreeSort] = useState<SortMode>('asc');
  useEffect(() => {
    const saved = typeof window !== 'undefined'
      ? (localStorage.getItem('wiki:tree-sort') as SortMode | null)
      : null;
    if (saved === 'asc' || saved === 'desc') setTreeSort(saved);
  }, []);
  const cycleTreeSort = useCallback(() => {
    setTreeSort((prev) => {
      const next: SortMode = prev === 'asc' ? 'desc' : 'asc';
      try { localStorage.setItem('wiki:tree-sort', next); } catch { /* quota */ }
      return next;
    });
  }, []);

  // Pending inline-edit folder (from the New Folder toolbar button) and
  // current open-folder count (used to flip the collapse/expand toggle).
  const [pendingFolder, setPendingFolder] = useState<{ initial: string } | null>(null);
  const [treeOpenCount, setTreeOpenCount] = useState(0);
  const customFolders = useCustomFolders();
  const folderOrder = useFolderOrder();

  // File-tree right-click menu + version-history modal. Store the original
  // ContextMenuInfo (not pre-built items) so the menu re-translates when
  // language flips while it's open.
  const [ctxMenu, setCtxMenu] = useState<ContextMenuInfo | null>(null);
  const [historyForPath, setHistoryForPath] = useState<string | null>(null);

  // Tree → graph hover bridge: hovering a folder or file in the left
  // sidebar lights up the matching node(s) in the active graph view.
  const [hoveredTree, setHoveredTree] = useState<
    { kind: 'file' | 'folder'; path: string } | null
  >(null);

  const [graphSettings, setGraphSettings] = useGraphSettings();

  // Data
  const { data: pages = [], mutate: refetchPages } = useSWR('pages', api.listPages, SWR_OPTS);
  const { data: graphData, mutate: refetchGraph } = useSWR('graph', api.graph, SWR_OPTS);
  const { data: bookmarks = [], mutate: refetchBookmarks } = useSWR(
    user ? 'bookmarks' : null, api.listBookmarks, SWR_OPTS,
  );
  const bookmarkedPaths = useMemo(
    () => new Set(bookmarks.map((b) => b.page_path)),
    [bookmarks],
  );
  const { data: page = null, mutate: refetchPage } = useSWR<Page | null>(
    selected ? `page:${selected}` : null,
    () => (selected ? api.getPage(selected) : null),
    SWR_OPTS,
  );
  const { data: queue = [], mutate: refetchQueue } = useSWR('review-queue', api.reviewQueue, {
    ...SWR_OPTS, refreshInterval: 30_000,
  });
  const { data: notifications = [], mutate: refetchNotifs } = useSWR(
    'notifications', () => api.listNotifications(false),
    { ...SWR_OPTS, refreshInterval: 30_000 },
  );
  const { data: usersList = [] } = useSWR('users', api.listUsers, {
    ...SWR_OPTS, dedupingInterval: 60_000,
  });

  // Derived: O(1) lookups
  const usersById = useMemo(() => {
    const m = new Map<number, User>();
    for (const u of usersList) m.set(u.id, u);
    return m;
  }, [usersList]);

  const allPaths = useMemo(() => new Set(pages.map((p) => p.path)), [pages]);
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications],
  );

  // Identity. In stub mode the X-User-Email fallback header gets us a
  // user transparently; in oidc mode we need a real JWT in localStorage,
  // and on failure we surface the LoginModal.
  const [needsLogin, setNeedsLogin] = useState(false);

  const loadIdentity = useCallback(() => {
    setNeedsLogin(false);
    // Explicit sign-out wins over the stub auto-auth convenience.
    // The user clicked Sign out and we honor it until they log in.
    const explicitlySignedOut = typeof window !== 'undefined'
      && localStorage.getItem('wiki:signed-out') === '1';
    if (explicitlySignedOut) {
      window.location.href = '/login';
      return;
    }
    api.whoami().then((u) => { setUser(u); setNeedsLogin(false); }).catch(() => {
      api.authConfig().then((cfg) => {
        if (cfg.mode === 'oidc') {
          // Send the user to the dedicated login page rather than a
          // mid-app modal — feels more like a real sign-in.
          if (typeof window !== 'undefined') window.location.href = '/login';
          return;
        }
        // Stub mode: keep the historical "auto-admin on first load"
        // behavior so dev doesn't need to manually log in.
        if (typeof window !== 'undefined') {
          localStorage.setItem('wiki:email', 'admin@example.com');
          localStorage.setItem('wiki:role', 'admin');
          api.whoami().then(setUser).catch(() => setNeedsLogin(true));
        }
      }).catch(() => {
        if (typeof window !== 'undefined') window.location.href = '/login';
      });
    });
  }, []);

  useEffect(() => { loadIdentity(); }, [loadIdentity]);

  // Keyboard: ⌘K = search; ⌘O = quick switcher; ⌘E = suggest edit;
  // ⌘T = new tab; ⌘W = close current tab; ⌘? = shortcut sheet.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        setShowSearch(true);
      }
      if (cmd && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        setShowQuickSwitcher(true);
      }
      if (cmd && e.key === 'e' && user && user.role !== 'reader') {
        e.preventDefault();
        setShowPropose(true);
      }
      if (cmd && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        tabs.newTab();
      }
      if (cmd && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        if (tabs.activeId) tabs.closeTab(tabs.activeId);
      }
      // Shortcut sheet opens on any of:
      //   • plain `?` when nothing is being typed (Gmail / Linear convention)
      //   • ⌘/ or Ctrl+/ (works without holding Shift; many users find this easier)
      //   • ⌘? or Ctrl+? (Ctrl+Shift+/ on US layouts)
      // Match via e.code === 'Slash' too because e.key can differ across
      // layouts and OSes (some report '?', some report '/').
      {
        const target = e.target as HTMLElement | null;
        const isTyping =
          !!target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            (target as HTMLElement).isContentEditable);
        const isSlashKey =
          e.key === '/' || e.key === '?' || e.code === 'Slash';
        if (isSlashKey && (cmd || (e.key === '?' && !isTyping))) {
          e.preventDefault();
          setShowShortcuts(true);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, tabs]);

  const canReview = user && (user.role === 'admin' || user.role === 'editor');

  function changeRole(role: Role) {
    if (typeof window === 'undefined') return;
    localStorage.setItem('wiki:role', role);
    localStorage.setItem('wiki:email', `${role}@example.com`);
    localStorage.removeItem('wiki:jwt');
    window.location.reload();
  }

  // Stable callbacks (avoid breaking memoized components). Navigation now
  // routes through the tab system: clicking a file replaces the active
  // tab's content with the page, matching Obsidian's default behavior.
  const navigate = useCallback((path: string, inNewTab?: boolean) => {
    // `inNewTab` is opt-in: wikilinks inside a note default to new-tab
    // (so following a link doesn't lose your place); file-tree clicks,
    // search-result clicks, etc. pass nothing and replace the active
    // tab as before.
    tabs.openPage(path, !!inNewTab);
    setShowSearch(false);
    setShowNotifs(false);
    setShowQuickSwitcher(false);
    pushRecent(path);
  }, [tabs]);

  const getTabTitle = useCallback(
    (path: string) => pages.find((p) => p.path === path)?.title || path,
    [pages],
  );

  const onLockToggle = useCallback(async (locked: boolean) => {
    if (!page) return;
    await api.lockPage(page.path, locked);
    await Promise.all([refetchPage(), refetchPages()]);
  }, [page, refetchPage, refetchPages]);

  const handleToggleBookmark = useCallback(async (path: string, next: boolean) => {
    try {
      if (next) await api.addBookmark(path);
      else await api.removeBookmark(path);
    } catch (e) {
      console.error('bookmark toggle failed', e);
    }
    await refetchBookmarks();
  }, [refetchBookmarks]);

  // Move-page modal state. Lives at this level (rather than inside
  // PageView / the file-context-menu) so it's the SAME modal whether
  // triggered from the More-actions menu or from a tree right-click.
  const [movingPagePath, setMovingPagePath] = useState<string | null>(null);
  const movingPage = useMemo(() => {
    if (!movingPagePath) return null;
    const p = pages.find((x) => x.path === movingPagePath);
    return p ? { path: p.path, title: p.title } : null;
  }, [movingPagePath, pages]);

  const handleMovePage = useCallback(async (oldPath: string, newPath: string) => {
    const moved = await api.movePage(oldPath, newPath);
    // Refetch the lists that surface the old path so the tree, graph,
    // and bookmarks point at the new path immediately.
    await Promise.all([
      refetchPages(), refetchGraph(), refetchBookmarks(),
    ]);
    // Every tab still pointing at the old path follows the rename.
    // `selected` is derived from `activeTab.path`, so rewriting the
    // tab automatically updates the selection too — no separate
    // setter needed.
    tabs.rewritePagePath(oldPath, moved.path);
  }, [tabs, refetchPages, refetchGraph, refetchBookmarks]);

  const handleDeletePage = useCallback(async (path: string) => {
    let alreadyGone = false;
    try {
      await api.deletePage(path);
    } catch (e: unknown) {
      const msg = (e as Error).message || '';
      // 404 = the page was already deleted in another tab/session (or by
      // my own batch cleanup). Don't alarm the user — just refetch so
      // the stale tree row disappears.
      if (msg.startsWith('404')) {
        alreadyGone = true;
      } else {
        alert(`Delete failed: ${msg}`);
        return;
      }
    }
    // Close every tab pointing at the now-deleted (or already-gone) page.
    for (const tab of tabs.tabs) {
      if (tab.kind === 'page' && tab.path === path) {
        tabs.closeTab(tab.id);
      }
    }
    // Refetch every list that surfaces page rows. The server cascade
    // handles revisions/links/chunks/flags/comments/provenance/bookmarks.
    await Promise.all([
      refetchPages(), refetchGraph(), refetchBookmarks(),
    ]);
    if (alreadyGone) {
      // Light hint instead of an error — user gets feedback that
      // something happened even though it was a no-op.
      console.info(`Page ${path} was already gone — UI refreshed.`);
    }
  }, [tabs, refetchPages, refetchGraph, refetchBookmarks]);

  const refreshAfterMutation = useCallback(async () => {
    await Promise.all([
      refetchPages(), refetchGraph(), refetchPage(),
      refetchQueue(), refetchNotifs(),
    ]);
  }, [refetchPages, refetchGraph, refetchPage, refetchQueue, refetchNotifs]);

  async function copyToClipboard(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  }

  async function makePageCopy(path: string) {
    try {
      const full = await api.getPage(path);
      const newPath = `${path}-copy`;
      const draft = await api.createDraft({
        new_page: { path: newPath, stability: 'stable' },
        title: `${full.title} (copy)`,
        body: full.body,
        tags: full.tags,
        rationale: `Copy of ${path}`,
      });
      await api.submitRevision(draft.id);
      await refreshAfterMutation();
    } catch (e: unknown) {
      alert((e as Error).message);
    }
  }

  function buildFileMenu(info: Extract<ContextMenuInfo, { kind: 'file' }>): MenuItem[] {
    return [
      {
        kind: 'item',
        label: t('menu.file.openNewTab'),
        icon: <ExternalLink size={13} />,
        onClick: () => { tabs.openPage(info.pagePath, true); pushRecent(info.pagePath); },
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: t('menu.file.suggest'),
        icon: <Pencil size={13} />,
        disabled: !user || user.role === 'reader',
        hint: t('menu.file.suggest.disabled'),
        onClick: () => { navigate(info.pagePath); setShowPropose(true); },
      },
      {
        kind: 'item',
        label: t('menu.file.copy'),
        icon: <Copy size={13} />,
        disabled: !user || user.role === 'reader',
        hint: t('menu.file.copy.disabled'),
        onClick: () => { makePageCopy(info.pagePath); },
      },
      {
        kind: 'item',
        label: t('menu.file.copyPath'),
        icon: <Clipboard size={13} />,
        onClick: () => { copyToClipboard(info.pagePath); },
      },
      {
        kind: 'item',
        label: t('menu.file.history'),
        icon: <History size={13} />,
        onClick: () => { setHistoryForPath(info.pagePath); },
      },
      (() => {
        const isBm = bookmarkedPaths.has(info.pagePath);
        return {
          kind: 'item' as const,
          label: isBm ? t('menu.page.unbookmark') : t('menu.page.bookmark'),
          icon: isBm ? <BookmarkCheck size={13} /> : <Bookmark size={13} />,
          disabled: !user,
          hint: !user ? t('menu.page.bookmark.hint') : undefined,
          onClick: user ? () => handleToggleBookmark(info.pagePath, !isBm) : undefined,
        };
      })(),
      { kind: 'divider' },
      {
        kind: 'item',
        label: t('menu.file.move'),
        icon: <FolderInput size={13} />,
        // Editor or admin can move. Contributors can suggest body
        // edits but path changes are gated tighter (other people's
        // wikilinks depend on them).
        disabled: !user || (user.role !== 'admin' && user.role !== 'editor'),
        hint: !user || (user.role !== 'admin' && user.role !== 'editor')
          ? t('menu.page.move.adminOnly') : undefined,
        onClick: () => setMovingPagePath(info.pagePath),
      },
      {
        kind: 'item',
        label: t('menu.file.delete'),
        icon: <Trash2 size={13} />,
        danger: true,
        disabled: user?.role !== 'admin',
        hint: user?.role !== 'admin' ? t('menu.page.delete.adminOnly') : undefined,
        onClick: user?.role === 'admin' ? () => {
          const title = getTabTitle(info.pagePath);
          if (!confirm(t('menu.page.delete.confirm').replace('{title}', title))) return;
          handleDeletePage(info.pagePath);
        } : undefined,
      },
    ];
  }

  function buildFolderMenu(info: Extract<ContextMenuInfo, { kind: 'folder' }>): MenuItem[] {
    // A folder is "user-managed" if its full nested path is in the
    // custom-folders list (so nested folders count too, not just
    // top-level). Folders that exist only because a page lives there
    // can't be renamed or deleted via the menu — moving / deleting
    // those pages handles them implicitly.
    const isCustom = customFolders.folders.includes(info.folderPath);
    return [
      {
        kind: 'item',
        label: t('menu.folder.newNote'),
        icon: <FilePlus size={13} />,
        disabled: !user || user.role === 'reader',
        onClick: () => {
          // Open ProposeDialog in new mode; the user fills in the path.
          setProposeAsNew(true);
          setShowPropose(true);
        },
      },
      {
        kind: 'item',
        label: t('menu.folder.newSubfolder'),
        icon: <FolderPlus size={13} />,
        disabled: !user || user.role === 'reader',
        onClick: () => {
          const child = window.prompt(
            t('menu.folder.newSubfolder.prompt').replace('{parent}', info.folderPath),
            '',
          );
          const clean = (child || '').trim()
            .replace(/^\/+|\/+$/g, '')
            .replace(/\/+/g, '/');
          if (!clean) return;
          customFolders.add(`${info.folderPath}/${clean}`);
        },
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: t('menu.folder.rename'),
        icon: <Pencil size={13} />,
        disabled: !isCustom,
        hint: isCustom ? undefined : t('menu.folder.rename.disabled'),
        onClick: () => {
          const next = window.prompt(t('menu.folder.rename.prompt'), info.name);
          // Allow `/` so the rename can itself be a relocate-within-
          // tree action (e.g. "hr" → "people/hr"). Strip leading/
          // trailing slashes and reject `..` segments.
          const cleanSegment = (next || '').trim()
            .replace(/^\/+|\/+$/g, '')
            .replace(/\/+/g, '/');
          if (!cleanSegment || cleanSegment === info.name) return;
          if (cleanSegment.split('/').some((s) => s === '..' || s === '.')) return;
          // Rebuild the full path: replace the LAST segment of the
          // existing folder path with the user-provided value. If the
          // user typed a slash, the new value's full content replaces
          // the last segment.
          const parentParts = info.folderPath.split('/').slice(0, -1);
          const newPath = parentParts.length > 0
            ? `${parentParts.join('/')}/${cleanSegment}`
            : cleanSegment;
          customFolders.remove(info.folderPath);
          customFolders.add(newPath);
        },
      },
      {
        kind: 'item',
        label: t('menu.folder.copyPath'),
        icon: <Clipboard size={13} />,
        onClick: () => { copyToClipboard(info.folderPath); },
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: t('menu.folder.delete'),
        icon: <Trash2 size={13} />,
        danger: true,
        disabled: !isCustom || !info.isEmpty,
        hint: !isCustom
          ? t('menu.folder.delete.notCustom')
          : !info.isEmpty
            ? t('menu.folder.delete.notEmpty')
            : undefined,
        onClick: () => { customFolders.remove(info.folderPath); },
      },
    ];
  }

  const onTreeContextMenu = useCallback((info: ContextMenuInfo) => {
    setCtxMenu(info);
  }, []);

  // Handle notification link clicks — they look like /pages/<path> or /review/<id>
  const onNotificationLink = useCallback((link: string) => {
    if (link.startsWith('/pages/')) {
      navigate(link.slice('/pages/'.length));
    } else if (link.startsWith('/review/')) {
      setShowReview(true);
    }
    setShowNotifs(false);
  }, [navigate]);

  return (
    <div className="relative z-10 h-screen flex flex-col">
      {/* Top bar */}
      <header className="h-12 border-b border-white/[0.06] bg-panel/85 backdrop-blur flex items-center px-3 gap-3 text-[0.9286rem] relative z-20">
        <div className="flex items-center gap-2 px-2">
          <BookOpen size={16} className="text-accent" />
          <span className="font-display font-medium tracking-[0.02em] text-[1rem] text-ink">{t('topbar.brand')}</span>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-xl mx-2 relative">
          <div className="relative">
            <input
              ref={searchInputRef}
              className="form-input h-8 pl-3 pr-16 text-[0.9286rem]"
              placeholder={t('topbar.search.placeholder')}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearch(true);
              }}
              onFocus={() => setShowSearch(true)}
            />
            <kbd className="absolute right-9 top-1/2 -translate-y-1/2 text-[0.7143rem] text-muted bg-black/5 border border-black/10 rounded px-1.5 py-0.5 font-mono pointer-events-none">
              ⌘K
            </kbd>
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          </div>
          {showSearch && (
            <SearchResults
              query={searchQuery}
              onClose={() => setShowSearch(false)}
              onSelect={(path) => {
                navigate(path);
                setSearchQuery('');
              }}
            />
          )}
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            className="btn btn-icon"
            onClick={toggleTheme}
            title={theme === 'dark' ? t('topbar.theme.toLight') : t('topbar.theme.toDark')}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          {/* Language toggle. Single button, label is the *other* language so
              the click target tells you what you'll switch to. */}
          <button
            className="btn btn-icon font-mono text-[0.7857rem] tracking-tight px-1.5"
            onClick={toggleLang}
            title={t('topbar.lang.toggle.title')}
            aria-label="Toggle language"
          >
            {lang === 'en' ? '中' : 'EN'}
          </button>
          {/* Dev: role switcher */}
          <select
            className="h-8 px-2 text-[0.8214rem] border border-line rounded-md bg-elev text-ink"
            value={user?.role || 'admin'}
            onChange={(e) => changeRole(e.target.value as Role)}
            title={t('topbar.role.title')}
          >
            <option value="reader">{t('topbar.role.reader')}</option>
            <option value="contributor">{t('topbar.role.contributor')}</option>
            <option value="editor">{t('topbar.role.editor')}</option>
            <option value="admin">{t('topbar.role.admin')}</option>
          </select>
          {user && (
            <button
              className="h-8 px-2 text-[0.8214rem] border border-line rounded-md bg-elev text-muted hover:text-ink"
              title={`Sign out (${user.email})`}
              onClick={() => {
                if (typeof window === 'undefined') return;
                localStorage.removeItem('wiki:jwt');
                localStorage.removeItem('wiki:email');
                localStorage.removeItem('wiki:role');
                // Block the stub-mode auto-re-auth so sign-out actually
                // signs the user out. Cleared on next successful login.
                localStorage.setItem('wiki:signed-out', '1');
                fetch(`${process.env.NEXT_PUBLIC_API_BASE || '/api'}/auth/logout`, {
                  method: 'POST', credentials: 'include',
                }).finally(() => { window.location.href = '/login'; });
              }}
            >
              Sign out
            </button>
          )}

          {user && user.role !== 'reader' && (
            <button
              className="btn btn-primary"
              onClick={() => setShowPropose(true)}
              title={t('topbar.suggest.title')}
            >
              <Pencil size={13} /> {t('topbar.suggest')}
            </button>
          )}

          {canReview && (
            <button
              className="btn relative"
              onClick={() => setShowReview(true)}
              title={t('topbar.review.title')}
            >
              <Inbox size={13} />
              {queue.length > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-amber-500 text-white text-[0.7143rem] font-medium">
                  {queue.length}
                </span>
              )}
            </button>
          )}

          <div className="relative">
            <button
              className="btn btn-icon relative"
              onClick={() => setShowNotifs((s) => !s)}
              title={t('topbar.notifications.title')}
            >
              <Bell size={14} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[0.7143rem] font-medium">
                  {unreadCount}
                </span>
              )}
            </button>
            {showNotifs && (
              <NotificationsPanel
                notifications={notifications}
                onClose={() => setShowNotifs(false)}
                onMarkRead={async (id) => {
                  await api.markRead(id);
                  refetchNotifs();
                }}
                onMarkAllRead={async () => {
                  await api.markAllRead();
                  refetchNotifs();
                }}
                onLink={onNotificationLink}
              />
            )}
          </div>

          <button
            className="btn btn-icon"
            onClick={() => setShowSources(true)}
            title={t('topbar.sources.title')}
          >
            <Files size={14} />
          </button>

          <button
            className="btn btn-icon"
            onClick={() => setShowSchema(true)}
            title={t('topbar.schema.title')}
          >
            <BookText size={14} />
          </button>

          {user?.role === 'admin' && (
            <button
              className="btn btn-icon"
              onClick={() => setShowLint(true)}
              title={t('topbar.lint.title')}
            >
              <ShieldCheck size={14} />
            </button>
          )}

          <button
            className="btn btn-icon"
            onClick={() => setShowMcp(true)}
            title={t('topbar.mcp.title')}
          >
            <Plug size={14} />
          </button>

          <div className="relative">
            <button
              className="btn btn-icon"
              onClick={() => setShowManual((s) => !s)}
              title={t('topbar.manual.title')}
              aria-label={t('topbar.manual.ariaLabel')}
            >
              <HelpCircle size={14} />
            </button>
            {showManual && (
              <UserManual onClose={() => setShowManual(false)} />
            )}
          </div>

          <div className="text-[0.8214rem] text-muted ml-1.5 truncate max-w-[120px]" title={user?.email}>
            {user?.name || '…'}
          </div>
        </div>
      </header>

      {/* Three-pane body. Tree column widened from 224 to 240 for long titles;
          chat column flips between 320 (expanded) and 40 (collapsed rail).
          grid-template-columns transitions smoothly via Tailwind arbitrary
          transition-property so the swap interpolates cleanly. */}
      <div
        ref={gridContainerRef}
        className="flex-1 grid min-h-0 overflow-hidden transition-[grid-template-columns] duration-200 ease-out relative"
        style={{
          // CSS vars so the tree-resize gutter can position itself
          // off the same value the grid uses for the tree column —
          // no React state needed to keep them in sync.
          ['--tree-w' as string]: `${treeWidth}px`,
          ['--chat-w' as string]: chatCollapsed ? '40px' : '320px',
          gridTemplateColumns: 'var(--tree-w) 1fr var(--chat-w)',
          // Pin row height to the available space. Without this, the
          // implicit grid row defaults to `auto` which sizes to
          // content — so a tall chat panel (or any pane with tall
          // content) pushes the whole grid taller than the viewport
          // and the page scrolls instead of the inner pane scrolling.
          gridTemplateRows: 'minmax(0, 1fr)',
        }}
      >
        {/* Tree-resize gutter. Absolutely-positioned over the
            tree/main boundary so it stays out of the grid's layout
            math and doesn't fight FileTree's overflow-y-auto.
            Transform centers the 6px hit area on the 1px border. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={treeWidth}
          aria-valuemin={TREE_MIN_W}
          aria-valuemax={TREE_MAX_W}
          aria-label="Resize file tree"
          tabIndex={0}
          className="absolute top-0 bottom-0 w-1.5 z-20 cursor-col-resize group"
          style={{ left: 'var(--tree-w)', transform: 'translateX(-3px)' }}
          onMouseDown={startTreeDrag}
          onDoubleClick={resetTreeWidth}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeTreeWidth(-16); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); nudgeTreeWidth(16); }
          }}
        >
          {/* Thin visual line — invisible at rest, accent-tinted on
              hover/focus. The 1px stripe is centered inside the 6px
              hit area so it overlaps the existing border. */}
          <div className="h-full w-px mx-auto bg-transparent group-hover:bg-accent/40 group-focus-visible:bg-accent/50 transition-colors duration-100" />
        </div>

        <aside className="border-r border-white/[0.06] bg-panel/60 overflow-y-auto scroll-thin">
          <div className="px-2 pt-2 pb-1.5 flex items-center justify-end gap-0.5 sticky top-0 bg-panel/85 backdrop-blur z-10 border-b border-white/[0.04]">
            <button
              className="w-7 h-7 rounded grid place-items-center text-muted hover:text-ink hover:bg-white/[0.06] transition-colors disabled:opacity-40"
              title={t('tree.newNote')}
              disabled={!user || user.role === 'reader'}
              onClick={() => {
                setProposeAsNew(true);
                setShowPropose(true);
              }}
            >
              <SquarePen size={14} />
            </button>
            <button
              className="w-7 h-7 rounded grid place-items-center text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
              title={t('tree.newFolder')}
              onClick={() => setPendingFolder({ initial: 'Untitled' })}
            >
              <FolderPlus size={14} />
            </button>
            <button
              className="w-7 h-7 rounded grid place-items-center text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
              title={treeSort === 'asc' ? t('tree.sort.asc') : t('tree.sort.desc')}
              onClick={cycleTreeSort}
            >
              {treeSort === 'asc' ? <ArrowDownAZ size={14} /> : <ArrowDownZA size={14} />}
            </button>
            <button
              className="w-7 h-7 rounded grid place-items-center text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
              title={treeOpenCount > 0 ? t('tree.collapseAll') : t('tree.expandAll')}
              onClick={() => {
                if (treeOpenCount > 0) treeRef.current?.collapseAll();
                else treeRef.current?.expandAll();
              }}
            >
              {treeOpenCount > 0
                ? <ChevronsDownUp size={14} />
                : <ChevronsUpDown size={14} />}
            </button>
            <span className="w-px h-4 bg-white/[0.08] mx-0.5" aria-hidden />
            <button
              className={`w-7 h-7 rounded grid place-items-center text-[0.7143rem] font-mono transition-colors ${
                activeTab?.kind === 'graph' && activeTab.graphMode === '2d'
                  ? 'bg-accent/20 text-accent'
                  : 'text-muted hover:text-ink hover:bg-white/[0.06]'
              }`}
              title={t('tree.graph2d')}
              onClick={() => tabs.openGraph('2d')}
            >
              2D
            </button>
            <button
              className={`w-7 h-7 rounded grid place-items-center text-[0.7143rem] font-mono transition-colors ${
                activeTab?.kind === 'graph' && activeTab.graphMode === '3d'
                  ? 'bg-accent/20 text-accent'
                  : 'text-muted hover:text-ink hover:bg-white/[0.06]'
              }`}
              title={t('tree.graph3d')}
              onClick={() => tabs.openGraph('3d')}
            >
              3D
            </button>
          </div>

          {/* Bookmarks — collapsible section above the file tree.
              Renders only when the user has at least one bookmark, so
              fresh installs don't show a perpetually-empty header.
              Click navigates; star icon removes the bookmark inline. */}
          {bookmarks.length > 0 && (
            <div className="px-1.5 mt-1 mb-2">
              <div className="px-2 py-1 text-[0.6875rem] uppercase tracking-[0.12em] text-muted/80">
                Bookmarks
              </div>
              <ul className="space-y-0">
                {bookmarks.map((b) => (
                  <li key={b.id} className="group flex items-center">
                    <button
                      title={b.page_title}
                      className={`flex-1 text-left px-2 py-[3px] rounded text-[0.8929rem] truncate transition-colors ${
                        selected === b.page_path
                          ? 'bg-accent/[0.18] text-ink font-medium'
                          : 'hover:bg-white/[0.05] text-muted hover:text-ink'
                      }`}
                      onClick={() => navigate(b.page_path)}
                    >
                      {b.page_title}
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 px-1.5 text-muted hover:text-rose-300 transition-opacity"
                      title="Remove bookmark"
                      onClick={() => handleToggleBookmark(b.page_path, false)}
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="h-px mx-2 mt-2 bg-white/[0.06]" />
            </div>
          )}
          <FileTree
            ref={treeRef}
            pages={pages}
            selected={selected}
            onSelect={navigate}
            sort={treeSort}
            customFolders={customFolders.folders}
            pendingFolder={pendingFolder}
            onPendingFolderConfirm={(name) => {
              customFolders.add(name);
              setPendingFolder(null);
            }}
            onPendingFolderCancel={() => setPendingFolder(null)}
            onOpenChange={setTreeOpenCount}
            onContextMenu={onTreeContextMenu}
            onHover={setHoveredTree}
            folderOrder={folderOrder.order}
            onReorderFolders={folderOrder.move}
          />
        </aside>

        <main className="relative overflow-hidden flex flex-col">
          <TabBar
            tabs={tabs.tabs}
            activeId={tabs.activeId}
            getTitle={getTabTitle}
            onActivate={tabs.activate}
            onClose={tabs.closeTab}
            onNew={tabs.newTab}
          />
          <div className="flex-1 relative min-h-0">
            {activeTab?.kind === 'graph' && (
              <button
                className={`absolute top-3 right-3 z-10 w-8 h-8 grid place-items-center rounded-md border border-line backdrop-blur transition-colors ${
                  showGraphSettings
                    ? 'bg-accent text-paper border-accent'
                    : 'bg-panel/85 text-muted hover:text-ink'
                }`}
                onClick={() => setShowGraphSettings((v) => !v)}
                title="Graph settings"
              >
                <Sliders size={14} />
              </button>
            )}
            {activeTab?.kind === 'graph' && showGraphSettings && (
              <GraphSettings
                settings={graphSettings}
                onChange={setGraphSettings}
                onClose={() => setShowGraphSettings(false)}
                categories={Array.from(new Set(
                  (graphData?.nodes || [])
                    .map((n) => n.category)
                    .filter((c): c is string => !!c),
                ))}
              />
            )}

            {activeTab?.kind === 'graph' ? (
              graphData ? (
                <GraphView
                  data={graphData}
                  mode={activeTab.graphMode}
                  onSelect={navigate}
                  settings={graphSettings}
                  treeHover={hoveredTree}
                  pages={pages}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted text-sm">
                  Loading graph…
                </div>
              )
            ) : activeTab?.kind === 'page' ? (
              <PageView
                page={page}
                currentUser={user}
                allPaths={allPaths}
                users={usersById}
                onPropose={() => setShowPropose(true)}
                onLock={onLockToggle}
                onNavigate={navigate}
                onRevealInTree={(p) => treeRef.current?.reveal(p)}
                onShowVersionHistory={(p) => setHistoryForPath(p)}
                isBookmarked={page ? bookmarkedPaths.has(page.path) : false}
                onToggleBookmark={user ? handleToggleBookmark : undefined}
                onDeletePage={user?.role === 'admin' ? handleDeletePage : undefined}
                onMovePage={
                  user && (user.role === 'admin' || user.role === 'editor')
                    ? (p) => setMovingPagePath(p)
                    : undefined
                }
              />
            ) : (
              <NewTab
                canCreate={!!user && user.role !== 'reader'}
                onCreateNote={() => {
                  setProposeAsNew(true);
                  setShowPropose(true);
                }}
                onGoToFile={() => setShowQuickSwitcher(true)}
                onClose={() => activeTab && tabs.closeTab(activeTab.id)}
              />
            )}
          </div>
        </main>

        <aside className="border-l border-white/[0.06] bg-panel/60">
          <ChatPanel
            onCitationClick={navigate}
            knownPaths={allPaths}
            collapsed={chatCollapsed}
            onToggleCollapse={toggleChat}
          />
        </aside>
      </div>

      {/* Modals */}
      {showPropose && (
        <ProposeDialog
          page={proposeAsNew ? null : (selected ? page : null)}
          allPaths={allPaths}
          customFolders={customFolders.folders}
          onClose={async () => {
            setShowPropose(false);
            setProposeAsNew(false);
            await refreshAfterMutation();
          }}
        />
      )}
      {showReview && (
        <ReviewQueue
          users={usersById}
          allPaths={allPaths}
          onNavigate={navigate}
          onClose={async () => {
            setShowReview(false);
            await refreshAfterMutation();
          }}
        />
      )}
      {showMcp && <MCPAccessPanel onClose={() => setShowMcp(false)} currentUser={user} />}
      {showSources && (
        <SourcesPanel
          onClose={() => setShowSources(false)}
          currentUser={user}
          users={usersById}
        />
      )}
      {showSchema && <SchemaEditor onClose={() => setShowSchema(false)} />}
      {showShortcuts && <ShortcutSheet onClose={() => setShowShortcuts(false)} />}
      {needsLogin && (
        <LoginModal onAuthed={() => { setNeedsLogin(false); loadIdentity(); }} />
      )}
      {movingPage && (
        <MovePageDialog
          page={movingPage}
          allPaths={allPaths}
          customFolders={customFolders.folders}
          onClose={() => setMovingPagePath(null)}
          onConfirm={(newPath) => handleMovePage(movingPage.path, newPath)}
        />
      )}
      <VersionLog />
      {showLint && (
        <LintPanel
          onClose={() => setShowLint(false)}
          onNavigate={(path) => navigate(path)}
          onSuggestEdit={(path) => {
            navigate(path);
            setProposeAsNew(false);
            setShowPropose(true);
          }}
        />
      )}
      {showQuickSwitcher && (
        <QuickSwitcher
          pages={pages}
          onClose={() => setShowQuickSwitcher(false)}
          onSelect={(path) => navigate(path)}
        />
      )}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          // Rebuild items on every render so the menu re-translates while
          // open if the user flips language.
          items={ctxMenu.kind === 'file' ? buildFileMenu(ctxMenu) : buildFolderMenu(ctxMenu)}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {historyForPath && (
        <VersionHistory
          path={historyForPath}
          users={usersById}
          onClose={() => setHistoryForPath(null)}
        />
      )}
    </div>
  );
}
