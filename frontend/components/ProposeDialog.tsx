'use client';
import { useEffect, useMemo, useState } from 'react';
import { X, Eye, Edit3, Columns2 } from 'lucide-react';
import Markdown from './Markdown';
import { api, type Page } from '@/lib/api';

type ViewMode = 'edit' | 'preview' | 'split';

export default function ProposeDialog({
  page, allPaths, onClose, initialPath,
}: {
  page: Page | null;
  allPaths: Set<string>;
  onClose: () => void;
  initialPath?: string;
}) {
  const [mode, setMode] = useState<'edit-existing' | 'new'>(page ? 'edit-existing' : 'new');
  const [view, setView] = useState<ViewMode>('split');
  const [title, setTitle] = useState(page?.title || '');
  const [body, setBody] = useState(page?.body || '');
  const [tags, setTags] = useState((page?.tags || []).join(', '));
  const [rationale, setRationale] = useState('');
  const [newPath, setNewPath] = useState(initialPath || '');
  const [newCategory, setNewCategory] = useState(() => {
    // Pre-pick the category if the initial path starts with a known slug.
    const guess = (initialPath || '').split('/')[0];
    const known = ['engineering', 'product', 'design', 'operations', 'research', 'sources'];
    return known.includes(guess) ? guess : 'engineering';
  });
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
              new_page: { path: newPath, category_slug: newCategory, stability: 'stable' },
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
      return <span className="text-emerald-300">Open page — auto-publishes on submit.</span>;
    if (stability === 'stable')
      return <span className="text-amber-300">Stable page — goes to the review queue.</span>;
    if (stability === 'locked')
      return <span className="text-rose-300">Locked page — admin review required.</span>;
    return null;
  }, [page, stability]);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded-lg w-[1080px] max-w-[97vw] h-[88vh] flex flex-col shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-black/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="font-medium text-[14px]">
              {done
                ? 'Submitted for review'
                : mode === 'edit-existing'
                  ? 'Suggest an edit'
                  : 'Propose a new page'}
            </h3>
            {!done && page && (
              <code className="text-[11px] text-muted bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">
                {page.path}
              </code>
            )}
            {!done && page && helperText && (
              <span className="text-[11.5px]">{helperText}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!done && (
              <div className="flex bg-black/5 rounded-md p-0.5">
                <button
                  className={`h-7 px-2 text-[11px] rounded flex items-center gap-1 ${
                    view === 'edit' ? 'bg-elev text-ink shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                  onClick={() => setView('edit')}
                  title="Edit"
                >
                  <Edit3 size={12} />
                </button>
                <button
                  className={`h-7 px-2 text-[11px] rounded flex items-center gap-1 ${
                    view === 'split' ? 'bg-elev text-ink shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                  onClick={() => setView('split')}
                  title="Split"
                >
                  <Columns2 size={12} />
                </button>
                <button
                  className={`h-7 px-2 text-[11px] rounded flex items-center gap-1 ${
                    view === 'preview' ? 'bg-elev text-ink shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                  onClick={() => setView('preview')}
                  title="Preview"
                >
                  <Eye size={12} />
                </button>
              </div>
            )}
            <button className="text-muted hover:text-ink" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        {done ? (
          <div className="p-8 space-y-4 max-w-md">
            <p className="text-[14px]">
              Your {mode === 'edit-existing' ? 'edit' : 'new page'} was submitted (revision #{done.revisionId}).
            </p>
            <p className="text-[12.5px] text-muted">
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
            {/* Metadata strip */}
            <div className="px-5 py-3 border-b border-black/8 grid grid-cols-2 gap-3">
              {mode === 'new' && (
                <>
                  <div>
                    <label className="text-[10px] uppercase tracking-[0.12em] text-muted">Path</label>
                    <input
                      className="form-input mt-1"
                      value={newPath}
                      onChange={(e) => setNewPath(e.target.value)}
                      placeholder="engineering/new-thing"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-[0.12em] text-muted">Category</label>
                    <select
                      className="form-input mt-1"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                    >
                      <option value="engineering">Engineering</option>
                      <option value="product">Product</option>
                      <option value="design">Design</option>
                      <option value="operations">Operations</option>
                      <option value="research">Research</option>
                      <option value="sources">Sources</option>
                    </select>
                  </div>
                </>
              )}
              <div className={mode === 'new' ? 'col-span-2' : ''}>
                <label className="text-[10px] uppercase tracking-[0.12em] text-muted">Title</label>
                <input
                  className="form-input mt-1"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className={mode === 'new' ? 'col-span-2' : 'col-span-2'}>
                <label className="text-[10px] uppercase tracking-[0.12em] text-muted">
                  Tags (comma-separated)
                </label>
                <input
                  className="form-input mt-1"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="architecture, database"
                />
              </div>
            </div>

            {/* Body editor and preview */}
            <div
              className={`flex-1 min-h-0 grid ${
                view === 'split' ? 'grid-cols-2' : 'grid-cols-1'
              }`}
            >
              {(view === 'edit' || view === 'split') && (
                <div className="flex flex-col min-h-0 border-r border-black/8">
                  <div className="px-5 py-2 text-[10px] uppercase tracking-[0.12em] text-muted bg-black/[0.02] border-b border-black/8">
                    Markdown
                  </div>
                  <textarea
                    className="form-input form-textarea flex-1 rounded-none border-0 px-5 py-3 text-[13px] leading-[1.6] focus:shadow-none"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={'# Your page title\n\nWrite in markdown. Use [[wiki-links]] to link to other pages.'}
                    spellCheck
                  />
                </div>
              )}
              {(view === 'preview' || view === 'split') && (
                <div className="flex flex-col min-h-0">
                  <div className="px-5 py-2 text-[10px] uppercase tracking-[0.12em] text-muted bg-black/[0.02] border-b border-black/8">
                    Preview
                  </div>
                  <div className="flex-1 overflow-y-auto scroll-thin px-6 py-5">
                    {body.trim() ? (
                      <Markdown knownPaths={allPaths}>{body}</Markdown>
                    ) : (
                      <div className="text-muted text-[13px] italic">Nothing to preview yet.</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-black/10 flex items-center gap-3">
              <input
                className="form-input flex-1 h-9"
                placeholder="Rationale — why are you proposing this change?"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={submit}
                disabled={
                  submitting || !title.trim() || !body.trim() ||
                  (mode === 'new' && !newPath.trim())
                }
              >
                {submitting ? 'Submitting…' : 'Submit for review'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
