'use client';
import { useEffect, useRef } from 'react';
import { Keyboard, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

type Row = {
  keys: string;
  actionKey: Parameters<ReturnType<typeof useLanguage>['t']>[0];
  scopeKey: 'shortcuts.scope.global' | 'shortcuts.scope.tabs' | 'shortcuts.scope.dialog';
};

const ROWS: Row[] = [
  { keys: '⌘ K',     actionKey: 'shortcuts.action.search',    scopeKey: 'shortcuts.scope.global' },
  { keys: '⌘ O',     actionKey: 'shortcuts.action.switcher',  scopeKey: 'shortcuts.scope.global' },
  { keys: '⌘ E',     actionKey: 'shortcuts.action.suggest',   scopeKey: 'shortcuts.scope.global' },
  { keys: '⌘ ?',     actionKey: 'shortcuts.action.help',      scopeKey: 'shortcuts.scope.global' },
  { keys: '⌘ T',     actionKey: 'shortcuts.action.newTab',    scopeKey: 'shortcuts.scope.tabs'   },
  { keys: '⌘ W',     actionKey: 'shortcuts.action.closeTab',  scopeKey: 'shortcuts.scope.tabs'   },
  { keys: '⌘ ⇧ ]',   actionKey: 'shortcuts.action.nextTab',   scopeKey: 'shortcuts.scope.tabs'   },
  { keys: '⌘ ⇧ [',   actionKey: 'shortcuts.action.prevTab',   scopeKey: 'shortcuts.scope.tabs'   },
  { keys: 'Esc',     actionKey: 'shortcuts.action.escape',    scopeKey: 'shortcuts.scope.dialog' },
];

function Key({ k }: { k: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 text-[0.7857rem] font-mono text-ink bg-elev border border-line rounded">
      {k}
    </kbd>
  );
}

export default function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();

  // Esc to close + outside click. Centered modal pattern, distinct from
  // the dropdown panels which use ref-not-contains on the dropdown itself.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={ref}
        className="relative w-[min(560px,92vw)] max-h-[80vh] overflow-y-auto bg-panel border border-line rounded-lg shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.title')}
      >
        <div className="sticky top-0 bg-panel/95 backdrop-blur border-b border-line px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard size={14} className="text-accent" />
            <span className="font-display font-medium text-[1rem] text-ink">{t('shortcuts.title')}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 grid place-items-center rounded text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 pt-3 pb-1.5 text-[0.8214rem] text-muted">
          {t('shortcuts.subtitle')}
        </div>

        <div className="px-4 pb-4">
          <table className="w-full border-separate border-spacing-y-1">
            <thead>
              <tr className="text-left text-[0.7143rem] uppercase tracking-[0.08em] text-muted">
                <th className="font-medium pb-1 w-[30%]">{t('shortcuts.col.shortcut')}</th>
                <th className="font-medium pb-1">{t('shortcuts.col.action')}</th>
                <th className="font-medium pb-1 w-[22%]">{t('shortcuts.col.scope')}</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => (
                <tr key={i} className="text-[0.8929rem]">
                  <td className="py-1">
                    <span className="inline-flex items-center gap-1">
                      {r.keys.split(' ').map((k, j) => <Key key={j} k={k} />)}
                    </span>
                  </td>
                  <td className="py-1 text-ink/90">{t(r.actionKey)}</td>
                  <td className="py-1 text-muted">{t(r.scopeKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 pt-3 border-t border-white/[0.06] text-[0.7857rem] text-muted">
            {t('shortcuts.footer')}
          </div>
        </div>
      </div>
    </div>
  );
}
