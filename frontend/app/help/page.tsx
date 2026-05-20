'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ExternalLink, Search } from 'lucide-react';
import { useLanguage, type Lang } from '@/lib/i18n';
import {
  HELP_SECTIONS, blockText,
  type HelpSectionId, type HelpSection, type Block,
} from '@/lib/help';

// Section → i18n nav-label key. Keeps the sidebar order driven by
// HELP_SECTIONS but the *labels* swap with language.
const NAV_KEY: Record<HelpSectionId, Parameters<ReturnType<typeof useLanguage>['t']>[0]> = {
  welcome: 'help.nav.welcome',
  reading: 'help.nav.reading',
  authoring: 'help.nav.authoring',
  reviewing: 'help.nav.reviewing',
  graph: 'help.nav.graph',
  ingest: 'help.nav.ingest',
  lint: 'help.nav.lint',
  mcp: 'help.nav.mcp',
  shortcuts: 'help.nav.shortcuts',
  themes: 'help.nav.themes',
  faq: 'help.nav.faq',
};

function BlockView({ block, lang }: { block: Block; lang: Lang }) {
  if (block.kind === 'p') {
    return (
      <p className="text-[0.9286rem] leading-[1.65] text-ink/90 my-3">
        {blockText(block, lang) as string}
      </p>
    );
  }
  if (block.kind === 'h3') {
    return (
      <h3 className="font-display text-[1.0714rem] font-medium text-ink mt-6 mb-2 tracking-[-0.005em]">
        {blockText(block, lang) as string}
      </h3>
    );
  }
  // ul
  const items = blockText(block, lang) as string[];
  return (
    <ul className="list-disc pl-5 my-3 space-y-1.5 text-[0.9286rem] leading-[1.55] text-ink/90 marker:text-muted">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

function sectionMatchesQuery(s: HelpSection, q: string, lang: Lang, title: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  if (title.toLowerCase().includes(ql)) return true;
  return s.blocks.some((b) => {
    const v = blockText(b, lang);
    if (Array.isArray(v)) return v.some((x) => x.toLowerCase().includes(ql));
    return v.toLowerCase().includes(ql);
  });
}

export default function HelpPage() {
  const { lang, toggle: toggleLang, t } = useLanguage();
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<HelpSectionId>('welcome');

  // Read the initial section from the URL hash (e.g. /help#mcp).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const h = window.location.hash.replace('#', '');
    if (h && HELP_SECTIONS.some((s) => s.id === h)) {
      setActiveId(h as HelpSectionId);
    }
  }, []);

  // Sync URL hash + scroll-to-top whenever the active topic changes.
  // Obsidian-style: clicking a topic replaces the content area with that
  // topic's content (rather than scroll-anchoring all topics on one
  // long page), which is what users expect.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash !== `#${activeId}`) {
      window.history.replaceState(null, '', `#${activeId}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeId]);

  const filtered = useMemo(() => {
    if (!query) return HELP_SECTIONS;
    return HELP_SECTIONS.filter((s) =>
      sectionMatchesQuery(s, query, lang, t(NAV_KEY[s.id])),
    );
  }, [query, lang, t]);

  // Active section — useMemo so the rendered content always reflects
  // the latest activeId (replaces the previous IIFE pattern).
  const activeSection = useMemo<HelpSection>(
    () => HELP_SECTIONS.find((s) => s.id === activeId) ?? HELP_SECTIONS[0],
    [activeId],
  );

  return (
    // `relative z-10` lifts the help page above the VideoBackground that
    // RootLayout mounts on every route. Without it the video (z-0, fixed)
    // paints on top of the main content area — sidebar is fine because
    // it has its own sticky stacking context.
    <div className="relative z-10 min-h-screen bg-paper text-ink">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-panel/85 backdrop-blur">
        <div className="max-w-[1200px] mx-auto px-4 h-14 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-ink hover:text-accent transition-colors">
            <BookOpen size={18} className="text-accent" />
            <span className="font-display font-medium tracking-[0.02em] text-[1.0714rem]">
              {t('help.title')}
            </span>
          </Link>
          <span className="text-[0.8214rem] text-muted hidden md:inline">
            {t('help.brand.tagline')}
          </span>
          <div className="flex-1" />
          <div className="relative w-[260px] hidden sm:block">
            <input
              className="form-input h-8 pl-3 pr-9 text-[0.9286rem] w-full"
              placeholder={t('help.search.placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          </div>
          <button
            className="btn btn-icon font-mono text-[0.7857rem] tracking-tight px-1.5"
            onClick={toggleLang}
            title="Switch language · 切换语言"
            aria-label="Toggle language"
          >
            {lang === 'en' ? '中' : 'EN'}
          </button>
          <Link
            href="/"
            className="text-[0.8571rem] text-muted hover:text-ink transition-colors"
          >
            ← Wiki
          </Link>
        </div>
      </header>

      {/* Body */}
      <div className="max-w-[1200px] mx-auto px-4 py-8 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8">
        {/* Sidebar */}
        <aside className="md:sticky md:top-20 self-start">
          <h2 className="text-[0.7143rem] uppercase tracking-[0.10em] text-muted font-medium mb-3">
            {t('help.nav.heading')}
          </h2>
          <nav className="space-y-0.5">
            {filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                className={`block w-full text-left px-2.5 py-1.5 rounded text-[0.8929rem] transition-colors ${
                  activeId === s.id
                    ? 'bg-accent/[0.14] text-ink font-medium'
                    : 'text-muted hover:bg-white/[0.05] hover:text-ink'
                }`}
              >
                {t(NAV_KEY[s.id])}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2.5 py-1.5 text-[0.8214rem] text-muted">
                {t('help.search.noResults')}
              </div>
            )}
          </nav>
        </aside>

        {/* Content — only the active section is rendered. Obsidian-style:
            clicking a sidebar topic swaps the content rather than scrolling
            through a single long page. */}
        <main className="min-w-0">
          <section key={activeSection.id} className="mb-12">
            <h2 className="font-display text-[1.5714rem] font-medium text-ink tracking-[-0.01em] mb-1">
              {t(NAV_KEY[activeSection.id])}
            </h2>
            <div className="h-px bg-line mb-4" />
            {activeSection.blocks.map((b, i) => (
              <BlockView key={`${activeSection.id}-${i}`} block={b} lang={lang} />
            ))}
          </section>
          <footer className="mt-12 pt-6 border-t border-line flex items-center justify-between text-[0.8214rem] text-muted">
            <span>{t('help.footer.copyright')}</span>
            <a
              href="https://github.com/williamdeng3244/LLM-WIKI"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 hover:text-ink transition-colors"
            >
              <ExternalLink size={12} /> {t('help.footer.repo')}
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
