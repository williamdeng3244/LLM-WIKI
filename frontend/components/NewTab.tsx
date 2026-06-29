'use client';
import { useLanguage } from '@/lib/i18n';

export default function NewTab({
  onCreateNote, onGoToFile, onClose, canCreate,
}: {
  onCreateNote: () => void;
  onGoToFile: () => void;
  onClose: () => void;
  canCreate: boolean;
}) {
  const { t } = useLanguage();
  const itemBase =
    'flex items-center gap-3 px-2 py-1 rounded transition-colors text-[0.9286rem] cursor-pointer';
  const link = 'text-accent hover:text-ink';
  const muted = 'text-muted/60 cursor-not-allowed';
  const kbd = 'text-[0.7143rem] bg-white/[0.06] border border-white/10 rounded px-1.5 py-0.5 font-mono text-muted';

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="text-[0.8571rem] uppercase tracking-[0.18em] text-muted mb-3">{t('newtab.heading')}</div>
        <div className="nt-actions flex flex-col items-end gap-2.5">
          <button
            onClick={canCreate ? onCreateNote : undefined}
            className={`${itemBase} ${canCreate ? link : muted}`}
            title={canCreate ? undefined : t('newtab.cantCreate')}
          >
            <span>{t('newtab.createNote')}</span>
            <span className={kbd}>Ctrl + E</span>
          </button>
          <button onClick={onGoToFile} className={`${itemBase} ${link}`}>
            <span>{t('newtab.goToFile')}</span>
            <span className={kbd}>Ctrl + O</span>
          </button>
          <button onClick={onClose} className={`${itemBase} ${link}`}>
            <span>{t('newtab.close')}</span>
            <span className={kbd}>Ctrl + W</span>
          </button>
        </div>
      </div>
    </div>
  );
}
