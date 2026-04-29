'use client';
/**
 * Line-level diff between two markdown bodies.
 *
 * Uses the `diff` package's `diffLines`. Renders unified diff with green
 * additions, red deletions, neutral context. For a "changes only" view,
 * collapses long unchanged sections to a single "…" hunk separator.
 */
import { memo, useMemo } from 'react';
import { diffLines, type Change } from 'diff';

const CONTEXT_LINES = 3;

type Hunk =
  | { kind: 'add' | 'del' | 'ctx'; line: string }
  | { kind: 'sep' };

function buildHunks(parts: Change[], contextOnly: boolean): Hunk[] {
  const out: Hunk[] = [];
  // First pass: tag every line with kind
  const tagged: Hunk[] = [];
  for (const part of parts) {
    const lines = part.value.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      if (part.added) tagged.push({ kind: 'add', line });
      else if (part.removed) tagged.push({ kind: 'del', line });
      else tagged.push({ kind: 'ctx', line });
    }
  }
  if (!contextOnly) return tagged;

  // Find spans of context lines that border changes; show only CONTEXT_LINES on each side
  const isChange = (h: Hunk) => h.kind === 'add' || h.kind === 'del';
  const keep = new Array<boolean>(tagged.length).fill(false);
  for (let i = 0; i < tagged.length; i++) {
    if (isChange(tagged[i])) {
      for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(tagged.length - 1, i + CONTEXT_LINES); j++) {
        keep[j] = true;
      }
    }
  }
  let lastKept = -2;
  for (let i = 0; i < tagged.length; i++) {
    if (keep[i]) {
      if (lastKept >= 0 && i > lastKept + 1) out.push({ kind: 'sep' });
      out.push(tagged[i]);
      lastKept = i;
    }
  }
  // If nothing changed, surface a small slice for context
  if (out.length === 0 && tagged.length > 0) {
    out.push(...tagged.slice(0, 5));
    if (tagged.length > 5) out.push({ kind: 'sep' });
  }
  return out;
}

function DiffInner({
  oldText, newText, contextOnly = true,
}: {
  oldText: string;
  newText: string;
  contextOnly?: boolean;
}) {
  const hunks = useMemo(
    () => buildHunks(diffLines(oldText, newText), contextOnly),
    [oldText, newText, contextOnly],
  );
  if (hunks.length === 0) {
    return <div className="text-xs text-muted italic px-3 py-3">No textual changes.</div>;
  }
  return (
    <pre className="font-mono text-[12.5px] leading-[1.55] bg-[#0a0f1e] text-ink border border-line rounded-md overflow-x-auto p-0 m-0">
      {hunks.map((h, i) =>
        h.kind === 'sep' ? (
          <div key={i} className="px-3 py-1 text-muted text-[11px] border-y border-black/5 bg-black/[0.02]">…</div>
        ) : (
          <div key={i} className={`diff-line diff-${h.kind}`}>{h.line || ' '}</div>
        ),
      )}
    </pre>
  );
}

const Diff = memo(DiffInner);
Diff.displayName = 'Diff';
export default Diff;
