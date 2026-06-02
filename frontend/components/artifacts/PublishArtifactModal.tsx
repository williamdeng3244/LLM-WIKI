'use client';
import { useEffect, useRef, useState } from 'react';
import { Share2, X, Upload, Check, Copy, ExternalLink, Loader2 } from 'lucide-react';

import {
  api, type ArtifactCreateResponse, type ArtifactVisibility,
} from '@/lib/api';

/** "Publish as gated link" — modal dialog shared by the FileTree
 * right-click action (mode='page'), the Page-tab kebab (mode='page'),
 * and the ArtifactsPanel "Upload new artifact" button (mode='file').
 *
 * State machine: `idle` → `submitting` → `done` (shows the URL) or
 * `idle` → `submitting` → `error`. The same component re-renders;
 * we don't navigate or unmount on success so the user can copy the
 * URL before dismissing.
 */
type Mode =
  | { kind: 'page'; pagePath: string; initialName?: string }
  | { kind: 'file' };

type ExpiryPreset = 'never' | '7d' | '30d' | 'custom';

function presetToISO(preset: ExpiryPreset, customDate: string): string | null {
  if (preset === 'never') return null;
  if (preset === '7d') {
    return new Date(Date.now() + 7 * 86400_000).toISOString();
  }
  if (preset === '30d') {
    return new Date(Date.now() + 30 * 86400_000).toISOString();
  }
  // custom: <input type=date> gives YYYY-MM-DD; parse as end-of-day UTC.
  if (!customDate) return null;
  return new Date(`${customDate}T23:59:59Z`).toISOString();
}

export default function PublishArtifactModal({
  mode, allowPublic, onClose, onPublished,
}: {
  mode: Mode;
  /** True when ARTIFACTS_ALLOW_PUBLIC=true on the instance — gates the
   *  "Public (anyone with the link)" radio. We don't actually probe the
   *  server config; the parent (page.tsx) passes whatever it knows. */
  allowPublic: boolean;
  onClose: () => void;
  /** Fires after a successful publish so the parent can refresh its
   *  artifact list. The modal stays open showing the URL. */
  onPublished?: (resp: ArtifactCreateResponse) => void;
}) {
  const initialName =
    mode.kind === 'page' ? mode.initialName ?? '' : '';

  const [name, setName] = useState(initialName);
  const [visibility, setVisibility] = useState<ArtifactVisibility>('company');
  const [expiry, setExpiry] = useState<ExpiryPreset>('never');
  const [customDate, setCustomDate] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ArtifactCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const firstField = useRef<HTMLInputElement | null>(null);

  // Esc closes; body scroll lock.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    firstField.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const opts = {
        name: name.trim() || undefined,
        visibility,
        expires_at: presetToISO(expiry, customDate),
      };
      let resp: ArtifactCreateResponse;
      if (mode.kind === 'file') {
        if (!file) throw new Error('Pick a file to publish.');
        resp = await api.createArtifactFromFile(file, opts);
      } else {
        resp = await api.createArtifactFromPage(mode.pagePath, opts);
      }
      setResult(resp);
      onPublished?.(resp);
    } catch (e: unknown) {
      setError((e as Error).message || 'Publish failed.');
    } finally {
      setBusy(false);
    }
  }

  async function copyURL() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded-lg w-[480px] max-w-[92vw] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 size={14} className="text-accent" />
            <h3 className="font-medium text-[1rem]">
              {result ? 'Artifact published' : 'Publish as gated link'}
            </h3>
          </div>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {result ? (
          // ── Success state ────────────────────────────────────────────
          <div className="px-5 py-4 space-y-3">
            <p className="text-[0.86rem] text-muted">
              Anyone in your wiki who clicks this link will see the artifact.
              Out-of-wiki visitors will be bounced through login first.
            </p>
            <div className="flex items-stretch gap-2">
              <input
                readOnly value={result.url}
                className="flex-1 bg-bg border border-line rounded px-2.5 py-1.5 text-[0.82rem] font-mono"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                className="px-2.5 py-1.5 rounded border border-line bg-panel hover:bg-line/40 text-[0.82rem] flex items-center gap-1.5"
                onClick={copyURL}
              >
                {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <a
                href={result.url} target="_blank" rel="noreferrer"
                className="px-2.5 py-1.5 rounded border border-line bg-panel hover:bg-line/40 text-[0.82rem] flex items-center gap-1.5"
              >
                <ExternalLink size={13} /> Open
              </a>
            </div>
            <div className="text-[0.78rem] text-muted">
              short_id: <code>{result.short_id}</code>
              {' · '}version {result.version}
            </div>
            <div className="flex justify-end pt-1">
              <button
                className="px-3 py-1.5 rounded bg-accent text-paper hover:opacity-90 text-[0.86rem]"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          // ── Form state ──────────────────────────────────────────────
          <div className="px-5 py-4 space-y-3.5">
            {mode.kind === 'file' && (
              <label className="block">
                <span className="block text-[0.78rem] text-muted mb-1">File</span>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept=".html,.htm,.md,.txt,text/html,text/markdown,text/plain"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="text-[0.82rem]"
                  />
                </div>
                {file && (
                  <div className="text-[0.78rem] text-muted mt-1">
                    {file.name} · {(file.size / 1024).toFixed(1)} KB · {file.type || 'unknown type'}
                  </div>
                )}
              </label>
            )}

            <label className="block">
              <span className="block text-[0.78rem] text-muted mb-1">Name</span>
              <input
                ref={firstField}
                type="text" value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={mode.kind === 'page' ? 'Defaults to the page title' : 'Optional'}
                className="w-full bg-bg border border-line rounded px-2.5 py-1.5 text-[0.86rem]"
              />
            </label>

            <fieldset className="border border-line rounded px-3 py-2">
              <legend className="text-[0.78rem] text-muted px-1">Visibility</legend>
              <label className="flex items-center gap-2 text-[0.86rem] py-1 cursor-pointer">
                <input
                  type="radio" name="vis" value="company"
                  checked={visibility === 'company'}
                  onChange={() => setVisibility('company')}
                />
                <span>Company — anyone in this wiki can view</span>
              </label>
              <label
                className={`flex items-center gap-2 text-[0.86rem] py-1 ${allowPublic ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                title={allowPublic ? '' : 'Disabled by ARTIFACTS_ALLOW_PUBLIC=false on this instance'}
              >
                <input
                  type="radio" name="vis" value="public"
                  disabled={!allowPublic}
                  checked={visibility === 'public'}
                  onChange={() => setVisibility('public')}
                />
                <span>Public — anyone with the link, no login required</span>
              </label>
            </fieldset>

            <fieldset className="border border-line rounded px-3 py-2">
              <legend className="text-[0.78rem] text-muted px-1">Expiration</legend>
              <div className="grid grid-cols-2 gap-x-3 text-[0.86rem]">
                {(['never', '7d', '30d', 'custom'] as ExpiryPreset[]).map((opt) => (
                  <label key={opt} className="flex items-center gap-2 py-1 cursor-pointer">
                    <input
                      type="radio" name="exp" value={opt}
                      checked={expiry === opt}
                      onChange={() => setExpiry(opt)}
                    />
                    <span>
                      {opt === 'never' ? 'Never' :
                       opt === '7d' ? '7 days' :
                       opt === '30d' ? '30 days' : 'Custom…'}
                    </span>
                  </label>
                ))}
              </div>
              {expiry === 'custom' && (
                <input
                  type="date" value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="mt-1.5 bg-bg border border-line rounded px-2 py-1 text-[0.82rem]"
                />
              )}
            </fieldset>

            {error && (
              <div className="text-[0.82rem] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                className="px-3 py-1.5 rounded border border-line bg-panel hover:bg-line/40 text-[0.86rem]"
                onClick={onClose} disabled={busy}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 rounded bg-accent text-paper hover:opacity-90 text-[0.86rem] flex items-center gap-1.5 disabled:opacity-50"
                onClick={submit}
                disabled={busy || (mode.kind === 'file' && !file)}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Publish
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
