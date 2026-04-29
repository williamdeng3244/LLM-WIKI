'use client';
import { useState } from 'react';
import useSWR from 'swr';
import {
  Flag as FlagIcon, Lock, Unlock, Pencil, MoreVertical,
  Link2, BookOpen, FolderInput, Bookmark, GitMerge, FileDown,
  SearchIcon, Replace, Clipboard, History, Network, LocateFixed,
  Trash2, Plus,
} from 'lucide-react';
import Markdown from './Markdown';
import PageMeta from './PageMeta';
import ContextMenu, { type MenuItem } from './ContextMenu';
import { api, type Page, type PageSummary, type Comment, type Flag, type User } from '@/lib/api';

export default function PageView({
  page, currentUser, allPaths, users, onPropose, onLock, onNavigate,
  onRevealInTree, onShowVersionHistory,
}: {
  page: Page | null;
  currentUser: User | null;
  allPaths: Set<string>;
  users: Map<number, User>;
  onPropose: () => void;
  onLock: (locked: boolean) => void;
  onNavigate: (path: string) => void;
  onRevealInTree?: (path: string) => void;
  onShowVersionHistory?: (path: string) => void;
}) {
  const [newComment, setNewComment] = useState('');
  const [showBacklinks, setShowBacklinks] = useState(false);
  const [pageMenu, setPageMenu] = useState<{ x: number; y: number } | null>(null);

  const { data: comments = [], mutate: refetchComments } = useSWR<Comment[]>(
    page ? `comments:${page.path}` : null,
    () => (page ? api.listComments(page.path) : Promise.resolve([])),
    { revalidateOnFocus: false },
  );
  const { data: flags = [] } = useSWR<Flag[]>(
    page ? `flags:${page.path}` : null,
    () => (page ? api.listFlags(page.path) : Promise.resolve([])),
    { revalidateOnFocus: false },
  );

  // Only fetched when the inline backlinks panel is open.
  const { data: backlinks = [] } = useSWR<PageSummary[]>(
    page && showBacklinks ? `backlinks:${page.path}` : null,
    () => (page ? api.backlinks(page.path) : Promise.resolve([])),
    { revalidateOnFocus: false },
  );

  if (!page) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm px-8 text-center">
        Select a page from the tree, or click a node in the graph.
      </div>
    );
  }

  const isAdmin = currentUser?.role === 'admin';
  const canSuggest = currentUser && currentUser.role !== 'reader';
  const openFlags = flags.filter((f) => f.status === 'open');

  async function postComment() {
    if (!page || !newComment.trim()) return;
    await api.createComment(page.path, newComment.trim());
    setNewComment('');
    refetchComments();
  }

  async function flagPage(kind: 'incorrect' | 'outdated' | 'needs_source') {
    if (!page) return;
    const note = prompt(`Why is this ${kind.replace('_', ' ')}?`);
    if (!note) return;
    await api.createFlag(page.path, kind, note);
  }

  function buildPageMenu(p: Page): MenuItem[] {
    const copyPath = async () => {
      try { await navigator.clipboard.writeText(p.path); } catch { /* ignore */ }
    };
    return [
      {
        kind: 'item',
        label: 'Backlinks in document',
        icon: <Link2 size={13} />,
        checked: showBacklinks,
        onClick: () => setShowBacklinks((v) => !v),
      },
      {
        kind: 'item',
        label: 'Reading view',
        icon: <BookOpen size={13} />,
        checked: true,
        disabled: true,
        hint: 'Inline editing is not available yet — pages always render in reading view',
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: 'Rename…',
        icon: <Pencil size={13} />,
        disabled: true,
        hint: 'Backend support not yet wired',
      },
      {
        kind: 'item',
        label: 'Move file to…',
        icon: <FolderInput size={13} />,
        disabled: true,
        hint: 'Backend support not yet wired',
      },
      {
        kind: 'item',
        label: 'Bookmark…',
        icon: <Bookmark size={13} />,
        disabled: true,
        hint: 'Coming soon',
      },
      {
        kind: 'item',
        label: 'Merge entire file with…',
        icon: <GitMerge size={13} />,
        disabled: true,
        hint: 'Not yet implemented',
      },
      {
        kind: 'item',
        label: 'Add file property',
        icon: <Plus size={13} />,
        disabled: true,
        hint: 'Use the tags field in Suggest edit for now',
      },
      {
        kind: 'item',
        label: 'Export to PDF…',
        icon: <FileDown size={13} />,
        onClick: () => window.print(),
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: 'Find…',
        icon: <SearchIcon size={13} />,
        disabled: true,
        hint: 'Use Ctrl+F (browser find) for now',
      },
      {
        kind: 'item',
        label: 'Replace…',
        icon: <Replace size={13} />,
        disabled: true,
        hint: 'No editor available yet',
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: 'Copy path',
        icon: <Clipboard size={13} />,
        onClick: copyPath,
      },
      {
        kind: 'item',
        label: 'Open version history',
        icon: <History size={13} />,
        disabled: !onShowVersionHistory,
        onClick: () => onShowVersionHistory?.(p.path),
      },
      {
        kind: 'item',
        label: 'Open linked view',
        icon: <Network size={13} />,
        disabled: true,
        hint: 'Outline panel not yet implemented',
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: 'Reveal file in navigation',
        icon: <LocateFixed size={13} />,
        disabled: !onRevealInTree,
        onClick: () => onRevealInTree?.(p.path),
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: 'Delete file',
        icon: <Trash2 size={13} />,
        danger: true,
        disabled: true,
        hint: 'Backend support not yet wired',
      },
    ];
  }

  return (
    <div className="h-full flex flex-col bg-[rgba(7,10,20,0.55)] backdrop-blur-[2px]">
      {/* Header */}
      <header className="px-8 pt-12 pb-8 border-b border-black/8">
        <div className="max-w-[68ch] mx-auto">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div
              className="text-[10.5px] uppercase tracking-[0.18em] text-muted truncate"
              title={page.path}
            >
              {page.path.split('/').join(' · ')}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {canSuggest && (
                <button className="btn" onClick={onPropose}>
                  <Pencil size={13} /> Suggest edit
                </button>
              )}
              <div className="relative group">
                <button className="btn">
                  <FlagIcon size={13} /> Flag
                </button>
                <div className="absolute right-0 top-full pt-1 hidden group-hover:block z-10">
                  <div className="bg-panel border border-line rounded-md shadow-lg text-xs min-w-[148px] overflow-hidden">
                    <button className="block w-full text-left px-3 py-2 hover:bg-black/5"
                      onClick={() => flagPage('incorrect')}>Incorrect</button>
                    <button className="block w-full text-left px-3 py-2 hover:bg-black/5"
                      onClick={() => flagPage('outdated')}>Outdated</button>
                    <button className="block w-full text-left px-3 py-2 hover:bg-black/5"
                      onClick={() => flagPage('needs_source')}>Needs source</button>
                  </div>
                </div>
              </div>
              {isAdmin && (
                <button className="btn" onClick={() => onLock(page.stability !== 'locked')}>
                  {page.stability === 'locked' ? <><Unlock size={13} /> Unlock</> : <><Lock size={13} /> Lock</>}
                </button>
              )}
              <button
                className="btn btn-icon"
                title="More actions"
                aria-label="More actions"
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  // Right-align the menu under the button; ContextMenu
                  // clamps to the viewport if our estimate is off.
                  setPageMenu({ x: rect.right - 240, y: rect.bottom + 4 });
                }}
              >
                <MoreVertical size={14} />
              </button>
            </div>
          </div>
          <div className="border-t border-black/10 mb-7" />
          <h1 className="font-serif font-medium text-ink text-[40px] leading-[1.08] tracking-[-0.018em]">
            {page.title}
          </h1>
          <div className="flex items-center flex-wrap gap-2 mt-5">
            <span className={`badge ${page.stability}`}>{page.stability}</span>
            {page.tags.slice(0, 5).map((t) => (
              <span key={t} className="badge">#{t}</span>
            ))}
          </div>
        </div>
      </header>

      {openFlags.length > 0 && (
        <div className="px-8 py-2 bg-amber-500/[0.08] border-b border-amber-500/30 text-xs text-amber-300 flex items-start gap-2">
          <FlagIcon size={13} className="shrink-0 mt-0.5" />
          <div>
            <strong>{openFlags.length} open flag{openFlags.length > 1 ? 's' : ''}:</strong>{' '}
            {openFlags[0].body}
            {openFlags.length > 1 && ` (+${openFlags.length - 1} more)`}
          </div>
        </div>
      )}

      {/* Two-column body */}
      <div className="flex-1 grid grid-cols-[1fr_220px] min-h-0">
        <div className="overflow-y-auto scroll-thin px-8 py-12">
          <div className="max-w-[68ch] mx-auto">
          <Markdown
            knownPaths={allPaths}
            onWikiLinkClick={onNavigate}
          >
            {page.body}
          </Markdown>

          {showBacklinks && (
            <div className="mt-12 pt-5 border-t border-white/[0.08]">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-3">
                Backlinks <span className="ml-1 text-muted/70">({backlinks.length})</span>
              </div>
              {backlinks.length === 0 ? (
                <div className="text-xs text-muted italic">No backlinks yet.</div>
              ) : (
                <ul className="space-y-1">
                  {backlinks.map((b) => (
                    <li key={b.path}>
                      <button
                        onClick={() => onNavigate(b.path)}
                        className="text-left w-full px-2 py-1 rounded hover:bg-white/[0.04] transition-colors"
                      >
                        <span className="text-[13px] text-accent hover:text-ink">{b.title}</span>
                        <span className="text-muted text-[11px] ml-2 font-mono">{b.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Comments */}
          <div className="mt-14 pt-6 border-t border-black/8">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted mb-3">
              Comments ({comments.length})
            </div>
            {comments.length === 0 ? (
              <div className="text-xs text-muted italic mb-3">No comments yet.</div>
            ) : (
              <div className="space-y-3 mb-4">
                {comments.map((c) => {
                  const author = users.get(c.author_id);
                  return (
                    <div key={c.id} className="text-[13px] flex gap-3">
                      <div
                        className="w-7 h-7 rounded-full bg-accent/15 text-accent flex items-center justify-center text-[11px] font-medium shrink-0"
                        title={author?.email || ''}
                      >
                        {(author?.name || '?').slice(0, 1).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11.5px] text-muted">
                          <span className="font-medium text-ink">
                            {author?.name || `user #${c.author_id}`}
                          </span>
                          <span className="ml-1.5">
                            {new Date(c.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="mt-0.5 leading-relaxed">{c.body}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <input
                className="form-input flex-1 h-9"
                placeholder="Comment…"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && postComment()}
              />
              <button
                className="btn"
                onClick={postComment}
                disabled={!newComment.trim()}
              >
                Post
              </button>
            </div>
          </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="border-l border-white/[0.06] px-5 py-6 overflow-y-auto scroll-thin bg-panel/40">
          <PageMeta
            page={page}
            users={users}
            onNavigate={onNavigate}
          />
        </aside>
      </div>

      {pageMenu && (
        <ContextMenu
          x={pageMenu.x}
          y={pageMenu.y}
          items={buildPageMenu(page)}
          onClose={() => setPageMenu(null)}
        />
      )}
    </div>
  );
}
