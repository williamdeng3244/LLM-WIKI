'use client';
import { useEffect, useMemo, useState } from 'react';
import { X, FolderInput, Loader2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

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

  // Compute the available folder list: every path-prefix that exists
  // in any page's path, union'd with user-created custom folders.
  // Sorted alphabetically; the empty string is the root option.
  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const p of allPaths) {
      const i = p.lastIndexOf('/');
      if (i > 0) set.add(p.slice(0, i));
    }
    for (const f of customFolders) set.add(f);
    // Don't show the page's current folder as an option — moving to it
    // would be a no-op anyway, and seeing it selectable is confusing.
    const currentFolder = page.path.lastIndexOf('/') > 0
      ? page.path.slice(0, page.path.lastIndexOf('/'))
      : '';
    set.delete(currentFolder);
    return Array.from(set).sort();
  }, [allPaths, customFolders, page.path]);

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

          <label className="block">
            <span className="text-[0.7143rem] uppercase tracking-[0.12em] text-muted">
              {t('movePage.target')}
            </span>
            <select
              className="form-input mt-1 h-9 w-full text-[0.8929rem]"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={busy}
            >
              <option value="">{t('movePage.root')}</option>
              {folders.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>

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
