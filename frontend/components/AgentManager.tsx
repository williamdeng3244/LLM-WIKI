'use client';
import { useEffect, useState } from 'react';
import { X, Bot, Copy, Check } from 'lucide-react';
import { api, type User } from '@/lib/api';

export default function AgentManager({ onClose }: { onClose: () => void }) {
  const [agents, setAgents] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setAgents(await api.listAgents());
  }
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function create() {
    if (!name.trim()) return;
    try {
      const result = await api.createAgent(name.trim());
      setNewToken(result.raw_token);
      setName('');
      await load();
    } catch (e: unknown) {
      alert((e as Error).message);
    }
  }

  async function copyToken() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-panel border border-line rounded-lg w-[640px] max-w-[94vw] max-h-[85vh] flex flex-col shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-black/10 flex items-center justify-between">
          <h3 className="font-medium text-[14px] flex items-center gap-2">
            <Bot size={15} /> My agents
          </h3>
          <button className="text-muted hover:text-ink" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto scroll-thin">
          <p className="text-[12.5px] text-muted leading-relaxed">
            Agents act on your behalf via API tokens. They have your permissions
            but can only contribute drafts — they cannot publish without a human reviewer.
            Use these tokens with Claude Code or any tool that supports bearer auth.
          </p>

          {newToken && (
            <div className="bg-emerald-500/[0.08] border border-emerald-500/30 rounded-md p-3.5">
              <div className="text-[12px] text-emerald-300 font-medium mb-2">
                Agent created. Copy this token now — it won't be shown again.
              </div>
              <div className="flex gap-2 items-stretch">
                <code className="flex-1 bg-[#0a0f1e] border border-emerald-500/30 rounded px-3 py-2 text-[11.5px] break-all font-mono text-emerald-200">
                  {newToken}
                </code>
                <button
                  className="btn shrink-0"
                  onClick={copyToken}
                >
                  {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                </button>
              </div>
              <button
                className="mt-2 text-[11px] text-emerald-300 underline"
                onClick={() => setNewToken(null)}
              >
                Hide
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <input
              className="form-input flex-1"
              placeholder="Agent name (e.g. 'research helper')"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            <button
              className="btn btn-primary"
              onClick={create}
              disabled={!name.trim()}
            >
              Create agent
            </button>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted mb-2">
              Existing agents ({agents.length})
            </div>
            {agents.length === 0 ? (
              <div className="text-[12px] text-muted italic">No agents yet.</div>
            ) : (
              <div className="border border-black/8 rounded-md overflow-hidden">
                {agents.map((a, i) => (
                  <div
                    key={a.id}
                    className={`px-4 py-3 text-[13px] flex items-center gap-3 ${
                      i > 0 ? 'border-t border-black/5' : ''
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
                      <Bot size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{a.name}</div>
                      <div className="text-[11px] text-muted truncate">
                        {a.email} · role: {a.role}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
