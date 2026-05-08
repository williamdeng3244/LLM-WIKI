'use client';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { X, Check, RotateCcw, Bot, Quote, AlertTriangle } from 'lucide-react';
import Markdown from './Markdown';
import Diff from './Diff';
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
          <h3 className="font-medium text-[14px]">
            Review queue
            <span className="ml-2 text-[12px] text-muted font-normal">
              ({items.length} pending)
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
              <div className="p-5 text-[13px] text-muted">
                Empty. Nice and clean.
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
                    <div className="text-[13px] font-medium truncate">{r.title}</div>
                    <div className="text-[11px] text-muted mt-0.5 truncate">
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
            <div className="flex items-center justify-center text-muted text-[13px]">
              Select a revision to review.
            </div>
          ) : (
            <div className="flex flex-col min-h-0">
              {/* Header */}
              <div className="px-6 pt-4 pb-3 border-b border-black/8">
                <div className="text-[11px] text-muted">
                  rev #{selected.id} ·{' '}
                  {users.get(selected.author_id)?.name || `user #${selected.author_id}`}
                </div>
                <div className="text-[18px] font-medium mt-1">{selected.title}</div>
                {selected.rationale && (
                  <div className="mt-3 text-[13px] italic text-ink/85 bg-amber-500/[0.08] border-l-2 border-amber-400 px-3 py-2 rounded-r">
                    &ldquo;{selected.rationale}&rdquo;
                  </div>
                )}

                {provenance && provenance.is_agent_authored && (
                  <div className="mt-3 bg-accent/[0.08] border border-accent/30 rounded-md px-3 py-2.5 text-[12px]">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Bot size={12} className="text-accent" />
                      <span className="font-medium text-ink">Agent-authored</span>
                      {provenance.edit_kind && (
                        <span className="badge ml-1">{provenance.edit_kind}</span>
                      )}
                      {provenance.confidence && (
                        <span
                          className={`badge ml-1 ${
                            provenance.confidence === 'high' ? 'accepted'
                            : provenance.confidence === 'low' ? 'rejected'
                            : 'proposed'
                          }`}
                        >
                          confidence: {provenance.confidence}
                        </span>
                      )}
                    </div>
                    {provenance.conflict_notes && (
                      <div className="flex items-start gap-1.5 mb-2 text-rose-300">
                        <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                        <span><strong>Conflict:</strong> {provenance.conflict_notes}</span>
                      </div>
                    )}
                    {provenance.source_refs && provenance.source_refs.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10.5px] uppercase tracking-[0.18em] text-muted">
                          Source grounding
                        </div>
                        {provenance.source_refs.map((r, i) => (
                          <div key={i} className="flex items-start gap-1.5 text-muted">
                            <Quote size={11} className="shrink-0 mt-0.5 text-accent" />
                            <div>
                              <div className="text-ink/85 italic">&ldquo;{r.quote_or_excerpt}&rdquo;</div>
                              {r.location && (
                                <div className="text-[10.5px] text-muted/80 mt-0.5">
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
                )}
                <div className="mt-3 flex bg-black/5 rounded-md p-0.5 w-fit">
                  {(['diff', 'preview', 'raw'] as Tab[]).map((t) => (
                    <button
                      key={t}
                      className={`h-7 px-3 text-[11px] rounded ${
                        tab === t ? 'bg-elev text-ink shadow-sm' : 'text-muted hover:text-ink'
                      }`}
                      onClick={() => setTab(t)}
                    >
                      {t === 'diff' ? 'Diff' : t === 'preview' ? 'Preview' : 'Raw'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto scroll-thin px-6 py-4">
                {tab === 'diff' && (
                  <Diff oldText={parent?.body || ''} newText={selected.body} contextOnly />
                )}
                {tab === 'preview' && (
                  <Markdown knownPaths={allPaths} onWikiLinkClick={onNavigate}>
                    {selected.body}
                  </Markdown>
                )}
                {tab === 'raw' && (
                  <pre className="font-mono text-[12.5px] leading-[1.55] whitespace-pre-wrap bg-[#0a0f1e] text-ink border border-line rounded-md p-4">
                    {selected.body}
                  </pre>
                )}
              </div>

              {/* Phase 3.6: optional reviewer feedback for agent-authored
                  drafts. Surfaced only when this is an agent draft so human
                  reviews don't carry extra friction. */}
              {provenance?.is_agent_authored && (
                <div className="px-6 py-3 border-t border-white/[0.04] bg-accent/[0.04]">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">
                    Reviewer feedback (optional, agent drafts only)
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      className="form-input h-8 max-w-[260px]"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    >
                      <option value="">— Reject reason —</option>
                      <option value="wrong_page">Wrong page</option>
                      <option value="unsupported_claim">Unsupported claim</option>
                      <option value="bad_summary">Bad summary</option>
                      <option value="duplicate">Duplicate</option>
                      <option value="wrong_tags">Wrong tags</option>
                      <option value="too_broad">Too broad</option>
                      <option value="too_speculative">Too speculative</option>
                      <option value="permission_concern">Permission concern</option>
                      <option value="formatting_issue">Formatting issue</option>
                      <option value="other">Other</option>
                    </select>
                    <input
                      className="form-input flex-1 h-8 text-[12.5px]"
                      placeholder="Notes (consumed by future ingest prompts)"
                      value={rejectNotes}
                      onChange={(e) => setRejectNotes(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Decision bar */}
              <div className="px-6 py-3 border-t border-black/10 flex items-center gap-3">
                <input
                  className="form-input flex-1 h-9"
                  placeholder="Comment (optional, shown to the author)"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <button
                  className="btn"
                  onClick={() => review('reject')}
                  title="Reject this proposal"
                >
                  <X size={13} /> Reject
                </button>
                <button
                  className="btn"
                  onClick={() => review('request_changes')}
                  title="Send back to author"
                >
                  <RotateCcw size={13} /> Request changes
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => review('accept')}
                  title="Accept and publish"
                >
                  <Check size={13} /> Accept and publish
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
