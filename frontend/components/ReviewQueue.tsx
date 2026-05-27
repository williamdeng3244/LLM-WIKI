'use client';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  X, Check, RotateCcw, Bot, Quote, AlertTriangle,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import Markdown from './Markdown';
import Diff from './Diff';
import { useLanguage } from '@/lib/i18n';
import { api, type Revision, type User } from '@/lib/api';

type Tab = 'diff' | 'preview' | 'raw';

export default function ReviewQueue({
  users, allPaths, onClose, onNavigate,
}: {
  users: Map<number, User>;
  allPaths: Set<string>;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const [items, setItems] = useState<Revision[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('diff');
  const [comment, setComment] = useState('');
  // Phase 3.6: optional reviewer feedback fields when rejecting agent drafts.
  const [rejectReason, setRejectReason] = useState<string>('');
  const [rejectNotes, setRejectNotes] = useState<string>('');
  // Collapsed by default so the source-grounding section doesn't push
  // the Diff/Preview/Raw tabs and the accept/reject bar off-screen on
  // agent drafts with many citations.
  const [groundingOpen, setGroundingOpen] = useState(false);
  const { t } = useLanguage();

  async function load() {
    const list = await api.reviewQueue();
    setItems(list);
    // Keep selection if still in the queue, otherwise pick first
    setSelectedId((curr) =>
      curr && list.find((r) => r.id === curr) ? curr : list[0]?.id ?? null,
    );
  }
  useEffect(() => {
    load();
  }, []);

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selected = useMemo(
    () => items.find((r) => r.id === selectedId) || null,
    [items, selectedId],
  );

  // Fetch parent revision body for diff
  const parentId = selected?.parent_revision_id ?? null;
  const { data: parent } = useSWR(
    parentId ? `rev:${parentId}` : null,
    () => (parentId ? api.getRevision(parentId) : null),
  );

  // Provenance: only present for agent-authored revisions; 404 for human drafts.
  const { data: provenance } = useSWR(
    selected ? `prov:${selected.id}` : null,
    async () => {
      if (!selected) return null;
      try {
        return await api.getRevisionProvenance(selected.id);
      } catch {
        return null; // not agent-authored, or no provenance row
      }
    },
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    setComment('');
    setTab('diff');
    setRejectReason('');
    setRejectNotes('');
  }, [selectedId]);

  async function review(decision: 'accept' | 'reject' | 'request_changes') {
    if (!selected) return;
    try {
      // Phase 3.6: include the structured reject feedback only when
      // rejecting an agent-authored draft. For human drafts these stay null.
      const isAgentDraft = !!provenance?.is_agent_authored;
      const extras = (decision === 'reject' && isAgentDraft)
        ? { reject_reason: rejectReason || undefined, reject_notes: rejectNotes || undefined }
        : undefined;
      await api.reviewRevision(selected.id, decision, comment || undefined, extras);
      await load();
    } catch (e: unknown) {
      alert((e as Error).message);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded-lg w-[1280px] max-w-[97vw] h-[92vh] flex flex-col shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-black/10 flex items-center justify-between">
          <h3 className="font-medium text-[1rem]">
            {t('review.title')}
            <span className="ml-2 text-[0.8571rem] text-muted font-normal">
              ({items.length})
            </span>
          </h3>
          <button className="text-muted hover:text-ink" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-[300px_1fr] min-h-0">
          {/* List */}
          <div className="border-r border-black/8 overflow-y-auto scroll-thin">
            {items.length === 0 ? (
              <div className="p-5 text-[0.9286rem] text-muted">
                {t('review.empty')}
              </div>
            ) : (
              items.map((r) => {
                const author = users.get(r.author_id);
                const isSel = r.id === selectedId;
                return (
                  <button
                    key={r.id}
                    className={`block w-full text-left px-4 py-3 border-b border-black/5 ${
                      isSel ? 'bg-accent/10' : 'hover:bg-black/5'
                    }`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <div className="text-[0.9286rem] font-medium truncate">{r.title}</div>
                    <div className="text-[0.7857rem] text-muted mt-0.5 truncate">
                      {author?.name || `user #${r.author_id}`}
                      {' · '}
                      {new Date(r.created_at).toLocaleDateString()}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Detail */}
          {!selected ? (
            <div className="flex items-center justify-center text-muted text-[0.9286rem]">
              Select a revision to review.
            </div>
          ) : (
            <div className="flex flex-col min-h-0 overflow-hidden">
              {/* Header */}
              {/* Compact header: title + meta inline on one row, tabs
                  on the right. Rationale is a thin italic line. Agent
                  badge + collapsible source-grounding move below the
                  title row so the body section gets ~80px more room. */}
              <div className="px-6 pt-3 pb-2.5 border-b border-black/8 shrink-0">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-[1.0714rem] font-medium truncate min-w-0 flex-1">
                    {selected.title}
                  </span>
                  <span className="text-[0.7857rem] text-muted shrink-0">
                    {t('review.rev')} #{selected.id} · {t('review.byAuthor')}{' '}
                    {users.get(selected.author_id)?.name || `user #${selected.author_id}`}
                  </span>
                  {/* Tabs right-aligned on the same row. */}
                  <div className="flex bg-black/5 rounded-md p-0.5 shrink-0">
                    {(['diff', 'preview', 'raw'] as Tab[]).map((tabKind) => (
                      <button
                        key={tabKind}
                        className={`h-6 px-2.5 text-[0.7857rem] rounded ${
                          tab === tabKind ? 'bg-elev text-ink shadow-sm' : 'text-muted hover:text-ink'
                        }`}
                        onClick={() => setTab(tabKind)}
                      >
                        {tabKind === 'diff' ? t('review.tab.diff')
                          : tabKind === 'preview' ? t('review.tab.preview')
                          : t('review.tab.raw')}
                      </button>
                    ))}
                  </div>
                </div>
                {selected.rationale && (
                  <div className="mt-1.5 text-[0.8214rem] italic text-ink/75 truncate">
                    &ldquo;{selected.rationale}&rdquo;
                  </div>
                )}
                {provenance && provenance.is_agent_authored && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap text-[0.7857rem]">
                    <span className="inline-flex items-center gap-1 text-accent">
                      <Bot size={11} /> {t('review.agentAuthored')}
                    </span>
                    {provenance.edit_kind && (
                      <span className="badge">{provenance.edit_kind}</span>
                    )}
                    {provenance.confidence && (
                      <span
                        className={`badge ${
                          provenance.confidence === 'high' ? 'accepted'
                          : provenance.confidence === 'low' ? 'rejected'
                          : 'proposed'
                        }`}
                      >
                        {t('review.confidence')}: {provenance.confidence}
                      </span>
                    )}
                    {provenance.conflict_notes && (
                      <span className="inline-flex items-center gap-1 text-rose-300">
                        <AlertTriangle size={10} />
                        <strong>{t('review.conflict')}:</strong>{' '}
                        <span className="italic">{provenance.conflict_notes}</span>
                      </span>
                    )}
                    {provenance.source_refs && provenance.source_refs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setGroundingOpen((v) => !v)}
                        className="inline-flex items-center gap-1 text-muted hover:text-ink transition-colors"
                        title={
                          groundingOpen
                            ? t('review.sourceGrounding.collapse')
                            : t('review.sourceGrounding.expand')
                        }
                      >
                        {groundingOpen
                          ? <ChevronDown size={10} />
                          : <ChevronRight size={10} />}
                        <span>{t('review.sourceGrounding')}</span>
                        <span className="text-muted/70">
                          ({t('review.sourceGrounding.count').replace(
                            '{n}', String(provenance.source_refs.length),
                          )})
                        </span>
                      </button>
                    )}
                  </div>
                )}
                {/* Source grounding details — open/close. */}
                {groundingOpen && provenance?.source_refs && provenance.source_refs.length > 0 && (
                  <div className="mt-2 max-h-[140px] overflow-y-auto scroll-thin space-y-1.5 bg-accent/[0.05] border border-accent/20 rounded px-3 py-2 text-[0.8214rem]">
                    {provenance.source_refs.map((r, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-muted">
                        <Quote size={11} className="shrink-0 mt-0.5 text-accent" />
                        <div>
                          <div className="text-ink/85 italic">&ldquo;{r.quote_or_excerpt}&rdquo;</div>
                          {r.location && (
                            <div className="text-[0.7143rem] text-muted/80 mt-0.5">
                              {r.location}
                              {r.source_id != null && <> · raw source #{r.source_id}</>}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Body */}
              <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-6 py-4">
                {tab === 'diff' && (
                  <Diff oldText={parent?.body || ''} newText={selected.body} contextOnly />
                )}
                {tab === 'preview' && (
                  <Markdown knownPaths={allPaths} onWikiLinkClick={onNavigate}>
                    {selected.body}
                  </Markdown>
                )}
                {tab === 'raw' && (
                  <pre className="font-mono text-[0.8929rem] leading-[1.55] whitespace-pre-wrap bg-[#0a0f1e] text-ink border border-line rounded-md p-4">
                    {selected.body}
                  </pre>
                )}
              </div>

              {/* Phase 3.6: optional reviewer feedback for agent-authored
                  drafts. Surfaced only when this is an agent draft so human
                  reviews don't carry extra friction. */}
              {provenance?.is_agent_authored && (
                <div className="shrink-0 px-6 py-2.5 border-t border-white/[0.04] bg-accent/[0.04]">
                  <div className="text-[0.7143rem] uppercase tracking-[0.18em] text-muted mb-1.5">
                    {t('review.feedback.heading')}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      className="form-input h-8 max-w-[260px]"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    >
                      <option value="">{t('review.feedback.reason.placeholder')}</option>
                      <option value="wrong_page">{t('review.feedback.reason.wrong_page')}</option>
                      <option value="unsupported_claim">{t('review.feedback.reason.unsupported_claim')}</option>
                      <option value="bad_summary">{t('review.feedback.reason.bad_summary')}</option>
                      <option value="duplicate">{t('review.feedback.reason.duplicate')}</option>
                      <option value="wrong_tags">{t('review.feedback.reason.wrong_tags')}</option>
                      <option value="too_broad">{t('review.feedback.reason.too_broad')}</option>
                      <option value="too_speculative">{t('review.feedback.reason.too_speculative')}</option>
                      <option value="permission_concern">{t('review.feedback.reason.permission_concern')}</option>
                      <option value="formatting_issue">{t('review.feedback.reason.formatting_issue')}</option>
                      <option value="other">{t('review.feedback.reason.other')}</option>
                    </select>
                    <input
                      className="form-input flex-1 h-8 text-[0.8929rem]"
                      placeholder={t('review.feedback.notes.placeholder')}
                      value={rejectNotes}
                      onChange={(e) => setRejectNotes(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Decision bar — pinned, never shrinks. */}
              <div className="shrink-0 px-6 py-3 border-t border-black/10 flex items-center gap-3">
                <input
                  className="form-input flex-1 h-9"
                  placeholder={t('review.decision.comment.placeholder')}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <button
                  className="btn"
                  onClick={() => review('reject')}
                  title={t('review.decision.reject.title')}
                >
                  <X size={13} /> {t('review.decision.reject')}
                </button>
                <button
                  className="btn"
                  onClick={() => review('request_changes')}
                  title={t('review.decision.requestChanges.title')}
                >
                  <RotateCcw size={13} /> {t('review.decision.requestChanges')}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => review('accept')}
                  title={t('review.decision.accept.title')}
                >
                  <Check size={13} /> {t('review.decision.accept')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
