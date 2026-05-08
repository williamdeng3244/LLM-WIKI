'use client';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  X, ShieldCheck, Loader2, AlertTriangle, CheckCircle2, Play,
  ChevronRight, ChevronDown, FileWarning, Link2Off, GitBranchPlus,
  Clock, Trash2, ExternalLink, Pencil,
} from 'lucide-react';
import {
  api, type LintReport, type LintIssue, type LintIssueKind,
  type LintIssueSeverity,
} from '@/lib/api';

const KIND_LABEL: Record<LintIssueKind, string> = {
  orphan: 'Orphan',
  broken_link: 'Broken link',
  conflict: 'Conflict',
  stale: 'Stale',
  source_drift: 'Source drift',
  other: 'Other',
};
const KIND_ICON: Record<LintIssueKind, typeof FileWarning> = {
  orphan: FileWarning,
  broken_link: Link2Off,
  conflict: AlertTriangle,
  stale: Clock,
  source_drift: GitBranchPlus,
  other: FileWarning,
};

function severityBadge(s: LintIssueSeverity) {
  if (s === 'high') return 'rejected';
  if (s === 'low') return 'accepted';
  return 'proposed';
}

export default function LintPanel({
  onClose, onNavigate, onSuggestEdit,
}: {
  onClose: () => void;
  onNavigate: (path: string) => void;
  onSuggestEdit: (path: string) => void;
}) {
  const { data: reports = [], mutate: mutateReports } = useSWR<LintReport[]>(
    'lint-reports',
    api.listLintReports,
    {
      revalidateOnFocus: false,
      // Poll while one is in flight so the UI flips when it finishes.
      refreshInterval: (latest) =>
        (latest || []).some((r) => r.status === 'planning') ? 2500 : 0,
    },
  );

  const latest = reports[0] || null;
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const activeReportId = selectedReportId ?? latest?.id ?? null;

  const { data: issues = [], mutate: mutateIssues } = useSWR<LintIssue[]>(
    activeReportId ? `lint-issues:${activeReportId}` : null,
    () => activeReportId ? api.listLintIssues(activeReportId) : Promise.resolve([]),
    { revalidateOnFocus: false },
  );

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

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

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      const rep = await api.runLint();
      setSelectedReportId(rep.id);
      await mutateReports();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function dismiss(issue: LintIssue) {
    const note = window.prompt(`Dismiss "${issue.title}"? Optional note for the audit log:`, '') ?? undefined;
    try {
      await api.dismissLintIssue(issue.id, note);
      await mutateIssues();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function acted(issue: LintIssue, then: () => void) {
    try { await api.markLintIssueActed(issue.id); await mutateIssues(); } catch {}
    then();
  }

  const grouped = useMemo(() => {
    const groups: Record<LintIssueKind, LintIssue[]> = {
      orphan: [], broken_link: [], conflict: [], stale: [],
      source_drift: [], other: [],
    };
    for (const it of issues) {
      if (!showDismissed && it.status === 'dismissed') continue;
      groups[it.kind].push(it);
    }
    return groups;
  }, [issues, showDismissed]);

  const activeReport = reports.find((r) => r.id === activeReportId) ?? null;
  const isPlanning = activeReport?.status === 'planning';
  const isFailed = activeReport?.status === 'failed';
  const visibleCount = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded-md w-[920px] max-w-[97vw] h-[90vh] flex flex-col shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-line flex items-center justify-between">
          <div>
            <h3 className="font-medium text-[14px] flex items-center gap-2">
              <ShieldCheck size={15} className="text-accent" /> Wiki lint
            </h3>
            <div className="text-[11.5px] text-muted">
              Read-only audit pass. Findings are surfaced; the agent never auto-edits.
            </div>
          </div>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-3 flex-wrap">
          <button
            className="btn btn-primary"
            onClick={runNow}
            disabled={running || isPlanning}
            title="Queue a new lint pass"
          >
            {running || isPlanning
              ? <><Loader2 size={13} className="animate-spin" /> Lint running…</>
              : <><Play size={13} /> Run lint</>}
          </button>
          {activeReport && (
            <span className="text-[11.5px] text-muted">
              Report #{activeReport.id} · {activeReport.status}
              {activeReport.provider_model && <> · {activeReport.provider_model}</>}
              {activeReport.finished_at && (
                <> · finished {new Date(activeReport.finished_at).toLocaleString()}</>
              )}
            </span>
          )}
          <label className="ml-auto text-[11px] text-muted flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(e) => setShowDismissed(e.target.checked)}
              className="accent-accent"
            />
            Show dismissed
          </label>
        </div>

        {error && (
          <div className="mx-5 mt-3 text-[11.5px] bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2 rounded">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto scroll-thin">
          {!activeReport ? (
            <div className="h-full flex flex-col items-center justify-center text-muted text-[13px] gap-2">
              <ShieldCheck size={24} />
              No lint reports yet. Click <strong className="text-ink">Run lint</strong> to start one.
            </div>
          ) : isPlanning ? (
            <div className="h-full flex flex-col items-center justify-center text-muted text-[13px] gap-2">
              <Loader2 size={20} className="animate-spin" />
              Agent is auditing the wiki…
            </div>
          ) : isFailed ? (
            <div className="h-full flex flex-col items-center justify-center text-rose-300 text-[13px] px-6 text-center gap-2">
              <AlertTriangle size={20} />
              Lint failed: {activeReport.error || 'unknown error'}
            </div>
          ) : visibleCount === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted text-[13px] gap-2 px-6 text-center">
              <CheckCircle2 size={24} className="text-emerald-300" />
              {issues.length === 0
                ? 'No issues found in this pass.'
                : 'All issues dismissed. Toggle "Show dismissed" to view them.'}
              {activeReport.summary && (
                <div className="italic mt-2 max-w-[60ch] text-[12px]">{activeReport.summary}</div>
              )}
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {activeReport.summary && (
                <div className="text-[12.5px] italic text-muted">
                  &ldquo;{activeReport.summary}&rdquo;
                </div>
              )}

              {(Object.keys(grouped) as LintIssueKind[]).map((kind) => {
                const list = grouped[kind];
                if (list.length === 0) return null;
                const Icon = KIND_ICON[kind];
                return (
                  <section key={kind}>
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted mb-2">
                      <Icon size={11} />
                      <span>{KIND_LABEL[kind]}</span>
                      <span className="text-muted/70">({list.length})</span>
                    </div>
                    <ul className="space-y-1.5">
                      {list.map((it) => (
                        <IssueRow
                          key={it.id}
                          issue={it}
                          expanded={expanded.has(it.id)}
                          onToggle={() => {
                            setExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(it.id)) next.delete(it.id); else next.add(it.id);
                              return next;
                            });
                          }}
                          onOpenPath={(p) => acted(it, () => { onNavigate(p); onClose(); })}
                          onSuggestEdit={(p) => acted(it, () => { onSuggestEdit(p); onClose(); })}
                          onDismiss={() => dismiss(it)}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {reports.length > 1 && (
          <div className="px-5 py-2 border-t border-white/[0.06] text-[11px] text-muted overflow-x-auto scroll-thin whitespace-nowrap">
            History:
            {reports.slice(0, 12).map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedReportId(r.id)}
                className={`ml-2 underline-offset-2 ${
                  r.id === activeReportId ? 'text-accent underline' : 'hover:text-ink'
                }`}
              >
                #{r.id} ({r.total_issues})
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IssueRow({
  issue, expanded, onToggle, onOpenPath, onSuggestEdit, onDismiss,
}: {
  issue: LintIssue;
  expanded: boolean;
  onToggle: () => void;
  onOpenPath: (path: string) => void;
  onSuggestEdit: (path: string) => void;
  onDismiss: () => void;
}) {
  const isDismissed = issue.status === 'dismissed';
  return (
    <li className={`border rounded-md transition-colors ${
      isDismissed
        ? 'border-white/[0.04] bg-white/[0.01] opacity-60'
        : 'border-white/[0.06] bg-elev/30'
    }`}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button onClick={onToggle} className="mt-0.5 text-muted hover:text-ink shrink-0">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`badge ${severityBadge(issue.severity)}`}>{issue.severity}</span>
            {issue.status !== 'open' && <span className="badge">{issue.status}</span>}
            <span className="text-[13px] text-ink truncate">{issue.title}</span>
          </div>
          {issue.affected_paths && issue.affected_paths.length > 0 && (
            <div className="text-[11px] text-muted mt-0.5 truncate font-mono">
              {issue.affected_paths.join(' · ')}
            </div>
          )}
          {expanded && (
            <div className="mt-2 space-y-2 text-[12.5px]">
              {issue.description && (
                <div className="text-ink/85 whitespace-pre-wrap">{issue.description}</div>
              )}
              {issue.suggested_action && (
                <div className="bg-amber-500/[0.08] border-l-2 border-amber-400 px-2 py-1 text-amber-300 italic">
                  {issue.suggested_action}
                </div>
              )}
              {issue.dismiss_note && (
                <div className="text-muted italic">Dismiss note: {issue.dismiss_note}</div>
              )}
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {(issue.affected_paths ?? []).map((p) => (
                  <span key={p} className="flex items-center gap-1">
                    <button
                      className="btn"
                      onClick={() => onOpenPath(p)}
                      title="Open this page"
                    >
                      <ExternalLink size={11} /> Open {p}
                    </button>
                    <button
                      className="btn"
                      onClick={() => onSuggestEdit(p)}
                      title="Open Suggest edit on this page"
                    >
                      <Pencil size={11} /> Suggest edit
                    </button>
                  </span>
                ))}
                {!isDismissed && (
                  <button
                    className="btn ml-auto"
                    onClick={onDismiss}
                    title="Dismiss — kept in audit log"
                  >
                    <Trash2 size={11} /> Dismiss
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
