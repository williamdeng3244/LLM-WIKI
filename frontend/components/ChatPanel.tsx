'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Send, Trash2, Layers, BookOpen } from 'lucide-react';
import Markdown from './Markdown';
import { api, type Citation } from '@/lib/api';

type ChatMode = 'sources' | 'wiki';
type Msg = {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  mode?: ChatMode;
};

const STORAGE_KEY = 'wiki:chat-history';
const MODE_KEY = 'wiki:chat-mode';

const SUGGESTIONS = [
  'How does authentication work?',
  'What is on the roadmap?',
  'Summarize the permission model',
];

export default function ChatPanel({
  onCitationClick, knownPaths,
}: {
  onCitationClick: (path: string) => void;
  knownPaths: Set<string>;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ChatMode>('sources');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persist history per-tab and chat mode globally.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {}
    try {
      const m = localStorage.getItem(MODE_KEY) as ChatMode | null;
      if (m === 'sources' || m === 'wiki') setMode(m);
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(MODE_KEY, mode); } catch {}
  }, [mode]);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // Autoscroll on update
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  async function send() {
    const v = input.trim();
    if (!v || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: v }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const history = next.slice(0, -1).map(({ role, content }) => ({ role, content }));
      const res = await api.chat(v, history, mode);
      setMessages([
        ...next,
        { role: 'assistant', content: res.answer, citations: res.citations, mode },
      ]);
    } catch (e: unknown) {
      setMessages([...next, { role: 'assistant', content: `_Error: ${(e as Error).message}_` }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function clearChat() {
    setMessages([]);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 border-b border-black/8 flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted flex items-center gap-1.5 shrink-0">
          <Sparkles size={12} /> Assistant
        </div>
        <div className="flex items-center bg-white/[0.04] border border-white/[0.06] rounded-md p-0.5 text-[10.5px]">
          <button
            className={`px-2 h-6 rounded flex items-center gap-1 transition-colors ${
              mode === 'sources' ? 'bg-elev text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
            onClick={() => setMode('sources')}
            title="Sources mode — chunk-level RAG with line-range citations"
          >
            <Layers size={11} /> Sources
          </button>
          <button
            className={`px-2 h-6 rounded flex items-center gap-1 transition-colors ${
              mode === 'wiki' ? 'bg-elev text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
            onClick={() => setMode('wiki')}
            title="Wiki mode — synthesize from full pages, follow [[wikilinks]]"
          >
            <BookOpen size={11} /> Wiki
          </button>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-muted hover:text-ink shrink-0"
            title="Clear chat"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin px-4 py-3 space-y-5">
        {messages.length === 0 ? (
          <div className="text-muted leading-relaxed text-[12.5px]">
            Ask anything about the wiki. Answers cite only published content.
            <div className="mt-1 text-[11px] text-muted/85">
              {mode === 'wiki'
                ? 'Wiki mode: synthesizes across full pages and follows [[wikilinks]]. Best for "explain this concept" questions.'
                : 'Sources mode: chunk-level retrieval with line-range citations. Best for "where is X documented" questions.'}
            </div>
            <div className="mt-3 space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="block text-left text-accent hover:underline text-[12px]"
                  onClick={() => setInput(s)}
                >
                  {s} →
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => <ChatBubble key={i} msg={m} onCitationClick={onCitationClick} knownPaths={knownPaths} />)
        )}
        {busy && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted mb-1">
              assistant
            </div>
            <div className="flex items-center gap-1.5 text-muted text-[12.5px]">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" style={{ animationDelay: '120ms' }} />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" style={{ animationDelay: '240ms' }} />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-black/8 p-3 flex gap-2">
        <textarea
          ref={inputRef}
          rows={1}
          className="form-input form-textarea flex-1 h-9 py-2"
          placeholder="Ask the wiki…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={busy}
        />
        <button
          className="btn btn-primary"
          onClick={send}
          disabled={busy || !input.trim()}
          title="Send (Enter)"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

function ChatBubble({
  msg, onCitationClick, knownPaths,
}: {
  msg: Msg;
  onCitationClick: (path: string) => void;
  knownPaths: Set<string>;
}) {
  // Build a Map<n, Citation> once per message; pass to Markdown for inline citation rendering
  const cites = useMemo(() => {
    if (!msg.citations || msg.citations.length === 0) return undefined;
    const m = new Map<number, Citation>();
    for (const c of msg.citations) m.set(c.n, c);
    return m;
  }, [msg.citations]);

  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted mb-1">
        {msg.role}
      </div>
      <Markdown
        knownPaths={knownPaths}
        onWikiLinkClick={onCitationClick}
        citations={cites}
        onCiteClick={(c) => onCitationClick(c.page_path)}
      >
        {msg.content}
      </Markdown>
      {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
        <div className="mt-2 space-y-1">
          {msg.citations.map((c) => (
            <button
              key={c.n}
              className="text-[11px] block w-full text-left px-2 py-1.5 border border-black/8 rounded-md hover:bg-black/5"
              onClick={() => onCitationClick(c.page_path)}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium truncate">[{c.n}] {c.page_title}</span>
                {c.symbol && <span className="text-muted shrink-0 text-[10.5px]">{c.symbol}</span>}
              </div>
              <div className="text-muted text-[10.5px] mt-0.5">
                {c.page_path}
                {c.chunk_type === 'code' && ` · L${c.line_start}–${c.line_end}`}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
