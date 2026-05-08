'use client';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { X, Save, RotateCcw, BookText, Loader2, Lock } from 'lucide-react';
import Markdown from './Markdown';
import { api } from '@/lib/api';

export default function SchemaEditor({ onClose }: { onClose: () => void }) {
  const { data, mutate, isLoading } = useSWR(
    'idea-file', api.getIdeaFile,
    { revalidateOnFocus: false },
  );
  const [draft, setDraft] = useState('');
  const [view, setView] = useState<'edit' | 'split' | 'preview'>('split');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (data) setDraft(data.content);
  }, [data?.content]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dirty = !!data && draft !== data.content;
  const canEdit = !!data?.can_edit;

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api.updateIdeaFile(draft);
      await mutate(next, { revalidate: false });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    if (data) setDraft(data.content);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded-md w-[1080px] max-w-[97vw] h-[88vh] flex flex-col shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-line flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <BookText size={15} className="text-accent shrink-0" />
            <h3 className="font-medium text-[14px]">Agent playbook</h3>
            <code className="text-[11px] text-muted bg-white/[0.06] px-1.5 py-0.5 rounded font-mono truncate">
              {data?.path || '/config/agents.md'}
            </code>
            {!canEdit && !isLoading && (
              <span className="flex items-center gap-1 text-[11px] text-muted">
                <Lock size={11} /> read-only
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-white/[0.04] rounded-md p-0.5 text-[11px]">
              {(['edit', 'split', 'preview'] as const).map((m) => (
                <button
                  key={m}
                  className={`h-7 px-2 rounded transition-colors ${
                    view === m ? 'bg-elev text-ink shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                  onClick={() => setView(m)}
                >
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="px-5 py-2 border-b border-white/[0.06] text-[11.5px] text-muted">
          This file is injected into the agent's context for ingest and lint.
          Edit the conventions here and every future agent run picks them up.
        </div>

        {error && (
          <div className="mx-5 mt-2 text-[11.5px] bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2 rounded">
            {error}
          </div>
        )}

        <div className={`flex-1 min-h-0 grid ${view === 'split' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {(view === 'edit' || view === 'split') && (
            <div className="flex flex-col min-h-0 border-r border-white/[0.06]">
              <div className="px-5 py-2 text-[10px] uppercase tracking-[0.18em] text-muted bg-white/[0.02] border-b border-white/[0.06]">
                Markdown
              </div>
              <textarea
                className="form-input form-textarea flex-1 rounded-none border-0 px-5 py-3 text-[13px] leading-[1.6] focus:shadow-none disabled:opacity-70"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={!canEdit || isLoading}
                spellCheck
              />
            </div>
          )}
          {(view === 'preview' || view === 'split') && (
            <div className="flex flex-col min-h-0">
              <div className="px-5 py-2 text-[10px] uppercase tracking-[0.18em] text-muted bg-white/[0.02] border-b border-white/[0.06]">
                Preview
              </div>
              <div className="flex-1 overflow-y-auto scroll-thin px-6 py-5">
                {draft.trim() ? (
                  <Markdown>{draft}</Markdown>
                ) : (
                  <div className="text-muted text-[13px] italic">Empty.</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line flex items-center gap-3">
          <div className="text-[11px] text-muted flex items-center gap-2">
            {data?.last_modified && (
              <span>
                Last saved {new Date(data.last_modified).toLocaleString()}
              </span>
            )}
            {savedAt && (
              <span className="text-emerald-300">· just saved</span>
            )}
            {dirty && canEdit && (
              <span className="text-amber-300">· unsaved changes</span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn"
              disabled={!dirty || saving}
              onClick={reset}
              title="Discard local edits"
            >
              <RotateCcw size={13} /> Reset
            </button>
            <button
              className="btn btn-primary"
              disabled={!canEdit || !dirty || saving}
              onClick={save}
              title={canEdit ? 'Save changes' : 'Admins only'}
            >
              {saving
                ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
                : <><Save size={13} /> Save</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
