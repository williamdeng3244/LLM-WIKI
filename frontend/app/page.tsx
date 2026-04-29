'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  Bell, Bot, Pencil, Inbox, Search, BookOpen, Sliders,
  SquarePen, FolderPlus, ArrowDownAZ, ArrowDownZA,
  ChevronsDownUp, ChevronsUpDown,
  Copy, Clipboard, History, Bookmark, FolderInput, Trash2,
  ExternalLink, FilePlus,
} from 'lucide-react';
import FileTree, {
  type FileTreeHandle, type SortMode, type ContextMenuInfo,
} from '@/components/FileTree';
import { useCustomFolders } from '@/lib/customFolders';
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
import AgentManager from '@/components/AgentManager';
import SearchResults from '@/components/SearchResults';
import NotificationsPanel from '@/components/NotificationsPanel';
import QuickSwitcher, { pushRecent } from '@/components/QuickSwitcher';
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
  const [showAgents, setShowAgents] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showGraphSettings, setShowGraphSettings] = useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
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

  // File-tree right-click menu + version-history modal.
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; items: MenuItem[];
  } | null>(null);
  const [historyForPath, setHistoryForPath] = useState<string | null>(null);

  const [graphSettings, setGraphSettings] = useGraphSettings();

  // Mirror motion-enabled into the Plexus background. Fires on mount
  // (after settings hydrate from localStorage) and on every change.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('plexus:motion', {
      detail: { enabled: graphSettings.motionEnabled },
    }));
  }, [graphSettings.motionEnabled]);

  // Data
  const { data: pages = [], mutate: refetchPages } = useSWR('pages', api.listPages, SWR_OPTS);
  const { data: graphData, mutate: refetchGraph } = useSWR('graph', api.graph, SWR_OPTS);
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

  // Identity
  useEffect(() => {
    api.whoami().then(setUser).catch(() => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('wiki:email', 'admin@example.com');
        localStorage.setItem('wiki:role', 'admin');
        api.whoami().then(setUser).catch(() => {});
      }
    });
  }, []);

  // Keyboard: ⌘K = search; ⌘O = quick switcher; ⌘E = suggest edit;
  // ⌘T = new tab; ⌘W = close current tab.
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
  const navigate = useCallback((path: string) => {
    tabs.openPage(path);
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
        label: 'Open in new tab',
        icon: <ExternalLink size={13} />,
        onClick: () => { tabs.openPage(info.pagePath, true); pushRecent(info.pagePath); },
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: 'Suggest edit',
        icon: <Pencil size={13} />,
        disabled: !user || user.role === 'reader',
        hint: 'Readers cannot suggest edits',
        onClick: () => { navigate(info.pagePath); setShowPropose(true); },
      },
      {
        kind: 'item',
        label: 'Make a copy',
        icon: <Copy size={13} />,
        disabled: !user || user.role === 'reader',
        hint: 'Readers cannot create drafts',
        onClick: () => { makePageCopy(info.pagePath); },
      },
      {
        kind: 'item',
        label: 'Copy path',
        icon: <Clipboard size={13} />,
        onClick: () => { copyToClipboard(info.pagePath); },
      },
      {
        kind: 'item',
        label: 'Open version history',
        icon: <History size={13} />,
        onClick: () => { setHistoryForPath(info.pagePath); },
      },
      {
        kind: 'item',
        label: 'Bookmark…',
        icon: <Bookmark size={13} />,
        disabled: true,
        hint: 'Coming soon',
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: 'Move file to…',
        icon: <FolderInput size={13} />,
        disabled: true,
        hint: 'Backend support not yet wired',
      },
      {
        kind: 'item',
        label: 'Delete',
        icon: <Trash2 size={13} />,
        danger: true,
        disabled: true,
        hint: 'Backend support not yet wired',
      },
    ];
  }

  function buildFolderMenu(info: Extract<ContextMenuInfo, { kind: 'folder' }>): MenuItem[] {
    const isCustom = customFolders.folders.includes(info.folderPath);
    return [
      {
        kind: 'item',
        label: 'New note in folder',
        icon: <FilePlus size={13} />,
        disabled: !user || user.role === 'reader',
        onClick: () => {
          // Open ProposeDialog in new mode; the user fills in the path.
          setProposeAsNew(true);
          setShowPropose(true);
        },
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: 'Rename folder…',
        icon: <Pencil size={13} />,
        disabled: !isCustom,
        hint: isCustom ? undefined : 'Only user-created folders can be renamed',
        onClick: () => {
          const next = window.prompt('Rename folder:', info.name);
          const clean = (next || '').trim().replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
          if (!clean || clean === info.name) return;
          customFolders.remove(info.name);
          customFolders.add(clean);
        },
      },
      {
        kind: 'item',
        label: 'Copy folder path',
        icon: <Clipboard size={13} />,
        onClick: () => { copyToClipboard(info.folderPath); },
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: 'Delete folder',
        icon: <Trash2 size={13} />,
        danger: true,
        disabled: !isCustom || !info.isEmpty,
        hint: !isCustom
          ? 'Only user-created folders can be deleted'
          : !info.isEmpty
            ? 'Folder contains pages — move or delete them first'
            : undefined,
        onClick: () => { customFolders.remove(info.name); },
      },
    ];
  }

  const onTreeContextMenu = useCallback((info: ContextMenuInfo) => {
    const items = info.kind === 'file' ? buildFileMenu(info) : buildFolderMenu(info);
    setCtxMenu({ x: info.x, y: info.y, items });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, customFolders.folders]);

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
      <header className="h-12 border-b border-white/[0.06] bg-panel/85 backdrop-blur flex items-center px-3 gap-3 text-[13px] relative z-20">
        <div className="flex items-center gap-2 px-2">
          <BookOpen size={16} className="text-accent" />
          <span className="font-display font-medium tracking-[0.02em] text-[14px] text-ink">Enflame Wiki</span>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-xl mx-2 relative">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              ref={searchInputRef}
              className="form-input h-8 pl-9 pr-12 text-[13px]"
              placeholder="Search pages, content, code…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearch(true);
              }}
              onFocus={() => setShowSearch(true)}
            />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted bg-black/5 border border-black/10 rounded px-1.5 py-0.5 font-mono pointer-events-none">
              ⌘K
            </kbd>
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
          {/* Dev: role switcher */}
          <select
            className="h-8 px-2 text-[11.5px] border border-line rounded-md bg-elev text-ink"
            value={user?.role || 'admin'}
            onChange={(e) => changeRole(e.target.value as Role)}
            title="View as role (dev only)"
          >
            <option value="reader">Reader</option>
            <option value="contributor">Contributor</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>

          {user && user.role !== 'reader' && (
            <button
              className="btn btn-primary"
              onClick={() => setShowPropose(true)}
              title="Suggest edit (⌘E)"
            >
              <Pencil size={13} /> Suggest
            </button>
          )}

          {canReview && (
            <button
              className="btn relative"
              onClick={() => setShowReview(true)}
              title="Review queue"
            >
              <Inbox size={13} />
              {queue.length > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-medium">
                  {queue.length}
                </span>
              )}
            </button>
          )}

          <div className="relative">
            <button
              className="btn btn-icon relative"
              onClick={() => setShowNotifs((s) => !s)}
              title="Notifications"
            >
              <Bell size={14} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-medium">
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
            onClick={() => setShowAgents(true)}
            title="Manage agents"
          >
            <Bot size={14} />
          </button>

          <div className="text-[11.5px] text-muted ml-1.5 truncate max-w-[120px]" title={user?.email}>
            {user?.name || '…'}
          </div>
        </div>
      </header>

      {/* Three-pane body */}
      <div className="flex-1 grid grid-cols-[224px_1fr_340px] min-h-0">
        <aside className="border-r border-white/[0.06] bg-panel/60 overflow-y-auto scroll-thin">
          <div className="px-2 pt-2 pb-1.5 flex items-center justify-end gap-0.5 sticky top-0 bg-panel/85 backdrop-blur z-10 border-b border-white/[0.04]">
            <button
              className="w-7 h-7 rounded grid place-items-center text-muted hover:text-ink hover:bg-white/[0.06] transition-colors disabled:opacity-40"
              title="New note"
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
              title="New folder"
              onClick={() => setPendingFolder({ initial: 'Untitled' })}
            >
              <FolderPlus size={14} />
            </button>
            <button
              className="w-7 h-7 rounded grid place-items-center text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
              title={`Sort: ${treeSort === 'asc' ? 'A → Z' : 'Z → A'}`}
              onClick={cycleTreeSort}
            >
              {treeSort === 'asc' ? <ArrowDownAZ size={14} /> : <ArrowDownZA size={14} />}
            </button>
            <button
              className="w-7 h-7 rounded grid place-items-center text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
              title={treeOpenCount > 0 ? 'Collapse all' : 'Expand all'}
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
              className={`w-7 h-7 rounded grid place-items-center text-[10px] font-mono transition-colors ${
                activeTab?.kind === 'graph' && activeTab.graphMode === '2d'
                  ? 'bg-accent/20 text-accent'
                  : 'text-muted hover:text-ink hover:bg-white/[0.06]'
              }`}
              title="Graph (2D)"
              onClick={() => tabs.openGraph('2d')}
            >
              2D
            </button>
            <button
              className={`w-7 h-7 rounded grid place-items-center text-[10px] font-mono transition-colors ${
                activeTab?.kind === 'graph' && activeTab.graphMode === '3d'
                  ? 'bg-accent/20 text-accent'
                  : 'text-muted hover:text-ink hover:bg-white/[0.06]'
              }`}
              title="Graph (3D)"
              onClick={() => tabs.openGraph('3d')}
            >
              3D
            </button>
          </div>
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
              />
            )}

            {activeTab?.kind === 'graph' ? (
              graphData ? (
                <GraphView
                  data={graphData}
                  mode={activeTab.graphMode}
                  onSelect={navigate}
                  settings={graphSettings}
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
          <ChatPanel onCitationClick={navigate} knownPaths={allPaths} />
        </aside>
      </div>

      {/* Modals */}
      {showPropose && (
        <ProposeDialog
          page={proposeAsNew ? null : (selected ? page : null)}
          allPaths={allPaths}
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
      {showAgents && <AgentManager onClose={() => setShowAgents(false)} />}
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
          items={ctxMenu.items}
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
