'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  HelpCircle, Search, BookOpen, Pencil, Inbox, Bell, Files, BookText,
  ShieldCheck, Plug, Sun, SquarePen, FolderPlus, History,
  ChevronsUpDown, ArrowDownAZ, MessageSquare, ExternalLink,
  PanelRightClose, FileText, Languages, Tag, Settings, Share2,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

type Item = {
  icon: ReactNode;
  titleKey: 'manual.search.title' | 'manual.switcher.title' | 'manual.chat.title'
    | 'manual.suggest.title' | 'manual.newNote.title' | 'manual.newFolder.title'
    | 'manual.history.title' | 'manual.review.title' | 'manual.graph.title'
    | 'manual.timelapse.title' | 'manual.sources.title' | 'manual.playbook.title'
    | 'manual.lint.title' | 'manual.mcp.title' | 'manual.theme.title'
    | 'manual.notif.title' | 'manual.tabs.title'
    | 'manual.chatCollapse.title' | 'manual.pageLayout.title'
    | 'manual.versionLog.title' | 'manual.langToggle.title'
    | 'manual.settings.title' | 'manual.artifacts.title';
  bodyKey: 'manual.search.body' | 'manual.switcher.body' | 'manual.chat.body'
    | 'manual.suggest.body' | 'manual.newNote.body' | 'manual.newFolder.body'
    | 'manual.history.body' | 'manual.review.body' | 'manual.graph.body'
    | 'manual.timelapse.body' | 'manual.sources.body' | 'manual.playbook.body'
    | 'manual.lint.body' | 'manual.mcp.body' | 'manual.theme.body'
    | 'manual.notif.body' | 'manual.tabs.body'
    | 'manual.chatCollapse.body' | 'manual.pageLayout.body'
    | 'manual.versionLog.body' | 'manual.langToggle.body'
    | 'manual.settings.body' | 'manual.artifacts.body';
  shortcut?: string;
};

type Section = {
  headingKey:
    | 'manual.section.reading' | 'manual.section.authoring'
    | 'manual.section.reviewing' | 'manual.section.graph'
    | 'manual.section.ingest' | 'manual.section.integration'
    | 'manual.section.chrome';
  items: Item[];
};

// Single source of truth. Strings live in lib/i18n.ts so EN/ZH stay in sync.
const SECTIONS: Section[] = [
  {
    headingKey: 'manual.section.reading',
    items: [
      { icon: <Search size={13} />, titleKey: 'manual.search.title', bodyKey: 'manual.search.body', shortcut: '⌘K' },
      { icon: <BookOpen size={13} />, titleKey: 'manual.switcher.title', bodyKey: 'manual.switcher.body', shortcut: '⌘O' },
      { icon: <FileText size={13} />, titleKey: 'manual.pageLayout.title', bodyKey: 'manual.pageLayout.body' },
      { icon: <MessageSquare size={13} />, titleKey: 'manual.chat.title', bodyKey: 'manual.chat.body' },
    ],
  },
  {
    headingKey: 'manual.section.authoring',
    items: [
      { icon: <Pencil size={13} />, titleKey: 'manual.suggest.title', bodyKey: 'manual.suggest.body', shortcut: '⌘E' },
      { icon: <SquarePen size={13} />, titleKey: 'manual.newNote.title', bodyKey: 'manual.newNote.body' },
      { icon: <FolderPlus size={13} />, titleKey: 'manual.newFolder.title', bodyKey: 'manual.newFolder.body' },
      { icon: <History size={13} />, titleKey: 'manual.history.title', bodyKey: 'manual.history.body' },
    ],
  },
  {
    headingKey: 'manual.section.reviewing',
    items: [
      { icon: <Inbox size={13} />, titleKey: 'manual.review.title', bodyKey: 'manual.review.body' },
    ],
  },
  {
    headingKey: 'manual.section.graph',
    items: [
      { icon: <BookOpen size={13} />, titleKey: 'manual.graph.title', bodyKey: 'manual.graph.body' },
      { icon: <ArrowDownAZ size={13} />, titleKey: 'manual.timelapse.title', bodyKey: 'manual.timelapse.body' },
    ],
  },
  {
    headingKey: 'manual.section.ingest',
    items: [
      { icon: <Files size={13} />, titleKey: 'manual.sources.title', bodyKey: 'manual.sources.body' },
      { icon: <BookText size={13} />, titleKey: 'manual.playbook.title', bodyKey: 'manual.playbook.body' },
      { icon: <ShieldCheck size={13} />, titleKey: 'manual.lint.title', bodyKey: 'manual.lint.body' },
    ],
  },
  {
    headingKey: 'manual.section.integration',
    items: [
      { icon: <Share2 size={13} />, titleKey: 'manual.artifacts.title', bodyKey: 'manual.artifacts.body' },
      { icon: <Plug size={13} />, titleKey: 'manual.mcp.title', bodyKey: 'manual.mcp.body' },
    ],
  },
  {
    headingKey: 'manual.section.chrome',
    items: [
      { icon: <Sun size={13} />, titleKey: 'manual.theme.title', bodyKey: 'manual.theme.body' },
      { icon: <Languages size={13} />, titleKey: 'manual.langToggle.title', bodyKey: 'manual.langToggle.body' },
      { icon: <Bell size={13} />, titleKey: 'manual.notif.title', bodyKey: 'manual.notif.body' },
      { icon: <ChevronsUpDown size={13} />, titleKey: 'manual.tabs.title', bodyKey: 'manual.tabs.body', shortcut: '⌘T · ⌘W' },
      { icon: <PanelRightClose size={13} />, titleKey: 'manual.chatCollapse.title', bodyKey: 'manual.chatCollapse.body' },
      { icon: <Tag size={13} />, titleKey: 'manual.versionLog.title', bodyKey: 'manual.versionLog.body' },
      { icon: <Settings size={13} />, titleKey: 'manual.settings.title', bodyKey: 'manual.settings.body' },
    ],
  },
];

export default function UserManual({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();
  // Outside-click + Esc to close, matching NotificationsPanel.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 w-[420px] max-h-[70vh] bg-panel border border-line rounded-md shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] z-30 flex flex-col"
    >
      <div className="px-3 py-2.5 border-b border-black/8 flex items-center justify-between">
        <span className="text-[0.8929rem] font-medium flex items-center gap-1.5">
          <HelpCircle size={13} /> {t('manual.header')}
        </span>
        <span className="text-[0.7143rem] text-muted">{t('manual.subtitle')}</span>
      </div>

      <div className="overflow-y-auto scroll-thin px-3 py-2">
        {/* Top CTA — opens the full docs site in a new tab. Placed first
            so the entry point is obvious; the icon legend below is for
            quick reference only. */}
        <a
          href="/help"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-accent/[0.10] hover:bg-accent/[0.16] border border-accent/30 transition-colors"
        >
          <span className="w-7 h-7 grid place-items-center rounded bg-accent/20 text-accent shrink-0">
            <BookOpen size={14} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[0.8929rem] font-medium text-ink">
              {t('manual.cta.title')}
            </span>
            <span className="block text-[0.7857rem] text-muted truncate">
              {t('manual.cta.subtitle')}
            </span>
          </span>
          <ExternalLink size={13} className="text-muted shrink-0" />
        </a>

        <div className="mt-2 px-1 text-[0.7857rem] text-muted">
          {t('manual.shortcuts.hint')}
        </div>

        {SECTIONS.map((sec) => (
          <section key={sec.headingKey} className="mt-3 first:mt-1">
            <h3 className="text-[0.7857rem] uppercase tracking-[0.08em] text-muted font-medium mb-1.5">
              {t(sec.headingKey)}
            </h3>
            <ul className="space-y-2">
              {sec.items.map((it) => (
                <li key={it.titleKey} className="flex gap-2.5">
                  <span className="mt-0.5 w-4 h-4 grid place-items-center text-accent shrink-0">
                    {it.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[0.8571rem] font-medium text-ink">
                        {t(it.titleKey)}
                      </span>
                      {it.shortcut && (
                        <kbd className="text-[0.6786rem] text-muted bg-black/5 border border-black/10 rounded px-1 py-0.5 font-mono">
                          {it.shortcut}
                        </kbd>
                      )}
                    </div>
                    <p className="text-[0.8214rem] text-muted leading-snug mt-0.5">
                      {t(it.bodyKey)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}

      </div>
    </div>
  );
}
