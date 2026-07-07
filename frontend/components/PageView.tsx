'use client';
import { useState } from 'react';
import useSWR from 'swr';
import {
  Flag as FlagIcon, Lock, Unlock, Pencil, MoreVertical,
  FolderInput, Bookmark, BookmarkCheck, GitMerge, FileDown,
  Clipboard, History, LocateFixed, Trash2, ExternalLink, Share2,
} from 'lucide-react';
import Markdown from './Markdown';
import ContextMenu, { type MenuItem } from './ContextMenu';
import { useLanguage } from '@/lib/i18n';
import { api, type Page, type PageSummary, type Comment, type Flag, type Revision, type User } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { latestOwnDraft } from '@/lib/drafts';

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return s; }
}

export default function PageView({
  page, currentUser, allPaths, users, onPropose, onLock, onNavigate,
  onRevealInTree, onShowVersionHistory,
  isBookmarked, onToggleBookmark, onDeletePage, onMovePage, onShareLink,
  onResumeDraft,
}: {
  page: Page | null;
  currentUser: User | null;
  allPaths: Set<string>;
  users: Map<number, User>;
  onPropose: () => void;
  onLock: (locked: boolean) => void;
  onNavigate: (path: string, inNewTab?: boolean) => void;
  onRevealInTree?: (path: string) => void;
  onShowVersionHistory?: (path: string) => void;
  isBookmarked?: boolean;
  onToggleBookmark?: (path: string, next: boolean) => Promise<void> | void;
  /** Admin-only delete handler. When provided, the More-actions
   *  "Delete file" item is enabled and clicks land here. The parent
   *  is responsible for confirming, closing tabs, and refetching. */
  onDeletePage?: (path: string) => Promise<void> | void;
  /** Editor/admin move-to-folder handler. When provided, the
   *  More-actions "Move file to…" item is enabled and clicks open
   *  the parent-managed MovePageDialog. */
  onMovePage?: (path: string) => void;
  /** Opens the "Publish as gated link" modal pre-set to Private for this
   *  page, from the More-actions "Share private link" item. */
  onShareLink?: (path: string) => void;
  /** Reopen the propose dialog prefilled with a bounced (request-changes)
   *  draft of the current user — wired to the draft banner below. */
  onResumeDraft?: (rev: Revision) => void;
}) {
  const [newComment, setNewComment] = useState('');
  const [pageMenu, setPageMenu] = useState<{ x: number; y: number } | null>(null);
  const { t } = useLanguage();

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

  // Backlinks are now always shown at the bottom of the page (Obsidian
  // style) — fetched on page load instead of gated behind a toggle.
  const { data: backlinks = [] } = useSWR<PageSummary[]>(
    page ? `backlinks:${page.path}` : null,
    () => (page ? api.backlinks(page.path) : Promise.resolve([])),
    { revalidateOnFocus: false },
  );

  // Revisions: used for the inline metadata strip (count + latest author).
  // Shares the SWR cache key with the version-history dialog so opening
  // history doesn't refetch.
  const { data: revisions = [] } = useSWR<Revision[]>(
    page ? `revisions:${page.path}` : null,
    () => (page ? api.listRevisions(page.path) : Promise.resolve([])),
    { revalidateOnFocus: false },
  );
  const latestRev = revisions
    .filter((r) => r.status === 'accepted' || r.status === 'superseded')[0];

  // Guard `!page.path` too: a malformed/partial page object (e.g. a stale
  // client tab, or an older cached shape) would otherwise reach the toolbar
  // `page.path.split('/')` below and crash the whole app with
  // "Cannot read properties of undefined (reading 'split')".
  if (!page || !page.path) {
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
    const promptKey =
      kind === 'incorrect' ? 'page.flag.promptIncorrect'
      : kind === 'outdated' ? 'page.flag.promptOutdated'
      : 'page.flag.promptNeedsSource';
    const note = prompt(t(promptKey));
    if (!note) return;
    await api.createFlag(page.path, kind, note);
  }

  function buildPageMenu(p: Page): MenuItem[] {
    const copyPath = async () => {
      await copyToClipboard(p.path);
    };
    // Trimmed list — removed Reading view / Add property / Find /
    // Replace / Open linked view, all of which were either informational
    // checkmarks or duplicate browser features. What's left are the
    // operations the user will actually use plus disabled placeholders
    // for rename/move/merge so they show in their final position.
    return [
      {
        kind: 'item',
        label: t('menu.file.openNewTab'),
        icon: <ExternalLink size={13} />,
        onClick: () => onNavigate(p.path, true),
      },
      {
        kind: 'item',
        label: isBookmarked ? t('menu.page.unbookmark') : t('menu.page.bookmark'),
        icon: isBookmarked ? <BookmarkCheck size={13} /> : <Bookmark size={13} />,
        disabled: !onToggleBookmark,
        onClick: onToggleBookmark
          ? () => onToggleBookmark(p.path, !isBookmarked)
          : undefined,
      },
      {
        kind: 'item',
        label: t('menu.page.reveal'),
        icon: <LocateFixed size={13} />,
        disabled: !onRevealInTree,
        onClick: () => onRevealInTree?.(p.path),
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: t('menu.page.copyPath'),
        icon: <Clipboard size={13} />,
        onClick: copyPath,
      },
      {
        kind: 'item',
        label: t('menu.page.history'),
        icon: <History size={13} />,
        disabled: !onShowVersionHistory,
        onClick: () => onShowVersionHistory?.(p.path),
      },
      {
        kind: 'item',
        label: t('menu.page.shareLink'),
        icon: <Share2 size={13} />,
        disabled: !onShareLink,
        onClick: () => onShareLink?.(p.path),
      },
      {
        kind: 'item',
        label: t('menu.page.export'),
        icon: <FileDown size={13} />,
        onClick: () => window.print(),
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: t('menu.page.rename'),
        icon: <Pencil size={13} />,
        disabled: true,
        hint: t('menu.page.backendNotWired'),
      },
      {
        kind: 'item',
        label: t('menu.page.move'),
        icon: <FolderInput size={13} />,
        disabled: !onMovePage,
        hint: !onMovePage ? t('menu.page.move.adminOnly') : undefined,
        onClick: onMovePage ? () => onMovePage(p.path) : undefined,
      },
      {
        kind: 'item',
        label: t('menu.page.merge'),
        icon: <GitMerge size={13} />,
        disabled: true,
        hint: t('menu.page.merge.hint'),
      },
      { kind: 'divider' },
      {
        kind: 'item',
        label: t('menu.page.delete'),
        icon: <Trash2 size={13} />,
        danger: true,
        // Admin-only — onDeletePage is only passed from the parent
        // when the current user has the admin role.
        disabled: !onDeletePage,
        hint: !onDeletePage ? t('menu.page.delete.adminOnly') : undefined,
        onClick: onDeletePage
          ? () => {
              if (!confirm(t('menu.page.delete.confirm').replace('{title}', p.title))) return;
              onDeletePage(p.path);
            }
          : undefined,
      },
    ];
  }

  const latestAuthor = latestRev ? users.get(latestRev.author_id) : undefined;

  return (
    <div className="h-full flex flex-col reading-wash">
      {/* Slim sticky toolbar — path + actions only. The title scrolls with
          the body below, Obsidian-style. */}
      <div className="page-toolbar shrink-0 px-6 py-2 border-b border-black/10 backdrop-blur flex items-center justify-between gap-4 z-10">
        <div
          className="page-crumb text-[0.75rem] uppercase tracking-[0.16em] font-medium truncate min-w-0"
          title={page.path}
        >
          {page.path.split('/').join(' · ')}
        </div>
        <div className="note-actions flex items-center gap-1.5 shrink-0">
          {canSuggest && (
            <button className="btn" onClick={onPropose}>
              <Pencil size={13} /> {t('page.toolbar.suggest')}
            </button>
          )}
          <div className="relative group">
            <button className="btn">
              <FlagIcon size={13} /> {t('page.toolbar.flag')}
            </button>
            <div className="absolute right-0 top-full pt-1 hidden group-hover:block z-10">
              <div className="bg-panel border border-line rounded-md shadow-lg text-xs min-w-[148px] overflow-hidden">
                <button className="block w-full text-left px-3 py-2 hover:bg-black/5"
                  onClick={() => flagPage('incorrect')}>{t('page.flag.incorrect')}</button>
                <button className="block w-full text-left px-3 py-2 hover:bg-black/5"
                  onClick={() => flagPage('outdated')}>{t('page.flag.outdated')}</button>
                <button className="block w-full text-left px-3 py-2 hover:bg-black/5"
                  onClick={() => flagPage('needs_source')}>{t('page.flag.needsSource')}</button>
              </div>
            </div>
          </div>
          {isAdmin && (
            <button className="btn" onClick={() => onLock(page.stability !== 'locked')}>
              {page.stability === 'locked'
                ? <><Unlock size={13} /> {t('page.toolbar.unlock')}</>
                : <><Lock size={13} /> {t('page.toolbar.lock')}</>}
            </button>
          )}
          <button
            className="btn btn-icon"
            title={t('page.toolbar.more')}
            aria-label={t('page.toolbar.more')}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
              setPageMenu({ x: rect.right - 240, y: rect.bottom + 4 });
            }}
          >
            <MoreVertical size={14} />
          </button>
        </div>
      </div>

      {openFlags.length > 0 && (
        <div className="px-8 py-2 bg-amber-500/[0.08] border-b border-amber-500/30 text-xs text-amber-300 flex items-start gap-2">
          <FlagIcon size={13} className="shrink-0 mt-0.5" />
          <div>
            <strong>
              {openFlags.length}{' '}
              {openFlags.length === 1 ? t('page.flags.banner.one') : t('page.flags.banner.many')}:
            </strong>{' '}
            {openFlags[0].body}
            {openFlags.length > 1 && ` (+${openFlags.length - 1} ${t('page.flags.banner.more')})`}
          </div>
        </div>
      )}

      {/* Single scrollable column. Title, metadata strip, body, backlinks,
          and comments all scroll together. Reading column is capped at
          820px and centered. */}
      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="max-w-[820px] mx-auto px-8 pt-10 pb-16">
          <h1 className="font-serif font-medium text-ink text-[2.8571rem] leading-[1.08] tracking-[-0.018em]">
            {page.title}
          </h1>

          {/* Inline metadata strip — replaces the old right-rail sidebar. */}
          <div className="mt-4 flex items-center flex-wrap gap-x-3 gap-y-2 text-[0.8214rem] text-muted">
            <span>{t('page.meta.updated')} {formatDate(page.updated_at)}</span>
            {latestAuthor && (
              <>
                <span className="text-muted/40">·</span>
                <span>
                  {t('page.meta.lastEditBy')}{' '}
                  <span className="text-ink" title={latestAuthor.email}>
                    {latestAuthor.name || `user #${latestRev!.author_id}`}
                  </span>
                </span>
              </>
            )}
            <span className="text-muted/40">·</span>
            <span className={`badge ${page.stability}`}>{page.stability}</span>
            <span className="text-muted/40">·</span>
            <button
              onClick={() => onShowVersionHistory?.(page.path)}
              className="text-muted hover:text-ink transition-colors disabled:cursor-default disabled:hover:text-muted"
              disabled={!onShowVersionHistory}
              title={onShowVersionHistory ? t('page.meta.historyTitle') : undefined}
            >
              {(revisions.length === 1
                ? t('page.meta.revisions.one')
                : t('page.meta.revisions.many')
              ).replace('{n}', String(revisions.length))}
            </button>
            {page.tags.length > 0 && (
              <>
                <span className="text-muted/40">·</span>
                {page.tags.slice(0, 8).map((t, i) => (
                  <span key={t} data-rainbow={i % 7} className="badge">#{t}</span>
                ))}
              </>
            )}
          </div>

          <div className="border-t border-black/8 mt-6 mb-8" />

          {/* Bounced-draft banner: after a reviewer requests changes the
              revision falls back to `draft` (content intact) but the page
              body only renders the *published* revision — empty for a
              never-accepted proposal. Without this entry point the author's
              text looked lost ("正文都没了，只剩标题", QA 2026-07-07). */}
          {(() => {
            const bounced = onResumeDraft && latestOwnDraft(revisions, currentUser?.id);
            return bounced ? (
              <div className="mb-6 px-4 py-3 rounded-md border border-amber-400/30 bg-amber-400/10 text-[0.8929rem] flex items-center justify-between gap-3">
                <span className="text-amber-200">{t('page.draftBanner')}</span>
                <button className="btn shrink-0" onClick={() => onResumeDraft(bounced)}>
                  <Pencil size={13} /> {t('page.draftBanner.resume')}
                </button>
              </div>
            ) : null;
          })()}

          <Markdown knownPaths={allPaths} onWikiLinkClick={onNavigate}>
            {page.body}
          </Markdown>

          {/* Backlinks — always shown at the bottom (Obsidian convention). */}
          <div className="mt-14 pt-6 border-t border-black/8">
            <div className="text-[0.7143rem] uppercase tracking-[0.18em] text-muted mb-3">
              {t('page.backlinks.title')} <span className="ml-1 text-muted/70">({backlinks.length})</span>
            </div>
            {backlinks.length === 0 ? (
              <div className="text-xs text-muted italic">{t('page.backlinks.empty')}</div>
            ) : (
              <ul className="space-y-1">
                {backlinks.map((b) => (
                  <li key={b.path}>
                    <button
                      onClick={() => onNavigate(b.path)}
                      className="text-left w-full px-2 py-1 rounded hover:bg-white/[0.04] transition-colors"
                    >
                      <span className="text-[0.9286rem] text-accent hover:text-ink">{b.title}</span>
                      <span className="text-muted text-[0.7857rem] ml-2 font-mono">{b.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Comments */}
          <div className="mt-14 pt-6 border-t border-black/8">
            <div className="text-[0.7143rem] uppercase tracking-[0.12em] text-muted mb-3">
              {t('page.comments.title')} ({comments.length})
            </div>
            {comments.length === 0 ? (
              <div className="text-xs text-muted italic mb-3">{t('page.comments.empty')}</div>
            ) : (
              <div className="space-y-3 mb-4">
                {comments.map((c) => {
                  const author = users.get(c.author_id);
                  return (
                    <div key={c.id} className="text-[0.9286rem] flex gap-3">
                      <div
                        className="w-7 h-7 rounded-full bg-accent/15 text-accent flex items-center justify-center text-[0.7857rem] font-medium shrink-0"
                        title={author?.email || ''}
                      >
                        {(author?.name || '?').slice(0, 1).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[0.8214rem] text-muted">
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
                placeholder={t('page.comments.placeholder')}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && postComment()}
              />
              <button
                className="btn"
                onClick={postComment}
                disabled={!newComment.trim()}
              >
                {t('page.comments.post')}
              </button>
            </div>
          </div>
        </div>
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
