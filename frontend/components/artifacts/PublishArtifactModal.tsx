'use client';
import { useEffect, useRef, useState } from 'react';
import { Share2, X, Upload, Check, Copy, ExternalLink, Loader2 } from 'lucide-react';

import {
  api, type ArtifactCreateResponse, type ArtifactVisibility,
} from '@/lib/api';

/** "Publish as gated link" — modal dialog shared by the FileTree
 * right-click action (mode='page'), the Page-tab kebab (mode='page'),
 * and the /artifacts page "New artifact" tile (mode='file').
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
  mode, allowPublic, onClose, onPublished, initialVisibility,
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
  /** Pre-selected visibility when the modal opens. The page kebab's
   *  "Share private link" launches it with 'private' already chosen;
   *  defaults to 'wiki' when omitted. */
  initialVisibility?: ArtifactVisibility;
}) {
  const initialName =
    mode.kind === 'page' ? mode.initialName ?? '' : '';

  const [name, setName] = useState(initialName);
  const [visibility, setVisibility] = useState<ArtifactVisibility>(initialVisibility ?? 'wiki');
  const [expiry, setExpiry] = useState<ExpiryPreset>('never');
  const [customDate, setCustomDate] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  // mode='file' can either upload a file OR let the user write content
  // directly (paste an HTML/Markdown body). `source` toggles between them.
  const [source, setSource] = useState<'upload' | 'write'>('upload');
  const [contentFmt, setContentFmt] =
    useState<'text/markdown' | 'text/html' | 'text/plain'>('text/markdown');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ArtifactCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const firstField = useRef<HTMLInputElement | null>(null);

  // Rebase the server-built URL onto the browser's real origin. The
  // backend's PUBLIC_BASE_URL defaults to http://localhost:3000, which is
  // wrong once the wiki is served from anywhere else; the /a/ viewer is
  // same-origin (proxied through the frontend), so swapping in
  // window.location.origin yields the correct link wherever it's hosted.
  const shareUrl = result
    ? (() => {
        try { return window.location.origin + new URL(result.url).pathname; }
        catch { return result.url; }
      })()
    : '';

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
        let toPublish: File | null = file;
        if (source === 'write') {
          if (!content.trim()) throw new Error('Write some content to publish.');
          // Build a File from the typed body so it flows through the same
          // multipart upload path (and the same MIME/size validation).
          const ext = contentFmt === 'text/html' ? 'html'
            : contentFmt === 'text/markdown' ? 'md' : 'txt';
          const base = (name.trim() || 'artifact').replace(/[^\w.-]+/g, '-');
          toPublish = new File([content], `${base}.${ext}`, { type: contentFmt });
        }
        if (!toPublish) throw new Error('Pick a file or write some content to publish.');
        resp = await api.createArtifactFromFile(toPublish, opts);
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
      await navigator.clipboard.writeText(shareUrl);
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
        className="bg-panel border border-line rounded-lg w-[480px] max-w-[92vw] max-h-[90vh] flex flex-col shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-line flex items-center justify-between shrink-0">
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
          <div className="px-5 py-4 space-y-3 overflow-y-auto">
            <p className="text-[0.86rem] text-muted">
              Anyone in your wiki who clicks this link will see the artifact.
              Out-of-wiki visitors will be bounced through login first.
            </p>
            <div className="flex items-stretch gap-2">
              <input
                readOnly value={shareUrl}
                className="flex-1 bg-elev text-ink border border-line focus:border-accent focus:outline-none rounded px-2.5 py-1.5 text-[0.82rem] font-mono"
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
                href={shareUrl} target="_blank" rel="noreferrer"
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
          // Header stays pinned; the fields scroll; the footer (Cancel /
          // Publish) is pinned so it's always reachable even when the
          // "Write content" textarea makes the form tall.
          <>
          <div className="px-5 py-4 space-y-3.5 overflow-y-auto flex-1 min-h-0">
            {mode.kind === 'file' && (
              <div className="space-y-2">
                {/* Upload-a-file vs write-content-directly toggle. */}
                <div className="inline-flex rounded border border-line overflow-hidden text-[0.82rem]">
                  <button
                    type="button"
                    onClick={() => setSource('upload')}
                    className={`px-3 py-1 ${source === 'upload' ? 'bg-accent text-paper' : 'bg-panel text-muted hover:text-ink'}`}
                  >
                    Upload file
                  </button>
                  <button
                    type="button"
                    onClick={() => setSource('write')}
                    className={`px-3 py-1 border-l border-line ${source === 'write' ? 'bg-accent text-paper' : 'bg-panel text-muted hover:text-ink'}`}
                  >
                    Write content
                  </button>
                </div>

                {source === 'upload' ? (
                  <label className="block">
                    <span className="block text-[0.78rem] text-muted mb-1">
                      File <span className="text-muted/70">(HTML, Markdown, or text)</span>
                    </span>
                    <input
                      type="file"
                      accept=".html,.htm,.md,.txt,text/html,text/markdown,text/plain"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      className="text-[0.82rem]"
                    />
                    {file && (
                      <div className="text-[0.78rem] text-muted mt-1">
                        {file.name} · {(file.size / 1024).toFixed(1)} KB · {file.type || 'unknown type'}
                      </div>
                    )}
                  </label>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.78rem] text-muted">Format</span>
                      <select
                        value={contentFmt}
                        onChange={(e) => setContentFmt(e.target.value as typeof contentFmt)}
                        className="bg-elev text-ink border border-line focus:border-accent focus:outline-none rounded px-2 py-1 text-[0.82rem]"
                      >
                        <option value="text/markdown">Markdown</option>
                        <option value="text/html">HTML</option>
                        <option value="text/plain">Plain text</option>
                      </select>
                    </div>
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder={contentFmt === 'text/html'
                        ? '<h1>Hello</h1>\n<p>Paste or write your HTML…</p>'
                        : contentFmt === 'text/markdown'
                          ? '# Title\n\nWrite or paste Markdown…'
                          : 'Write or paste text…'}
                      rows={6}
                      className="w-full bg-elev text-ink border border-line focus:border-accent focus:outline-none rounded px-2.5 py-2 text-[0.82rem] font-mono resize-y"
                    />
                  </div>
                )}
              </div>
            )}

            <label className="block">
              <span className="block text-[0.78rem] text-muted mb-1">Name</span>
              <input
                ref={firstField}
                type="text" value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={mode.kind === 'page' ? 'Defaults to the page title' : 'Optional'}
                className="w-full bg-elev text-ink border border-line focus:border-accent focus:outline-none rounded px-2.5 py-1.5 text-[0.86rem]"
              />
            </label>

            <fieldset className="border border-line rounded px-3 py-2">
              <legend className="text-[0.78rem] text-muted px-1">Visibility</legend>
              <label className="flex items-center gap-2 text-[0.86rem] py-1 cursor-pointer">
                <input
                  type="radio" name="vis" value="private"
                  checked={visibility === 'private'}
                  onChange={() => setVisibility('private')}
                />
                <span>Private — only you can view</span>
              </label>
              <label className="flex items-center gap-2 text-[0.86rem] py-1 cursor-pointer">
                <input
                  type="radio" name="vis" value="wiki"
                  checked={visibility === 'wiki'}
                  onChange={() => setVisibility('wiki')}
                />
                <span>Wiki — anyone signed in to this wiki can view</span>
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
                  className="mt-1.5 bg-elev text-ink border border-line focus:border-accent focus:outline-none rounded px-2 py-1 text-[0.82rem]"
                />
              )}
            </fieldset>

            {error && (
              <div className="text-[0.82rem] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">
                {error}
              </div>
            )}

          </div>
          <div className="px-5 py-3 border-t border-line flex justify-end gap-2 shrink-0">
            <button
              className="px-3 py-1.5 rounded border border-line bg-panel hover:bg-line/40 text-[0.86rem]"
              onClick={onClose} disabled={busy}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1.5 rounded bg-accent text-paper hover:opacity-90 text-[0.86rem] flex items-center gap-1.5 disabled:opacity-50"
              onClick={submit}
              disabled={busy || (mode.kind === 'file' && (
                source === 'upload' ? !file : !content.trim()
              ))}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              Publish
            </button>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
