'use client';
/**
 * Markdown renderer with wiki-link navigation, citation markers, GFM, and
 * code highlighting.
 *
 * - Wiki-links: `[[path]]` and `[[path|label]]` are pre-processed into anchors
 *   with href `#wiki:path`. The renderer intercepts these and calls
 *   `onWikiLinkClick(path)` instead of navigating. Missing targets get the
 *   `.broken` class when `knownPaths` is provided.
 *
 * - Citations: `[1]`, `[2]` markers are pre-processed into anchors with href
 *   `#cite:N`, then rendered as inline `<sup>` elements. Only enabled when a
 *   `citations` map is provided.
 *
 * - Performance: memoized; handlers taken via ref so re-renders don't bust
 *   memoization.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Citation } from '@/lib/api';

const WIKI_RE = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
const CITE_RE = /\[(\d+)\]/g;

function preprocess(md: string, withCitations: boolean): string {
  let out = md;
  // Citation markers first (no overlap with wiki-link `[[`)
  if (withCitations) {
    out = out.replace(CITE_RE, (_m, n) => `[\\[${n}\\]](#cite:${n})`);
  }
  // Wiki-links
  out = out.replace(WIKI_RE, (_m, target, _hash, label) => {
    const t = (target as string).trim();
    const display = (label as string | undefined)?.trim() || t;
    return `[${display}](#wiki:${encodeURIComponent(t)})`;
  });
  return out;
}

export type MarkdownProps = {
  children: string;
  /**
   * Called when the user clicks a `[[wikilink]]`. The `path` is the
   * resolved page path (e.g. `people/aristotle.md`) when found in
   * `knownPaths`, or the raw wikilink target otherwise (broken link).
   * `inNewTab` is true on plain click (default behaviour: don't lose
   * the current page when following a citation) and false when the
   * user held Cmd/Ctrl to indicate they want to stay in flow.
   */
  onWikiLinkClick?: (path: string, inNewTab?: boolean) => void;
  knownPaths?: Set<string>;
  citations?: Map<number, Citation>;
  onCiteClick?: (citation: Citation) => void;
  className?: string;
};


// Resolve `[[Aristotle]]` → `people/aristotle.md`. Mirrors the
// backend's `normalize_link_target` in `services/linker.py` so links
// inside page bodies navigate even when the wikilink uses the bare
// human-readable name instead of the full path.
function resolveWikiTarget(raw: string, knownPaths?: Set<string>): string {
  if (!knownPaths || knownPaths.size === 0) return raw;
  const norm = raw.trim().toLowerCase();
  const rawNoMd = norm.endsWith('.md') ? norm.slice(0, -3) : norm;

  const strip = (p: string) => {
    const pl = p.toLowerCase();
    return pl.endsWith('.md') ? pl.slice(0, -3) : pl;
  };

  // Exact path match first.
  for (const p of knownPaths) {
    if (strip(p) === rawNoMd) return p;
  }
  // Fallback: slug match (`[[Al-Kindi]]` → `people/al-kindi.md`).
  const slug = rawNoMd.replace(/\s+/g, '-');
  for (const p of knownPaths) {
    const ps = strip(p);
    if (ps === slug || ps.endsWith('/' + slug)) return p;
  }
  return raw;
}

function MarkdownInner({
  children, onWikiLinkClick, knownPaths, citations, onCiteClick, className,
}: MarkdownProps) {
  const wikiHandlerRef = useRef(onWikiLinkClick);
  const citeHandlerRef = useRef(onCiteClick);
  const citesRef = useRef(citations);
  useEffect(() => { wikiHandlerRef.current = onWikiLinkClick; }, [onWikiLinkClick]);
  useEffect(() => { citeHandlerRef.current = onCiteClick; }, [onCiteClick]);
  useEffect(() => { citesRef.current = citations; }, [citations]);

  const withCitations = !!(citations && citations.size > 0);
  const processed = useMemo(
    () => preprocess(children || '', withCitations),
    [children, withCitations],
  );

  return (
    <div className={`prose-body ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a({ href, children, ...rest }) {
            const h = href || '';
            if (h.startsWith('#wiki:')) {
              const target = decodeURIComponent(h.slice(6));
              // Resolve via the same algorithm the backend uses so a
              // wikilink like `[[Aristotle]]` actually navigates to
              // `people/aristotle.md`. If unresolvable, `resolved`
              // falls back to the raw target and we mark broken.
              const resolved = resolveWikiTarget(target, knownPaths);
              const broken = !!(knownPaths && !knownPaths.has(resolved));
              return (
                <a
                  className={`wiki-link${broken ? ' broken' : ''}`}
                  href={h}
                  onClick={(e) => {
                    e.preventDefault();
                    // Default: open in a new tab so following a chain
                    // of wikilinks doesn't lose the page you started
                    // reading. Hold Cmd/Ctrl to navigate in place
                    // (power-user / "I know where I'm going" mode).
                    const inSameTab = e.metaKey || e.ctrlKey;
                    wikiHandlerRef.current?.(resolved, !inSameTab);
                  }}
                  onAuxClick={(e) => {
                    // Middle-click → new tab (browser convention).
                    if (e.button === 1) {
                      e.preventDefault();
                      wikiHandlerRef.current?.(resolved, true);
                    }
                  }}
                >
                  {children}
                </a>
              );
            }
            if (h.startsWith('#cite:')) {
              const n = parseInt(h.slice(6), 10);
              const c = citesRef.current?.get(n);
              return (
                <sup
                  className="text-accent cursor-pointer mx-[0.5px] font-medium text-[0.7143rem] no-underline"
                  title={c ? `${c.page_title} (lines ${c.line_start}–${c.line_end})` : `[${n}]`}
                  onClick={(e) => {
                    e.preventDefault();
                    if (c) citeHandlerRef.current?.(c);
                  }}
                >
                  [{n}]
                </sup>
              );
            }
            return (
              <a href={h} target="_blank" rel="noopener noreferrer" {...rest}>
                {children}
              </a>
            );
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}

const Markdown = memo(MarkdownInner, (a, b) =>
  a.children === b.children &&
  a.knownPaths === b.knownPaths &&
  a.citations === b.citations &&
  a.className === b.className,
);
Markdown.displayName = 'Markdown';
export default Markdown;
