'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  Bell, Plug, Pencil, Inbox, Search, BookOpen, Sliders,
  SquarePen, FolderPlus, ArrowDownAZ, ArrowDownZA,
  ChevronsDownUp, ChevronsUpDown, ChevronRight,
  Copy, Clipboard, History, Bookmark, BookmarkCheck, FolderInput, Trash2,
  ExternalLink, FilePlus, Files, BookText, ShieldCheck, Sun, Moon, HelpCircle,
  Share2, Settings,
} from 'lucide-react';
import Link from 'next/link';
import PublishArtifactModal from '@/components/artifacts/PublishArtifactModal';
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
import { copyToClipboard as copyText } from '@/lib/clipboard';
import dynamic from 'next/dynamic';
// GraphView statically imports THREE.js + react-force-graph (~1 MB parsed).
// Eagerly bundling it blocked first paint of the wiki with a long white
// screen — then fast on later loads once the browser cached the chunk. It
// only ever renders on the graph tab and takes no ref, so defer it: the
// initial bundle no longer carries THREE, and the graph chunk loads on demand
// when the user opens the graph. ssr:false — the force-graph libs are
// browser-only (canvas/WebGL).
const GraphView = dynamic(() => import('@/components/GraphView'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-muted text-sm">
      Loading graph…
    </div>
  ),
});
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
import SourcesTreeSection from '@/components/SourcesTreeSection';
import RawSourceView from '@/components/RawSourceView';
import SchemaEditor from '@/components/SchemaEditor';
import LintPanel from '@/components/LintPanel';
import UserManual from '@/components/UserManual';
import ShortcutSheet from '@/components/ShortcutSheet';
import VersionLog from '@/components/VersionLog';
import SettingsModal from '@/components/SettingsModal';
import { matchesCombo, resolveBindings } from '@/lib/hotkeys';
import LoginModal from '@/components/LoginModal';
import MovePageDialog from '@/components/MovePageDialog';
import { useTheme } from '@/lib/theme';
import { useLanguage } from '@/lib/i18n';
import { api, type Page, type Role, type User, type ArtifactVisibility } from '@/lib/api';
import {
  isWikiEmbedded,
  listenForDolphinAuth,
  requestParentAuth,
} from '@/lib/dolphin-bridge';
import { useGraphSettings } from '@/lib/graphSettings';

// Default SWR options: don't refetch on focus everywhere, keep previous data
const SWR_OPTS = { revalidateOnFocus: false, keepPreviousData: true };

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  // Detect iframe embed only after mount so SSR and the first client
  // render produce identical markup (avoids hydration mismatch).
  const [embedded, setEmbedded] = useState(false);
  const displayName = user?.name || '…';

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
  const { theme, themeId, setTheme, setThemeId } = useTheme();
  const { lang, toggle: toggleLang, t } = useLanguage();
  const [showSources, setShowSources] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [showLint, setShowLint] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showGraphSettings, setShowGraphSettings] = useState(false);
  // Gated artifacts. `publishTarget` drives PublishArtifactModal from the
  // file-tree right-click + page-tab kebab ({ kind: 'page', … }). null
  // means the modal is closed. The full management UI now lives on the
  // dedicated /artifacts page (replaces the old ArtifactsPanel drawer).
  const [publishTarget, setPublishTarget] = useState<
    | { kind: 'page'; pagePath: string; initialName?: string; initialVisibility?: ArtifactVisibility }
    | { kind: 'file' }
    | null
  >(null);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Sign out (shared by the topbar button + Settings → Account).
  const signOut = useCallback(() => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('wiki:jwt');
    localStorage.removeItem('wiki:email');
    localStorage.removeItem('wiki:role');
    localStorage.removeItem('wiki:displayName');
    // Block the stub-mode auto-re-auth so sign-out actually sticks.
    localStorage.setItem('wiki:signed-out', '1');
    fetch(`${process.env.NEXT_PUBLIC_API_BASE || '/api'}/auth/logout`, {
      method: 'POST', credentials: 'include',
    }).finally(() => { window.location.href = '/login'; });
  }, []);
  const [searchQuery, setSearchQuery] = useState('');

  // Resizable file tree (left sidebar). Width persists across reloads.
  // Bounds: 180px (cramped floor) – 480px (don't dominate the layout).
  // Default 240px matches the literal width used before this change.
  const TREE_DEFAULT_W = 240;
  const TREE_MIN_W = 180;
  const TREE_MAX_W = 480;
  const clampTreeW = (n: number) =>
    Math.max(TREE_MIN_W, Math.min(TREE_MAX_W, Math.round(n)));
  // SSR and the very first client render must match TREE_DEFAULT_W so
  // React doesn't fire an `aria-valuenow` hydration mismatch warning
  // when the persisted value differs from the default. The persisted
  // value is applied in a post-mount effect below.
  const [treeWidth, setTreeWidth] = useState<number>(TREE_DEFAULT_W);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('wiki:tree-width');
      const n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n)) setTreeWidth(clampTreeW(n));
    } catch { /* localStorage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  // Resizable chat panel (right), mirroring the file tree above — but the
  // handle sits on the panel's LEFT edge, so dragging left WIDENS it (delta
  // sign inverted). No collapse button — drag the handle in to shrink it; once
  // it crosses CHAT_RAIL_W the content snaps to a thin rail (like the old
  // collapse) live during the drag. MIN is the rail width; drag out to restore.
  const CHAT_DEFAULT_W = 320;
  const CHAT_MIN_W = 48;
  const CHAT_MAX_W = 620;
  // Below this the ChatPanel swaps to its rail (keep in sync with ChatPanel).
  const CHAT_RAIL_W = 250;
  const clampChatW = (n: number) =>
    Math.max(CHAT_MIN_W, Math.min(CHAT_MAX_W, Math.round(n)));
  const [chatWidth, setChatWidth] = useState<number>(CHAT_DEFAULT_W);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('wiki:chat-width');
      const n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n)) setChatWidth(clampChatW(n));
    } catch { /* localStorage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chatDragRef = useRef<{
    startX: number; startWidth: number; lastWidth: number;
  } | null>(null);

  const startChatDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    chatDragRef.current = {
      startX: e.clientX, startWidth: chatWidth, lastWidth: chatWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const container = gridContainerRef.current;
    if (container) container.style.transition = 'none';
    const onMove = (ev: MouseEvent) => {
      const ctx = chatDragRef.current;
      if (!ctx) return;
      // Right panel: cursor moving LEFT (smaller clientX) widens it.
      const next = clampChatW(ctx.startWidth - (ev.clientX - ctx.startX));
      if (next === ctx.lastWidth) return;
      // Swap ChatPanel rail <-> full LIVE when the drag crosses CHAT_RAIL_W, so
      // the content snaps away/in at the threshold instead of squishing the
      // whole way and only snapping on release. One React render per crossing;
      // the imperative `transition:none` set above survives it (React only
      // manages the style-object keys), so the column still tracks the cursor.
      const crossedRail =
        (ctx.lastWidth < CHAT_RAIL_W) !== (next < CHAT_RAIL_W);
      ctx.lastWidth = next;
      if (container) container.style.setProperty('--chat-w', `${next}px`);
      if (crossedRail) setChatWidth(next);
    };
    const teardown = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', teardown);
      window.removeEventListener('blur', teardown);
      document.removeEventListener('mouseleave', teardown);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (container) container.style.transition = '';
      const finalWidth = chatDragRef.current?.lastWidth ?? chatWidth;
      chatDragRef.current = null;
      setChatWidth(finalWidth);
      try { localStorage.setItem('wiki:chat-width', String(finalWidth)); } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', teardown);
    window.addEventListener('blur', teardown);
    document.addEventListener('mouseleave', teardown);
  }, [chatWidth]);

  const resetChatWidth = useCallback(() => {
    setChatWidth(CHAT_DEFAULT_W);
    try { localStorage.setItem('wiki:chat-width', String(CHAT_DEFAULT_W)); } catch {}
  }, []);
  const nudgeChatWidth = useCallback((delta: number) => {
    setChatWidth((w) => {
      const next = clampChatW(w + delta);
      try { localStorage.setItem('wiki:chat-width', String(next)); } catch {}
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
  // WIKI tree section collapse. Default open; collapsing hides the tree
  // via CSS (not unmount) so treeRef.reveal() + the tree's own open-state
  // survive a collapse/expand cycle.
  const [wikiOpen, setWikiOpen] = useState(true);
  // Extra scroll room at the bottom of the sidebar: when the tree overflows
  // its column, append a spacer ~1/4 of the tree's height so the last items
  // (e.g. the Raw Sources section) can be scrolled up off the bottom edge
  // instead of sitting flush against it. Recomputed by a ResizeObserver
  // whenever the tree grows/shrinks (folders toggle, data loads, resize).
  const sidebarRef = useRef<HTMLElement>(null);
  const treeContentRef = useRef<HTMLDivElement>(null);
  const [treeSpacer, setTreeSpacer] = useState(0);
  useEffect(() => {
    const aside = sidebarRef.current;
    const content = treeContentRef.current;
    if (!aside || !content) return;
    const recompute = () => {
      const contentH = content.scrollHeight;
      setTreeSpacer(contentH > aside.clientHeight ? Math.round(contentH * 0.25) : 0);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(content);
    ro.observe(aside);
    return () => ro.disconnect();
  }, []);
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
  // Poll pages + graph on the same 30s cadence as the review queue /
  // notifications, so a page published by someone else (e.g. a reviewer
  // accepting a contributor's draft) shows up in every already-open session's
  // tree + graph without a manual refresh.
  const { data: pages = [], mutate: refetchPages } = useSWR('pages', api.listPages, { ...SWR_OPTS, refreshInterval: 30_000 });
  const { data: graphData, mutate: refetchGraph } = useSWR('graph', api.graph, { ...SWR_OPTS, refreshInterval: 30_000 });
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
  // Exact unread badge count (GAP-005): the list above caps at 100 rows, so a
  // count derived from it undercounts past 100. This dedicated endpoint is exact.
  const { data: unreadData, mutate: refetchUnread } = useSWR(
    'notifications-unread', api.unreadCount,
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
  // Prefer the exact server count (GAP-005); fall back to the list-derived
  // count (capped at 100) only until the count endpoint resolves.
  const unreadCount = unreadData?.unread ?? notifications.filter((n) => !n.is_read).length;

  // Identity. In stub mode the X-User-Email fallback header gets us a
  // user transparently; in oidc mode we need a real JWT in localStorage,
  // and on failure we surface the LoginModal.
  const [needsLogin, setNeedsLogin] = useState(false);

  const loadIdentity = useCallback(() => {
    setNeedsLogin(false);
    const isEmb = isWikiEmbedded();
    // Explicit sign-out wins over the stub auto-auth convenience.
    // The user clicked Sign out and we honor it until they log in.
    const explicitlySignedOut = typeof window !== 'undefined'
      && localStorage.getItem('wiki:signed-out') === '1';
    if (explicitlySignedOut) {
      if (!isEmb) window.location.href = '/login';
      return;
    }
    api.whoami().then((u) => { setUser(u); setNeedsLogin(false); }).catch(() => {
      if (isEmb) {
        requestParentAuth();
        return;
      }
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

  useEffect(() => {
    setEmbedded(isWikiEmbedded());
    loadIdentity();
  }, [loadIdentity]);

  // Dolphin iframe embed: listen for parent auth and retry the handshake.
  useEffect(() => {
    if (!isWikiEmbedded()) return undefined;
    const retryTimers = [0, 300, 800, 1500].map((delay) =>
      window.setTimeout(() => requestParentAuth(), delay),
    );
    const stop = listenForDolphinAuth(
      (u) => {
        setUser(u);
        setNeedsLogin(false);
      },
      () => {
        // Parent may not be ready yet; requestParentAuth retries cover this.
      },
    );
    return () => {
      retryTimers.forEach((id) => window.clearTimeout(id));
      stop();
    };
  }, []);

  // Apply the account-saved appearance (theme + mode) ONCE per user, when they
  // sign in. It must NOT depend on the current theme/mode — otherwise it would
  // re-run on every toggle and re-apply the saved value, fighting the switch.
  // The ref guard ensures it runs once per user id (a prefs save changes the
  // user object but not its id, so a toggle never re-triggers it).
  const appearanceAppliedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!user) return;
    if (appearanceAppliedFor.current === user.id) return;
    appearanceAppliedFor.current = user.id;
    const ap = user.preferences?.appearance as
      | { themeId?: string; mode?: 'light' | 'dark' }
      | undefined;
    if (!ap) return;
    if (ap.themeId) setThemeId(ap.themeId);
    if (ap.mode === 'light' || ap.mode === 'dark') setTheme(ap.mode);
  }, [user, setThemeId, setTheme]);

  // Topbar light/dark toggle: flip the mode AND (if signed in) save it to the
  // account, so the choice is consistent with the Settings gallery + reloads.
  const toggleThemePersist = useCallback(() => {
    const next: 'light' | 'dark' = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (user) {
      api.savePreferences({
        ...(user.preferences ?? {}),
        appearance: { themeId, mode: next },
      }).then(setUser).catch(() => { /* keep the local change */ });
    }
  }, [theme, themeId, user, setTheme]);

  // Effective hotkey bindings = defaults merged with this user's saved
  // overrides (Settings → Hotkeys). Account-bound; see lib/hotkeys.
  const hotkeyBindings = useMemo(
    () => resolveBindings(user?.preferences),
    [user?.preferences],
  );

  // Keyboard shortcuts. The five page-level ones are rebindable (read from
  // `hotkeyBindings`); the ⌘? shortcut sheet keeps its special slash logic.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't let page-level hotkeys fire while the user is typing in an
      // input / textarea / contentEditable — a bare Backspace/Delete/letter
      // must never trigger closeTab etc. and tear a dialog out from under the
      // user (multi-select-delete-loses-input bug). Modifier combos still pass.
      const tgt = e.target as HTMLElement | null;
      const typing =
        !!tgt &&
        (tgt.tagName === 'INPUT' ||
          tgt.tagName === 'TEXTAREA' ||
          tgt.isContentEditable);
      if (typing && !(e.metaKey || e.ctrlKey || e.altKey)) return;
      if (matchesCombo(e, hotkeyBindings.search)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        setShowSearch(true);
        return;
      }
      if (matchesCombo(e, hotkeyBindings.switcher)) {
        e.preventDefault();
        setShowQuickSwitcher(true);
        return;
      }
      if (matchesCombo(e, hotkeyBindings.suggest) && user && user.role !== 'reader') {
        e.preventDefault();
        setShowPropose(true);
        return;
      }
      if (matchesCombo(e, hotkeyBindings.newTab)) {
        e.preventDefault();
        tabs.newTab();
        return;
      }
      if (matchesCombo(e, hotkeyBindings.closeTab)) {
        e.preventDefault();
        if (tabs.activeId) tabs.closeTab(tabs.activeId);
        return;
      }
      // Next / previous tab (fixed, non-rebindable). These were advertised in
      // the shortcut sheet + registry but never wired (GAP-001 / FR-UI-KEYS).
      {
        const isNext = matchesCombo(e, 'mod+shift+]');
        const isPrev = matchesCombo(e, 'mod+shift+[');
        if (isNext || isPrev) {
          e.preventDefault();
          const list = tabs.tabs;
          const i = list.findIndex((t) => t.id === tabs.activeId);
          if (i >= 0 && list.length > 1) {
            const dir = isNext ? 1 : -1;
            tabs.activate(list[(i + dir + list.length) % list.length].id);
          }
          return;
        }
      }
      // Shortcut sheet (⌘? / ⌘/ / bare ?) — special-cased, not rebindable.
      {
        const target = e.target as HTMLElement | null;
        const isTyping =
          !!target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            (target as HTMLElement).isContentEditable);
        const isSlashKey = e.key === '/' || e.key === '?' || e.code === 'Slash';
        if (isSlashKey && ((e.metaKey || e.ctrlKey) || (e.key === '?' && !isTyping))) {
          e.preventDefault();
          setShowShortcuts(true);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, tabs, hotkeyBindings]);

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
      refetchQueue(), refetchNotifs(), refetchUnread(),
    ]);
  }, [refetchPages, refetchGraph, refetchPage, refetchQueue, refetchNotifs, refetchUnread]);

  async function copyToClipboard(text: string) {
    await copyText(text);
  }

  async function makePageCopy(path: string) {
    try {
      const full = await api.getPage(path);
      // Pick the first free "<path>-copy[-N]" so duplicating a page more than
      // once doesn't 409 on the fixed "-copy" path (right-click copy failing).
      const all = await api.listPages();
      const taken = new Set(all.map((p) => p.path));
      let newPath = `${path}-copy`;
      for (let n = 2; taken.has(newPath); n++) newPath = `${path}-copy-${n}`;
      const draft = await api.createDraft({
        new_page: { path: newPath, stability: 'stable' },
        title: `${full.title} ${t('menu.file.copy.suffix')}`,
        body: full.body,
        tags: full.tags,
        rationale: `Copy of ${path}`,
      });
      const submitted = await api.submitRevision(draft.id);
      // A stable-page copy lands in the review queue, so the tree (which only
      // lists published pages) wouldn't show it → looked like "nothing
      // happened". editor/admin can self-accept (the backend allows
      // reviewer==author) → publish + open the copy immediately; a contributor
      // is told it's queued instead of staring at an unchanged tree.
      const canPublish = user?.role === 'admin' || user?.role === 'editor';
      if (canPublish && submitted.status !== 'accepted') {
        await api.reviewRevision(draft.id, 'accept');
      }
      await refreshAfterMutation();
      if (canPublish) {
        tabs.openPage(newPath, true);
      } else {
        alert(t('menu.file.copy.queued'));
      }
    } catch (e: unknown) {
      const msg = (e as Error).message ?? '';
      alert(msg.includes('already exists') ? t('menu.file.copy.exists') : `${t('menu.file.copy.failed')} ${msg}`);
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
        // "Publish as gated link" — snapshots the page's published
        // markdown into a fresh artifact under /a/<short_id>. The
        // wiki page itself is untouched; the artifact body is a
        // point-in-time copy that survives later edits/deletes of
        // the source page.
        kind: 'item',
        label: 'Publish as gated link',
        icon: <Share2 size={13} />,
        disabled: !user,
        hint: !user ? t('menu.page.bookmark.hint') : undefined,
        onClick: () => setPublishTarget({
          kind: 'page',
          pagePath: info.pagePath,
          initialName: getTabTitle(info.pagePath),
        }),
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
      <header className="topbar h-12 border-b border-white/[0.06] bg-panel/85 backdrop-blur flex items-center px-3 gap-3 text-[0.9286rem] relative z-20">
        <div className="flex items-center gap-2 px-2">
          <BookOpen size={16} className="text-accent" />
          <span className="font-display font-medium tracking-[0.02em] text-[1rem] text-ink">{t('topbar.brand')}</span>
        </div>

        {/* Search */}
        <div className="search-box flex-1 max-w-xl mx-2 relative">
          <div className="relative">
            <input
              ref={searchInputRef}
              className="form-input h-8 pl-3 pr-9 text-[0.9286rem]"
              placeholder={t('topbar.search.placeholder')}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearch(true);
              }}
              onFocus={() => setShowSearch(true)}
            />
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
        <div className="topbar-actions ml-auto flex items-center gap-1.5">
          <button
            className="btn btn-icon"
            onClick={toggleThemePersist}
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
          {/* Dev: role switcher (hidden when embedded in Dolphin) */}
          {!embedded && (
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
          )}
          {!embedded && user && (
            <button
              className="h-8 px-2 text-[0.8214rem] border border-line rounded-md bg-elev text-muted hover:text-ink"
              title={`Sign out (${user.email})`}
              onClick={signOut}
            >
              Sign out
            </button>
          )}

          <button
            className="btn btn-primary"
            onClick={() => setShowSources(true)}
            title={t('topbar.sources.title')}
          >
            <Files size={14} /> {t('topbar.sources.title')}
          </button>

          {canReview && (
            <button
              data-testid="topbar-review"
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
                  refetchUnread();
                }}
                onMarkAllRead={async () => {
                  await api.markAllRead();
                  refetchNotifs();
                  refetchUnread();
                }}
                onLink={onNotificationLink}
              />
            )}
          </div>

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

          <Link
            href="/artifacts"
            className="btn btn-icon"
            title={t('topbar.artifacts.title')}
            aria-label="Open artifacts page"
          >
            <Share2 size={14} />
          </Link>

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

          <div
            className="text-[0.8214rem] text-ink ml-1.5 truncate max-w-[160px] font-medium"
            title={user?.email}
            suppressHydrationWarning
          >
            {displayName}
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
          ['--chat-w' as string]: `${chatWidth}px`,
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

        {/* Chat-resize gutter — mirrors the tree one, pinned to the
            chat/main boundary (right: --chat-w). Always present (no collapse);
            drag it to narrow the chat down to CHAT_MIN_W. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={chatWidth}
          aria-valuemin={CHAT_MIN_W}
          aria-valuemax={CHAT_MAX_W}
          aria-label="Resize chat panel"
          tabIndex={0}
          className="absolute top-0 bottom-0 w-1.5 z-20 cursor-col-resize group"
          style={{ right: 'var(--chat-w)', transform: 'translateX(3px)' }}
          onMouseDown={startChatDrag}
          onDoubleClick={resetChatWidth}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeChatWidth(16); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); nudgeChatWidth(-16); }
          }}
        >
          <div className="h-full w-px mx-auto bg-transparent group-hover:bg-accent/40 group-focus-visible:bg-accent/50 transition-colors duration-100" />
        </div>

        <aside ref={sidebarRef} className="border-r border-white/[0.06] bg-panel/60 overflow-y-auto scroll-thin">
          <div ref={treeContentRef}>
          <div className="tree-actions px-2 pt-2 pb-1.5 flex items-center justify-end gap-0.5 sticky top-0 bg-panel/85 backdrop-blur z-10 border-b border-white/[0.04]">
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
          {/* WIKI section header — the concepts / entities / sources /
              syntheses categories live under this. Collapsing hides the
              tree via CSS (not unmount) so treeRef.reveal() + the tree's
              own open-state survive a collapse/expand. */}
          <div className="px-1.5 mt-1">
            <button
              onClick={() => setWikiOpen((o) => !o)}
              className="w-full flex items-center gap-1 px-2 py-1 text-[0.6875rem] uppercase tracking-[0.12em] text-muted/80 hover:text-ink transition-colors"
            >
              <ChevronRight
                size={11}
                className={`shrink-0 transition-transform duration-150 ${wikiOpen ? 'rotate-90' : ''}`}
              />
              <span className="flex-1 text-left">{t('tree.section.wiki')}</span>
            </button>
          </div>
          <div className={wikiOpen ? '' : 'hidden'}>
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
          </div>

          {/* RAW SOURCES section — the uploaded originals (PDF / Markdown /
              images / imported URLs) before ingest. Clicking a row opens
              the full SourcesPanel to preview / download / ingest. */}
          <SourcesTreeSection
            enabled={!!user}
            onOpenPanel={() => setShowSources(true)}
            onOpenMarkdown={(s) => tabs.openRawSource(s.id, s.title)}
            canManage={user?.role === 'admin'}
          />
          </div>
          <div aria-hidden style={{ height: treeSpacer }} />
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
                folderPaths={(() => {
                  // Build the full list of folder paths the settings
                  // tree should display: every prefix of every page
                  // path PLUS every user-created custom folder.
                  const set = new Set<string>();
                  for (const n of (graphData?.nodes || [])) {
                    const parts = n.id.split('/').filter(Boolean);
                    for (let i = 1; i < parts.length; i++) {
                      set.add(parts.slice(0, i).join('/'));
                    }
                  }
                  for (const f of customFolders.folders) {
                    const parts = f.split('/').filter(Boolean);
                    for (let i = 1; i <= parts.length; i++) {
                      set.add(parts.slice(0, i).join('/'));
                    }
                  }
                  return Array.from(set);
                })()}
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
                  customFolders={customFolders.folders}
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
                onShareLink={
                  user
                    ? (p) => setPublishTarget({
                        kind: 'page',
                        pagePath: p,
                        initialName: getTabTitle(p),
                        initialVisibility: 'private',
                      })
                    : undefined
                }
              />
            ) : activeTab?.kind === 'rawsource' ? (
              <RawSourceView
                sourceId={activeTab.sourceId}
                title={activeTab.title}
                knownPaths={allPaths}
                onNavigate={navigate}
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
            width={chatWidth}
          />
        </aside>
      </div>

      {/* Modals */}
      {showPropose && (
        <ProposeDialog
          page={proposeAsNew ? null : (selected ? page : null)}
          allPaths={allPaths}
          customFolders={customFolders.folders}
          onOpenExisting={navigate}
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
          onDecided={refreshAfterMutation}
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
      {/* Bottom-left: version badge + settings gear, side by side. */}
      <div className="corner-actions fixed bottom-2.5 left-2.5 z-30 flex items-center gap-1.5">
        <VersionLog />
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          title={t('topbar.settings.title')}
          aria-label="Settings"
          className="h-7 w-7 grid place-items-center rounded-md border border-line bg-panel/70 text-muted hover:text-ink hover:bg-panel/85 backdrop-blur transition-colors"
        >
          <Settings size={14} />
        </button>
      </div>
      {showSettings && (
        <SettingsModal
          user={user}
          onUserChange={setUser}
          onSignOut={signOut}
          onClose={() => setShowSettings(false)}
        />
      )}
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
          canRestore={!!user && user.role !== 'reader'}
          onClose={() => setHistoryForPath(null)}
          onRestored={() => { refetchPage(); refetchPages(); refetchQueue(); }}
        />
      )}

      {/* Gated artifacts. The publish modal opens from the file-tree
          right-click / page-tab kebab. The management surface (list,
          rename, visibility, versions, access log) lives at /artifacts. */}
      {publishTarget && (
        <PublishArtifactModal
          mode={publishTarget}
          // Public sharing is on by default (server ARTIFACTS_ALLOW_PUBLIC
          // defaults true), so the Public radio is enabled. If an admin
          // disables the flag, the backend returns 403 and the modal shows
          // the error.
          allowPublic={true}
          initialVisibility={
            publishTarget.kind === 'page' ? publishTarget.initialVisibility : undefined
          }
          onClose={() => setPublishTarget(null)}
        />
      )}
    </div>
  );
}
