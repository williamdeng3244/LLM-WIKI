'use client';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  X, Check, AlertTriangle, Loader2, Quote, FileText, FilePlus,
  GitMerge, RotateCcw,
} from 'lucide-react';
import { api, type IngestRun, type IngestEdit } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import Markdown from './Markdown';

function kindIcon(k: IngestEdit['kind']) {
  if (k === 'create_new') return FilePlus;
  if (k === 'source_summary') return FileText;
  if (k === 'conflict') return AlertTriangle;
  return GitMerge;
}

function kindLabelKey(k: IngestEdit['kind']) {
  return ({
    edit_existing: 'ingp.kind.editExisting',
    create_new: 'ingp.kind.createNew',
    source_summary: 'ingp.kind.sourceSummary',
    conflict: 'ingp.kind.conflict',
  } as const)[k];
}

export default function IngestPlanPreview({
  runId, onClose,
}: {
  runId: number;
  onClose: () => void;
}) {
  const { data: run, mutate, isLoading } = useSWR<IngestRun>(
    `ingest-run:${runId}`,
    () => api.getIngestRun(runId),
    {
      revalidateOnFocus: false,
      // Poll while in transient states so the modal updates without action.
      refreshInterval: (r) => {
        const s = r?.status;
        return s === 'planning' || s === 'applying' ? 1500 : 0;
      },
    },
  );
  const { t } = useLanguage();
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Default to "all approved" once a plan arrives.
  useEffect(() => {
    if (run?.status === 'pending_review' && run.plan_json?.edits) {
      setApproved(new Set(run.plan_json.edits.map((_, i) => i)));
    }
  }, [run?.status, run?.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const edits = run?.plan_json?.edits || [];
  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0, unset: 0 };
    for (const e of edits) {
      const k = e.confidence as keyof typeof c | undefined;
      if (k && k in c) c[k]++; else c.unset++;
    }
    return c;
  }, [edits]);

  function toggle(i: number) {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function approve() {
    if (!run) return;
    setSubmitting(true);
    setError(null);
    try {
      const indices = approved.size === edits.length
        ? null  // all approved → send null per API contract
        : Array.from(approved).sort((a, b) => a - b);
      await api.applyIngestRun(run.id, indices ?? undefined);
      await mutate();
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  async function dismiss() {
    if (!run) return;
    if (!confirm(t('ingp.dismissConfirm'))) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.dismissIngestRun(run.id);
      await mutate();
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  const isPlanning = run?.status === 'planning';
  const isApplying = run?.status === 'applying';
  const isPending = run?.status === 'pending_review';
  const isPartiallyFailed = run?.status === 'partially_failed';
  const isFailedOrPartial = run?.status === 'failed' || isPartiallyFailed;
  const isTerminal = run?.status === 'done' || run?.status === 'dismissed'
    || run?.status === 'superseded' || run?.status === 'failed'
    || isPartiallyFailed;
  const targetCount = run?.approved_edit_indices?.length ?? edits.length;

  async function retry() {
    if (!run) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.retryIngestRun(run.id);
      await mutate();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded-md w-[920px] max-w-[97vw] h-[88vh] flex flex-col shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-line flex items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-[1rem]">{t('ingp.title')}</h3>
            <div className="text-[0.8214rem] text-muted">
              {t('ingp.run')} #{runId} · {run?.provider_model || '…'} · {run?.retrieval_strategy || '…'}
            </div>
          </div>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label={t('ingp.close')}>
            <X size={16} />
          </button>
        </header>

        {isLoading && !run ? (
          <div className="flex-1 flex items-center justify-center text-muted text-[0.9286rem]">
            <Loader2 size={18} className="animate-spin mr-2" /> {t('ingp.loadingPlan')}
          </div>
        ) : isPlanning ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted text-[0.9286rem]">
            <Loader2 size={20} className="animate-spin mb-2" />
            {t('ingp.planning')}
          </div>
        ) : run?.status === 'failed' ? (
          <div className="flex-1 flex flex-col items-center justify-center text-rose-300 text-[0.9286rem] px-6 text-center">
            <AlertTriangle size={20} className="mb-2" />
            {/* An apply-phase failure is not a *plan* failure — label it
                accordingly, and for runs recorded before run.error carried
                apply reasons, fall back to the Apply notes in `summary`
                instead of a bare "unknown error". */}
            <div>
              {run.applied_at || run.failed_count > 0 ? t('ingp.applyFailed') : t('ingp.planFailed')}{' '}
              {run.error || run.summary?.split('Apply notes:')[1]?.trim() || t('ingp.unknownError')}
            </div>
            {(run.applied_count > 0 || (run.approved_edit_indices?.length ?? 0) > 0) && (
              <div className="text-muted mt-2">
                {t('ingp.applied')} {run.applied_count}/{run.approved_edit_indices?.length ?? run.edits_count}
                {run.failed_count > 0 && <>, {run.failed_count} {t('ingp.failedSuffix')}</>}.
              </div>
            )}
            <button
              className="btn mt-4"
              onClick={retry}
              disabled={submitting}
            >
              {submitting
                ? <><Loader2 size={13} className="animate-spin" /> {t('ingp.retrying')}</>
                : <><RotateCcw size={13} /> {t('ingp.retryApply')}</>}
            </button>
          </div>
        ) : isApplying ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted text-[0.9286rem] px-6 text-center">
            <Loader2 size={20} className="animate-spin mb-2" />
            {t('ingp.applying')} {run?.applied_count ?? 0}/{targetCount} {t('ingp.selectedEdits')}
            {(run?.failed_count ?? 0) > 0 && (
              <div className="text-rose-300 text-[0.8214rem] mt-2">
                {run!.failed_count} {run!.failed_count === 1 ? t('ingp.editFailedSoFar') : t('ingp.editsFailedSoFar')}
              </div>
            )}
          </div>
        ) : isPartiallyFailed ? (
          <div className="flex-1 flex flex-col items-center justify-center text-amber-300 text-[0.9286rem] px-6 text-center">
            <AlertTriangle size={20} className="mb-2" />
            <div>{t('ingp.partiallyCompleted')}</div>
            <div className="text-muted mt-2">
              {t('ingp.appliedOf')} {run?.applied_count}/{targetCount}; {run?.failed_count} {t('ingp.failedCount')}
            </div>
            {run?.summary && (
              <div className="text-muted italic mt-3 max-w-[60ch] whitespace-pre-wrap">
                {run.summary}
              </div>
            )}
            <button
              className="btn mt-4"
              onClick={retry}
              disabled={submitting}
            >
              {submitting
                ? <><Loader2 size={13} className="animate-spin" /> {t('ingp.retrying')}</>
                : <><RotateCcw size={13} /> {t('ingp.retryRemaining')}</>}
            </button>
          </div>
        ) : isTerminal && !isPending ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted text-[0.9286rem] px-6 text-center">
            {t('ingp.thisRunIs')} {run?.status}.
            {run?.status === 'done' && (
              <div className="text-muted mt-2">
                {t('ingp.appliedOf')} {run.applied_count}/{targetCount} {t('ingp.appliedDrafts')}
              </div>
            )}
            {run?.summary && <div className="mt-3 italic max-w-[60ch] whitespace-pre-wrap">{run.summary}</div>}
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-3 flex-wrap">
              <span className="badge proposed">{edits.length} {t('ingp.editsProposed')}</span>
              {(run?.conflict_count ?? 0) > 0 && (
                <span className="badge locked">{run!.conflict_count} {t('ingp.conflicts')}</span>
              )}
              {(run?.skipped_count ?? 0) > 0 && (
                <span className="badge draft">{run!.skipped_count} {t('ingp.overCap')}</span>
              )}
              <span className="text-[0.7857rem] text-muted">
                {t('ingp.confidence')}
                {counts.high > 0 && <span className="ml-1.5 text-emerald-300">{counts.high} {t('ingp.conf.high')}</span>}
                {counts.medium > 0 && <span className="ml-1.5 text-amber-300">{counts.medium} {t('ingp.conf.medium')}</span>}
                {counts.low > 0 && <span className="ml-1.5 text-rose-300">{counts.low} {t('ingp.conf.low')}</span>}
                {counts.unset > 0 && <span className="ml-1.5 text-muted">{counts.unset} {t('ingp.conf.unset')}</span>}
              </span>
              <span className="text-[0.7857rem] text-muted ml-auto">
                {approved.size} {t('ingp.of')} {edits.length} {t('ingp.approvedOfTotal')}
              </span>
            </div>

            {run?.summary && (
              <div className="px-5 py-2 border-b border-white/[0.04] text-[0.8929rem] italic text-muted">
                &ldquo;{run.summary}&rdquo;
              </div>
            )}

            {error && (
              <div className="mx-5 mt-3 text-[0.8214rem] bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2 rounded">
                {error}
              </div>
            )}

            <div className="flex-1 overflow-y-auto scroll-thin px-5 py-4 space-y-2.5">
              {edits.length === 0 && (
                <div className="text-center text-muted text-[0.9286rem] py-8">
                  {t('ingp.noEdits')}
                </div>
              )}
              {edits.map((e, i) => {
                const Icon = kindIcon(e.kind);
                const isOpen = expanded.has(i);
                const isApproved = approved.has(i);
                return (
                  <div
                    key={i}
                    className={`border rounded-md transition-colors ${
                      isApproved
                        ? 'border-accent/50 bg-accent/[0.04]'
                        : 'border-white/[0.06] bg-elev/30'
                    }`}
                  >
                    <div className="flex items-start gap-3 p-3">
                      <input
                        type="checkbox"
                        checked={isApproved}
                        onChange={() => toggle(i)}
                        className="mt-1 accent-accent cursor-pointer"
                        disabled={!isPending || submitting}
                      />
                      <Icon size={14} className={`mt-0.5 shrink-0 ${
                        e.kind === 'conflict' ? 'text-rose-300' : 'text-accent'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="badge">{t(kindLabelKey(e.kind))}</span>
                          <code className="text-[0.7857rem] text-muted bg-white/[0.06] px-1.5 py-0.5 rounded font-mono truncate">
                            {e.path}
                          </code>
                          {e.confidence && (
                            <span className={`badge ${
                              e.confidence === 'high' ? 'accepted'
                              : e.confidence === 'low' ? 'rejected' : 'proposed'
                            }`}>{t(`ingp.conf.${e.confidence}`)}</span>
                          )}
                        </div>
                        <div className="text-[0.9286rem] text-ink mt-1 truncate">{e.title}</div>
                        <div className="text-[0.8571rem] italic text-muted mt-1">
                          &ldquo;{e.rationale}&rdquo;
                        </div>
                        {e.conflict_notes && (
                          <div className="mt-1.5 text-[0.8571rem] text-rose-300 flex items-start gap-1.5">
                            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                            <span><strong>{t('ingp.conflictLabel')}</strong> {e.conflict_notes}</span>
                          </div>
                        )}
                        {e.source_refs && e.source_refs.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {e.source_refs.map((r, idx) => (
                              <div key={idx} className="text-[0.8214rem] text-muted flex items-start gap-1.5">
                                <Quote size={10} className="shrink-0 mt-0.5 text-accent" />
                                <span className="text-ink/80 italic">&ldquo;{r.quote_or_excerpt}&rdquo;</span>
                                {r.location && <span className="text-muted/70">— {r.location}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          className="mt-2 text-[0.7857rem] text-muted hover:text-ink"
                          onClick={() => {
                            setExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(i)) next.delete(i); else next.add(i);
                              return next;
                            });
                          }}
                        >
                          {isOpen ? t('ingp.hideBody') : t('ingp.showBody')}
                        </button>
                        {isOpen && (
                          <div className="mt-2 p-3 bg-[#0a0f1e] border border-line rounded text-[0.9286rem] max-h-[280px] overflow-y-auto scroll-thin">
                            <Markdown>{e.body}</Markdown>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-5 py-3 border-t border-line flex items-center gap-3">
              <div className="text-[0.7857rem] text-muted flex items-center gap-2">
                {isApplying && <><Loader2 size={11} className="animate-spin" /> {t('ingp.applyingShort')}</>}
                {isPending && <span>{t('ingp.persistHint')}</span>}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button
                  className="btn"
                  onClick={dismiss}
                  disabled={!isPending || submitting}
                  title={t('ingp.dismissTitle')}
                >
                  {t('ingp.dismiss')}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={approve}
                  disabled={!isPending || submitting || approved.size === 0}
                >
                  {submitting
                    ? <><Loader2 size={13} className="animate-spin" /> {t('ingp.submitting')}</>
                    : <><Check size={13} /> {t('ingp.approve')} {approved.size > 0 ? `(${approved.size})` : ''}</>}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
