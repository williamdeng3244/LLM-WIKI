'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Eye, Edit3 } from 'lucide-react';
import Markdown from './Markdown';
import { useLanguage } from '@/lib/i18n';
import { api, type Page } from '@/lib/api';

type ViewMode = 'edit' | 'preview';

// Seed categories (translated via i18n) that always appear in the
// dropdown even if no page is filed under them yet. Anything else is
// derived dynamically from existing paths + user-created folders.
const SEED_CATEGORIES = [
  'engineering', 'product', 'design', 'operations', 'research', 'sources',
] as const;

function deriveCategories(
  allPaths: Set<string>,
  customFolders: readonly string[],
): string[] {
  const seen = new Set<string>(SEED_CATEGORIES);
  for (const f of customFolders) seen.add(f);
  for (const p of allPaths) {
    const first = p.split('/')[0];
    if (first) seen.add(first);
  }
  return Array.from(seen).sort();
}


function slugifyPath(name: string): string {
  // Turn a free-typed note name into a safe path segment: lowercase, and
  // spaces / path- or URL-breaking chars → hyphens. Keeps letters/digits
  // (including CJK) so a Chinese note name still produces a usable path.
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[\\/#%?]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function ProposeDialog({
  page, allPaths, customFolders, onClose, initialPath,
}: {
  page: Page | null;
  allPaths: Set<string>;
  /** Folders the user has manually created via the file-tree toolbar.
   *  Included in the category dropdown alongside ones derived from
   *  existing page paths. Optional for backwards compatibility. */
  customFolders?: readonly string[];
  onClose: () => void;
  initialPath?: string;
}) {
  const { t } = useLanguage();
  // Tracks whether a click sequence began on the backdrop itself (vs a text
  // drag that started inside the dialog) so we only close on a real backdrop
  // click — see the onMouseDown/onClick handlers on the overlay below.
  const backdropMouseDown = useRef(false);
  const [mode, setMode] = useState<'edit-existing' | 'new'>(page ? 'edit-existing' : 'new');
  const [view, setView] = useState<ViewMode>('edit');
  const [title, setTitle] = useState(page?.title || '');
  const [body, setBody] = useState(page?.body || '');
  const [tags, setTags] = useState((page?.tags || []).join(', '));
  const [rationale, setRationale] = useState('');
  const categories = useMemo(
    () => deriveCategories(allPaths, customFolders || []),
    [allPaths, customFolders],
  );

  // New-page location is chosen as folder + name — no manual path typing.
  // The folder dropdown lists existing folders and also becomes the page's
  // category; the name is slugified into the final path segment.
  const [newFolder, setNewFolder] = useState(() => {
    const guess = (initialPath || '').split('/')[0];
    return guess && (categories.includes(guess) || SEED_CATEGORIES.includes(guess as typeof SEED_CATEGORIES[number]))
      ? guess
      : (categories[0] || 'engineering');
  });
  const [newName, setNewName] = useState(() => {
    const segs = (initialPath || '').split('/').filter(Boolean);
    return segs.length > 1 ? segs.slice(1).join('-') : '';
  });
  const newPath = newName.trim() ? `${newFolder}/${slugifyPath(newName)}` : '';
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ revisionId: number; status: string } | null>(null);

  useEffect(() => {
    if (page) {
      setMode('edit-existing');
      setTitle(page.title);
      setBody(page.body);
      setTags((page.tags || []).join(', '));
    } else {
      setMode('new');
    }
  }, [page]);

  // Lock body scroll while modal open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    setSubmitting(true);
    try {
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      const rev = await api.createDraft(
        mode === 'edit-existing' && page
          ? { page_path: page.path, title, body, tags: tagList, rationale }
          : {
              new_page: { path: newPath, category_slug: newFolder, stability: 'stable' },
              title, body, tags: tagList, rationale,
            },
      );
      const submitted = await api.submitRevision(rev.id);
      setDone({ revisionId: rev.id, status: submitted.status });
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const stability = page?.stability;
  const helperText = useMemo(() => {
    if (!page) return null;
    if (stability === 'open')
      return <span className="text-emerald-300">{t('propose.stability.open')}</span>;
    if (stability === 'stable')
      return <span className="text-amber-300">{t('propose.stability.stable')}</span>;
    if (stability === 'locked')
      return <span className="text-rose-300">{t('propose.stability.locked')}</span>;
    return null;
  }, [page, stability, t]);

  // Which required fields are still empty — drives the disabled state and an
  // inline hint + tooltip so the user knows *why* Submit is greyed out.
  const missingFields = useMemo(() => {
    const m: string[] = [];
    if (!title.trim()) m.push(t('propose.field.title'));
    if (!body.trim()) m.push(t('propose.field.body'));
    if (mode === 'new' && !newName.trim()) m.push(t('propose.field.name'));
    return m;
  }, [title, body, newName, mode, t]);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        // Only close on a genuine backdrop click. Without the mousedown check,
        // a text-selection drag that STARTS inside the dialog and releases out
        // here fires a click on the backdrop → onClose → the user loses
        // everything they were typing (the "multi-select delete closes the
        // dialog" bug).
        if (backdropMouseDown.current && e.target === e.currentTarget) onClose();
        backdropMouseDown.current = false;
      }}
    >
      <div
        className="bg-panel border border-line rounded-lg w-[1280px] max-w-[97vw] h-[88vh] flex flex-col shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-black/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="font-medium text-[1rem]">
              {done
                ? t('propose.submit')
                : mode === 'edit-existing'
                  ? t('propose.title.edit')
                  : t('propose.title.new')}
            </h3>
            {!done && page && (
              <code className="text-[0.7857rem] text-muted bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">
                {page.path}
              </code>
            )}
            {!done && page && helperText && (
              <span className="text-[0.8214rem]">{helperText}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!done && (
              // Single-button toggle: Edit ⇄ Preview. The split mode
              // was dropped per UX — the dialog is now wide enough
              // that the editor uses the full width, and the user
              // toggles to Preview when they want to see the render.
              <button
                className="h-7 px-2.5 text-[0.7857rem] rounded flex items-center gap-1.5 bg-black/5 hover:bg-black/10 text-ink"
                onClick={() => setView(view === 'edit' ? 'preview' : 'edit')}
                title={view === 'edit' ? t('propose.preview') : t('propose.markdown')}
              >
                {view === 'edit'
                  ? <><Eye size={12} /> {t('propose.preview')}</>
                  : <><Edit3 size={12} /> {t('propose.markdown')}</>}
              </button>
            )}
            <button className="text-muted hover:text-ink" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        {done ? (
          <div className="p-8 space-y-4 max-w-md">
            <p className="text-[1rem]">
              Your {mode === 'edit-existing' ? 'edit' : 'new page'} was submitted (revision #{done.revisionId}).
            </p>
            <p className="text-[0.8929rem] text-muted">
              Status: <span className={`badge ${done.status}`}>{done.status}</span>
              {done.status === 'accepted' &&
                ' — open page autopublishes; your change is live.'}
              {done.status === 'proposed' &&
                ' — an editor or admin will review it. You\'ll be notified.'}
            </p>
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            {/* Compact metadata strip — 4 columns on one row in 'new'
                mode (Path / Category / Title / Tags), 2 columns when
                editing (Title / Tags). Tighter padding so the body
                gets ~2/3 of the dialog instead of ~1/2. */}
            <div className={`px-5 py-2.5 border-b border-black/8 grid gap-3 shrink-0 ${
              mode === 'new' ? 'grid-cols-12' : 'grid-cols-12'
            }`}>
              {mode === 'new' && (
                <>
                  <div className="col-span-3">
                    <label className="text-[0.7143rem] uppercase tracking-[0.12em] text-muted">{t('propose.field.folder')}</label>
                    <select
                      data-testid="propose-folder"
                      className="form-input mt-0.5 h-8 text-[0.8929rem]"
                      value={newFolder}
                      onChange={(e) => setNewFolder(e.target.value)}
                    >
                      {categories.map((c) => {
                        // Show translated label for seed categories;
                        // raw folder name for user-derived ones.
                        const i18nKey = `propose.category.${c}` as
                          'propose.category.engineering' | 'propose.category.product'
                          | 'propose.category.design' | 'propose.category.operations'
                          | 'propose.category.research' | 'propose.category.sources';
                        const isSeed = (SEED_CATEGORIES as readonly string[]).includes(c);
                        return (
                          <option key={c} value={c}>
                            {isSeed ? t(i18nKey) : c}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className="text-[0.7143rem] uppercase tracking-[0.12em] text-muted">{t('propose.field.name')}</label>
                    <input
                      data-testid="propose-name"
                      className="form-input mt-0.5 h-8 text-[0.8929rem]"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder={t('propose.field.name.placeholder')}
                    />
                    {newPath && (
                      <div className="text-[0.6786rem] text-muted mt-0.5 truncate font-mono" title={newPath}>
                        {newPath}
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className={mode === 'new' ? 'col-span-3' : 'col-span-8'}>
                <label className="text-[0.7143rem] uppercase tracking-[0.12em] text-muted">{t('propose.field.title')}</label>
                <input
                  data-testid="propose-title"
                  className="form-input mt-0.5 h-8 text-[0.8929rem]"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className={mode === 'new' ? 'col-span-3' : 'col-span-4'}>
                <label className="text-[0.7143rem] uppercase tracking-[0.12em] text-muted">
                  {t('propose.field.tags')}
                </label>
                <input
                  className="form-input mt-0.5 h-8 text-[0.8929rem]"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder={t('propose.field.tags.placeholder')}
                />
              </div>
            </div>

            {/* Body — single pane that toggles between Edit and Preview.
                No more split view; the dialog is now wide enough that
                the editor uses the full width. */}
            <div className="flex-1 min-h-0 flex flex-col">
              {view === 'edit' ? (
                <textarea
                  data-testid="propose-body"
                  className="form-input form-textarea flex-1 rounded-none border-0 px-6 py-4 text-[0.9286rem] leading-[1.6] focus:shadow-none"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t('propose.body.placeholder')}
                  spellCheck
                />
              ) : (
                <div className="flex-1 overflow-y-auto scroll-thin px-8 py-6">
                  {body.trim() ? (
                    <Markdown knownPaths={allPaths}>{body}</Markdown>
                  ) : (
                    <div className="text-muted text-[0.9286rem] italic">{t('propose.preview.empty')}</div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-black/10 flex items-center gap-3">
              <input
                className="form-input flex-1 h-9"
                placeholder={t('propose.field.rationale.placeholder')}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
              <button className="btn" onClick={onClose}>{t('propose.cancel')}</button>
              {missingFields.length > 0 && (
                <span className="text-[0.7857rem] text-amber-300 self-center">
                  {t('propose.missing.prefix')} {missingFields.join(', ')}
                </span>
              )}
              <button
                data-testid="propose-submit"
                className="btn btn-primary"
                onClick={submit}
                disabled={submitting || missingFields.length > 0}
                title={missingFields.length > 0 ? `${t('propose.missing.prefix')} ${missingFields.join(', ')}` : undefined}
              >
                {submitting ? t('propose.submitting') : t('propose.submit.action')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
