'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X, Github } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import {
  APP_VERSION, RELEASES_URL, compareVersions, type GhRelease,
} from '@/lib/version';

const CACHE_KEY = 'wiki:releases:v1';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

type CacheShape = { fetchedAt: number; releases: GhRelease[] };

function readCache(): CacheShape | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheShape;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(releases: GhRelease[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ fetchedAt: Date.now(), releases } as CacheShape),
    );
  } catch { /* quota */ }
}

function formatDate(iso: string, lang: 'en' | 'zh'): string {
  try {
    return new Date(iso).toLocaleDateString(
      lang === 'zh' ? 'zh-CN' : 'en-US',
      { year: 'numeric', month: 'short', day: 'numeric' },
    );
  } catch {
    return iso.slice(0, 10);
  }
}

export default function VersionLog() {
  const { lang, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [releases, setReleases] = useState<GhRelease[] | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load (or refresh) the release list on mount. Result is cached in
  // localStorage for an hour so we don't hammer GitHub on every reload.
  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setReleases(cached.releases);
      return;
    }
    let cancelled = false;
    (async () => {
      // Cap the request at 3s: on an internal/air-gapped network
      // api.github.com is unroutable and a plain fetch would hang until the OS
      // TCP timeout (tens of seconds), leaving the release check spinning.
      // Abort fast and fall back to "check failed" instead of blocking.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        const r = await fetch(RELEASES_URL, {
          headers: { 'Accept': 'application/vnd.github+json' },
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as GhRelease[];
        const usable = data.filter((x) => !x.draft);
        if (!cancelled) {
          setReleases(usable);
          writeCache(usable);
        }
      } catch {
        if (!cancelled) setFetchError(true);
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Find the latest non-prerelease tag; compare against the bundled
  // APP_VERSION to decide whether to show the "update available" badge.
  const latest = useMemo(() => {
    if (!releases || releases.length === 0) return null;
    return releases
      .filter((r) => !r.prerelease)
      .sort((a, b) => -compareVersions(a.tag_name, b.tag_name))[0]
      ?? releases[0];
  }, [releases]);

  const isOutdated = useMemo(() => {
    if (!latest) return false;
    return compareVersions(latest.tag_name, APP_VERSION) > 0;
  }, [latest]);

  // Outside-click + Esc to close the dropdown.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    // Outer wrapper so the dropdown positions relative to the badge. The
    // parent (page.tsx bottom bar) handles fixed positioning so the version
    // badge and the settings gear sit side by side.
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={`flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[0.7857rem] font-mono backdrop-blur transition-colors ${
          isOutdated
            ? 'bg-amber-500/[0.14] border-amber-500/40 text-amber-200 hover:bg-amber-500/[0.22]'
            : 'bg-panel/70 border-line text-muted hover:text-ink hover:bg-panel/85'
        }`}
        title={
          isOutdated && latest
            ? `${t('version.update.available')}: ${latest.tag_name}`
            : t('version.upToDate')
        }
      >
        <span>{APP_VERSION}</span>
        {/* Update available → just a compact sparkle dot (the amber
            highlight on the badge does the talking). No text label. */}
        {isOutdated && <Sparkles size={11} />}
      </button>

      {open && (
        <div className="absolute bottom-9 left-0 w-[260px] max-h-[60vh] bg-panel border border-line rounded-md shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-black/8 flex items-center justify-between">
            <span className="text-[0.8214rem] font-medium flex items-center gap-1.5 text-muted">
              <Github size={12} /> {t('version.panel.title')}
            </span>
            <button
              onClick={() => setOpen(false)}
              className="w-5 h-5 grid place-items-center rounded text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
              aria-label="Close"
            >
              <X size={11} />
            </button>
          </div>

          <div className="overflow-y-auto scroll-thin py-1 flex-1">
            {releases === null && !fetchError && (
              <div className="px-3 py-2 text-[0.8214rem] text-muted">{t('version.panel.loading')}</div>
            )}
            {fetchError && (
              <div className="px-3 py-2 text-[0.8214rem] text-muted">{t('version.panel.checkFailed')}</div>
            )}
            {releases && releases.length === 0 && (
              <div className="px-3 py-2 text-[0.8214rem] text-muted">{t('version.panel.empty')}</div>
            )}

            {releases && releases.length > 0 && (
              <ul>
                {releases.slice(0, 12).map((r) => {
                  const isCurrent = r.tag_name === APP_VERSION;
                  return (
                    <li key={r.tag_name}>
                      <a
                        href={r.html_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-baseline justify-between gap-2 px-3 py-1.5 hover:bg-white/[0.05] transition-colors"
                      >
                        <span className={`text-[0.8571rem] font-mono ${
                          isCurrent ? 'text-accent font-medium' : 'text-ink'
                        }`}>
                          {r.tag_name}
                          {isCurrent && (
                            <span className="ml-1.5 text-[0.6786rem] text-accent/80 font-sans uppercase tracking-[0.06em]">
                              · current
                            </span>
                          )}
                          {r.prerelease && (
                            <span className="ml-1.5 text-[0.6786rem] text-amber-300 font-sans uppercase tracking-[0.06em]">
                              · pre
                            </span>
                          )}
                        </span>
                        <span className="text-[0.7143rem] text-muted shrink-0">
                          {formatDate(r.published_at, lang)}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
