'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  X, Upload, Download, Trash2, FileText, FileImage, FileType,
  Loader2, Play, AlertTriangle, Eye, History, RotateCcw,
  Link2, ExternalLink,
} from 'lucide-react';
import { api, type RawSource, type IngestRun, type User } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import IngestPlanPreview from './IngestPlanPreview';

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function iconFor(mime: string) {
  if (mime.startsWith('image/')) return FileImage;
  if (mime === 'application/pdf') return FileType;
  return FileText;
}

export default function SourcesPanel({
  onClose, currentUser, users,
}: {
  onClose: () => void;
  currentUser: User | null;
  users: Map<number, User>;
}) {
  const { t } = useLanguage();
  const { data: sources = [], mutate } = useSWR<RawSource[]>(
    'raw-sources', api.listRawSources,
    {
      revalidateOnFocus: false,
      // Poll while any source is mid-ingest so the row updates live.
      refreshInterval: (latest) =>
        (latest || []).some((r) => r.ingest_status === 'ingesting') ? 2500 : 0,
    },
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [importMode, setImportMode] = useState<'file' | 'url'>('file');
  const [urlInput, setUrlInput] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [importing, setImporting] = useState(false);
  const [ingestPrompt, setIngestPrompt] = useState<RawSource | null>(null);
  const [duplicateWarn, setDuplicateWarn] = useState<{
    source: RawSource;
    drafts: { revision_id: number; page_path: string; page_title: string; status: string }[];
  } | null>(null);
  const [previewRunId, setPreviewRunId] = useState<number | null>(null);
  // Source whose history rows are currently expanded.
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const externalProcessingNeeded = useMemo(() => (rs: RawSource) =>
    rs.mime_type === 'application/pdf' || rs.mime_type.startsWith('image/'),
  []);

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

  const canUpload = !!currentUser && currentUser.role !== 'reader';
  const isAdmin = currentUser?.role === 'admin';

  async function uploadFiles(files: FileList | File[]) {
    if (!canUpload) {
      setError(t('sources.err.readersUpload'));
      return;
    }
    setError(null);
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        await api.uploadRawSource(f);
      }
      await mutate();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function importFromUrl() {
    if (!canUpload) {
      setError(t('sources.err.readersImport'));
      return;
    }
    const url = urlInput.trim();
    if (!url) {
      setError(t('sources.err.enterUrl'));
      return;
    }
    setError(null);
    setImporting(true);
    try {
      await api.importRawSourceFromUrl(url, urlTitle.trim() || undefined);
      await mutate();
      setUrlInput('');
      setUrlTitle('');
    } catch (e: unknown) {
      const msg = (e as Error).message ?? '';
      // A blocked/erroring upstream comes back as "NNN: Upstream returned M
      // for …". Show an actionable hint instead of that raw string.
      setError(/Upstream returned/.test(msg) ? t('sources.err.urlUpstream') : msg);
    } finally {
      setImporting(false);
    }
  }

  async function startIngest(s: RawSource) {
    setError(null);
    try {
      const run = await api.ingestRawSource(s.id);
      await mutate();
      // Open the preview as soon as the run row exists; modal polls the
      // run until status flips from planning → pending_review.
      setPreviewRunId(run.id);
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  async function requestIngest(s: RawSource) {
    setError(null);
    // Pre-flight: warn if pending agent drafts already exist on this source.
    try {
      const drafts = await api.rawSourcePendingDrafts(s.id);
      if (drafts.length > 0) {
        setDuplicateWarn({ source: s, drafts });
        return;
      }
    } catch {
      // Non-fatal; proceed without the warning.
    }
    if (externalProcessingNeeded(s)) {
      setIngestPrompt(s);
    } else {
      startIngest(s);
    }
  }

  function continueAfterDuplicateWarning() {
    if (!duplicateWarn) return;
    const s = duplicateWarn.source;
    setDuplicateWarn(null);
    if (externalProcessingNeeded(s)) {
      setIngestPrompt(s);
    } else {
      startIngest(s);
    }
  }

  async function remove(s: RawSource) {
    if (!confirm(t('sources.deleteConfirm').replace('{title}', s.title))) return;
    try {
      await api.deleteRawSource(s.id);
      await mutate();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded-md w-[760px] max-w-[94vw] max-h-[88vh] flex flex-col shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-line flex items-center justify-between">
          <div>
            <h3 className="font-medium text-[1rem]">{t('sources.title')}</h3>
            <div className="text-[0.8214rem] text-muted">
              {t('sources.subtitle')}
            </div>
          </div>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label={t('sources.close')}>
            <X size={16} />
          </button>
        </header>

        <div className="mx-5 mt-5 flex items-center gap-1 border-b border-white/[0.06]">
          {(['file', 'url'] as const).map((m) => (
            <button
              key={m}
              className={`px-3 py-1.5 text-[0.8214rem] -mb-px border-b-2 transition-colors ${
                importMode === m
                  ? 'border-accent text-ink'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
              onClick={() => setImportMode(m)}
            >
              {m === 'file'
                ? <span className="flex items-center gap-1.5"><Upload size={12} /> {t('sources.uploadFile')}</span>
                : <span className="flex items-center gap-1.5"><Link2 size={12} /> {t('sources.fromUrl')}</span>}
            </button>
          ))}
        </div>

        {importMode === 'file' ? (
          <div
            className={`mx-5 mt-3 mb-2 p-6 border-2 border-dashed rounded-md text-center transition-colors ${
              drag ? 'border-accent bg-accent/[0.06]' : 'border-white/[0.10]'
            } ${!canUpload ? 'opacity-50' : ''}`}
            onDragOver={(e) => { e.preventDefault(); if (canUpload) setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault(); setDrag(false);
              if (canUpload && e.dataTransfer.files.length > 0) {
                uploadFiles(e.dataTransfer.files);
              }
            }}
          >
            <Upload size={20} className="mx-auto text-muted mb-2" />
            <div className="text-[0.9286rem] text-ink">{t('sources.dropHere')}</div>
            <button
              className="btn btn-primary mt-3 inline-flex"
              disabled={!canUpload || uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? <><Loader2 size={13} className="animate-spin" /> {t('sources.uploading')}</> : t('sources.chooseFile')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <div className="text-[0.75rem] text-muted mt-2">{t('sources.fileHint')}</div>
            {!canUpload && (
              <div className="text-[0.75rem] text-muted mt-1">{t('sources.signInToUpload')}</div>
            )}
          </div>
        ) : (
          <div className={`mx-5 mt-3 mb-2 p-4 border border-white/[0.10] rounded-md ${!canUpload ? 'opacity-50' : ''}`}>
            <label className="text-[0.7143rem] uppercase tracking-[0.12em] text-muted">{t('sources.url.label')}</label>
            <input
              type="url"
              className="form-input mt-1 h-9 w-full text-[0.8929rem]"
              placeholder="https://example.com/article"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={!canUpload || importing}
              onKeyDown={(e) => { if (e.key === 'Enter') importFromUrl(); }}
            />
            <label className="text-[0.7143rem] uppercase tracking-[0.12em] text-muted mt-2 block">
              {t('sources.url.titleLabel')}
            </label>
            <input
              type="text"
              className="form-input mt-1 h-9 w-full text-[0.8929rem]"
              placeholder={t('sources.url.titlePlaceholder')}
              value={urlTitle}
              onChange={(e) => setUrlTitle(e.target.value)}
              disabled={!canUpload || importing}
            />
            <button
              className="btn btn-primary mt-3 inline-flex"
              disabled={!canUpload || importing || !urlInput.trim()}
              onClick={importFromUrl}
            >
              {importing
                ? <><Loader2 size={13} className="animate-spin" /> {t('sources.url.fetching')}</>
                : <><Link2 size={12} /> {t('sources.url.import')}</>}
            </button>
            <div className="text-[0.75rem] text-muted mt-2">
              {t('sources.url.hint')}
            </div>
            {!canUpload && (
              <div className="text-[0.75rem] text-muted mt-1">{t('sources.signInToUpload')}</div>
            )}
          </div>
        )}

        {error && (
          <div className="mx-5 mb-2 text-[0.8214rem] bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2 rounded">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto scroll-thin px-5 pb-5">
          {sources.length === 0 ? (
            <div className="text-center text-muted text-[0.8929rem] py-6">
              {t('sources.emptyDrop')}
            </div>
          ) : (
            <ul className="space-y-2">
              {sources.map((s) => {
                const Icon = iconFor(s.mime_type);
                const uploader = s.uploaded_by_id ? users.get(s.uploaded_by_id) : null;
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-start gap-3 p-3 rounded-md bg-elev/40 border border-white/[0.05] hover:border-white/[0.10] transition-colors"
                  >
                    <Icon size={20} className="text-accent shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[0.9286rem] text-ink truncate">{s.title}</span>
                        <span className={`badge ${s.ingest_status === 'done' ? 'accepted' : s.ingest_status === 'failed' ? 'rejected' : s.ingest_status === 'ingesting' ? 'proposed' : 'draft'}`}>
                          {s.ingest_status}
                        </span>
                      </div>
                      <div className="text-[0.7857rem] text-muted mt-0.5 truncate font-mono">
                        {s.original_filename} · {fmtSize(s.size_bytes)} · {s.mime_type}
                      </div>
                      {s.source_url && (
                        <a
                          href={s.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[0.75rem] text-accent hover:underline mt-1 inline-flex items-center gap-1 truncate max-w-full"
                          title={s.source_url}
                        >
                          <ExternalLink size={11} className="shrink-0" />
                          <span className="truncate">{s.source_url}</span>
                        </a>
                      )}
                      <div className="text-[0.75rem] text-muted mt-1">
                        {t('sources.uploadedBy')} {uploader?.name || `user #${s.uploaded_by_id ?? '?'}`}
                        {' · '}
                        {new Date(s.uploaded_at).toLocaleString()}
                      </div>
                      {s.description && (
                        <div className="text-[0.8571rem] italic text-muted mt-1">
                          &ldquo;{s.description}&rdquo;
                        </div>
                      )}
                      {s.last_ingest_notes && (
                        <div className="text-[0.8214rem] text-muted/85 mt-2 border-l-2 border-white/[0.08] pl-2">
                          {s.last_ingest_notes}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {canUpload && s.ingest_status === 'ingesting' && (
                        <button
                          className="btn"
                          onClick={async () => {
                            try {
                              const runs = await api.rawSourceRuns(s.id);
                              if (runs.length > 0) setPreviewRunId(runs[0].id);
                              else setError(t('sources.err.noPlan'));
                            } catch (e) { setError((e as Error).message); }
                          }}
                          title={t('sources.openLatest')}
                        >
                          <Eye size={13} /> {t('sources.openPlan')}
                        </button>
                      )}
                      {canUpload && s.ingest_status !== 'ingesting' && (
                        <button
                          className={s.ingest_status === 'failed' ? 'btn btn-primary' : 'btn'}
                          onClick={() => requestIngest(s)}
                          title={s.ingest_status === 'failed'
                            ? t('sources.retryIngestTitle')
                            : t('sources.ingestTitle')}
                        >
                          <Play size={13} /> {s.ingest_status === 'failed' ? t('sources.retryIngest') : t('sources.ingest')}
                        </button>
                      )}
                      <button
                        className="btn btn-icon"
                        onClick={() => setHistoryFor(historyFor === s.id ? null : s.id)}
                        title={t('sources.history')}
                      >
                        <History size={13} />
                      </button>
                      <a
                        className="btn btn-icon"
                        href={api.rawSourceDownloadURL(s.id)}
                        target="_blank"
                        rel="noreferrer"
                        title={t('sources.download')}
                      >
                        <Download size={13} />
                      </a>
                      {isAdmin && (
                        <button
                          className="btn btn-icon"
                          onClick={() => remove(s)}
                          title={t('sources.deleteAdmin')}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    {historyFor === s.id && (
                      <div className="basis-full">
                        <SourceHistory
                          sourceId={s.id}
                          users={users}
                          onOpenPlan={(id) => setPreviewRunId(id)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {previewRunId !== null && (
        <IngestPlanPreview
          runId={previewRunId}
          onClose={() => { setPreviewRunId(null); mutate(); }}
        />
      )}

      {duplicateWarn && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center"
          onClick={() => setDuplicateWarn(null)}
        >
          <div
            className="bg-panel border border-line rounded-md w-[520px] max-w-[92vw] p-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle size={18} className="text-amber-300 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-[1rem] text-ink">
                  {t('sources.dup.thisSourceHas')} {duplicateWarn.drafts.length} {duplicateWarn.drafts.length === 1 ? t('sources.dup.heading.one') : t('sources.dup.heading.many')}
                </h4>
                <p className="text-[0.8929rem] text-muted mt-1 leading-relaxed">
                  {t('sources.dup.body')}
                </p>
              </div>
            </div>
            <ul className="space-y-1 max-h-[180px] overflow-y-auto scroll-thin mb-4">
              {duplicateWarn.drafts.map((d) => (
                <li key={d.revision_id} className="text-[0.8571rem] text-muted flex items-center gap-2">
                  <span className={`badge ${d.status}`}>{d.status}</span>
                  <code className="font-mono truncate">{d.page_path}</code>
                  <span className="truncate">— {d.page_title}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-end gap-2">
              <button className="btn" onClick={() => setDuplicateWarn(null)}>{t('sources.dup.cancel')}</button>
              <button className="btn btn-primary" onClick={continueAfterDuplicateWarning}>
                {t('sources.dup.continue')}
              </button>
            </div>
          </div>
        </div>
      )}

      {ingestPrompt && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center"
          onClick={() => setIngestPrompt(null)}
        >
          <div
            className="bg-panel border border-line rounded-md w-[480px] max-w-[92vw] p-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle size={18} className="text-amber-300 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-[1rem] text-ink">{t('sources.ext.heading')}</h4>
                <p className="text-[0.8929rem] text-muted mt-1 leading-relaxed">
                  {t('sources.ext.body1').replace('{mime}', ingestPrompt.mime_type)}
                </p>
                <p className="text-[0.8929rem] text-muted mt-2 leading-relaxed">
                  {t('sources.ext.body2')}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button className="btn" onClick={() => setIngestPrompt(null)}>{t('sources.ext.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const s = ingestPrompt;
                  setIngestPrompt(null);
                  if (s) startIngest(s);
                }}
              >
                <Play size={13} /> {t('sources.ext.sendAndPlan')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline ingest history shown below a source row when its History button is
// clicked. Each entry shows the run's status, timing, counts, model, and a
// link back into the plan preview if a plan is on file.
function SourceHistory({
  sourceId, users, onOpenPlan,
}: {
  sourceId: number;
  users: Map<number, User>;
  onOpenPlan: (id: number) => void;
}) {
  const { t } = useLanguage();
  const { data: runs = [], isLoading, mutate } = useSWR<IngestRun[]>(
    `raw-runs:${sourceId}`,
    () => api.rawSourceRuns(sourceId),
    { revalidateOnFocus: false, refreshInterval: 4000 },
  );

  async function retry(r: IngestRun) {
    try {
      await api.retryIngestRun(r.id);
      await mutate();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  if (isLoading) return <div className="text-[0.8214rem] text-muted py-2">{t('sources.loadingHistory')}</div>;
  if (runs.length === 0) return <div className="text-[0.8214rem] text-muted py-2">{t('sources.noHistory')}</div>;
  return (
    <ul className="mt-2 space-y-1.5 border-t border-white/[0.05] pt-2">
      {runs.map((r) => {
        const triggerer = r.triggered_by_id ? users.get(r.triggered_by_id) : null;
        const agent = r.agent_user_id ? users.get(r.agent_user_id) : null;
        const target = r.approved_edit_indices?.length ?? r.edits_count;
        const showProgress = r.status === 'applying'
          || r.status === 'partially_failed'
          || (r.status === 'done' && r.applied_count > 0);
        const canRetry = r.status === 'applying'
          || r.status === 'failed'
          || r.status === 'partially_failed';
        return (
          <li
            key={r.id}
            className="text-[0.8214rem] flex items-start gap-2 px-2 py-1.5 rounded bg-white/[0.02]"
          >
            <span className={`badge shrink-0 ${
              r.status === 'done' ? 'accepted'
              : r.status === 'failed' ? 'rejected'
              : r.status === 'partially_failed' ? 'proposed'
              : r.status === 'pending_review' ? 'proposed'
              : 'draft'
            }`}>{r.status}</span>
            <div className="flex-1 min-w-0">
              <div className="text-ink/85">
                {t('sources.run')} #{r.id} ·{' '}
                <span className="text-muted">
                  {triggerer?.name || `user #${r.triggered_by_id ?? '?'}`} →{' '}
                  {agent?.name || (r.agent_user_id ? `agent #${r.agent_user_id}` : t('sources.pendingAgent'))}
                </span>
              </div>
              <div className="text-[0.75rem] text-muted mt-0.5 truncate">
                {new Date(r.started_at).toLocaleString()}
                {r.finished_at && <> → {new Date(r.finished_at).toLocaleString()}</>}
                {' · '}
                {showProgress
                  ? <>{t('sources.applied')} {r.applied_count}/{target} {t('sources.selectedEdits')}</>
                  : <>{r.edits_count} {t('sources.edits')}</>}
                {r.failed_count > 0 && <span className="text-rose-300">, {r.failed_count} {t('sources.failed')}</span>}
                {r.conflict_count > 0 && <>, {r.conflict_count} {t('sources.conflicts')}</>}
                {r.skipped_count > 0 && <>, {r.skipped_count} {t('sources.overCap')}</>}
                {r.provider_model && <> · {r.provider_model}</>}
                {r.retrieval_strategy && <> · {r.retrieval_strategy}</>}
              </div>
              {r.error && <div className="text-[0.75rem] text-rose-300 mt-0.5">{r.error}</div>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {canRetry && (
                <button
                  className="text-[0.75rem] text-amber-300 hover:text-ink flex items-center gap-1"
                  onClick={() => retry(r)}
                  title={t('sources.retryRunTitle')}
                >
                  <RotateCcw size={10} /> {t('sources.retry')}
                </button>
              )}
              {r.plan_json && (
                <button
                  className="text-[0.75rem] text-accent hover:text-ink underline"
                  onClick={() => onOpenPlan(r.id)}
                >
                  {t('sources.openPlanLink')}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
