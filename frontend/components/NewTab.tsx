'use client';

export default function NewTab({
  onCreateNote, onGoToFile, onClose, canCreate,
}: {
  onCreateNote: () => void;
  onGoToFile: () => void;
  onClose: () => void;
  canCreate: boolean;
}) {
  const itemBase =
    'flex items-center gap-3 px-2 py-1 rounded transition-colors text-[13px] cursor-pointer';
  const link = 'text-accent hover:text-ink';
  const muted = 'text-muted/60 cursor-not-allowed';
  const kbd = 'text-[10px] bg-white/[0.06] border border-white/10 rounded px-1.5 py-0.5 font-mono text-muted';

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="text-[12px] uppercase tracking-[0.18em] text-muted mb-3">New tab</div>
        <div className="flex flex-col items-end gap-2.5">
          <button
            onClick={canCreate ? onCreateNote : undefined}
            className={`${itemBase} ${canCreate ? link : muted}`}
            title={canCreate ? undefined : 'Readers cannot create notes'}
          >
            <span>Create new note</span>
            <span className={kbd}>Ctrl + E</span>
          </button>
          <button onClick={onGoToFile} className={`${itemBase} ${link}`}>
            <span>Go to file</span>
            <span className={kbd}>Ctrl + O</span>
          </button>
          <button onClick={onClose} className={`${itemBase} ${link}`}>
            <span>Close</span>
            <span className={kbd}>Ctrl + W</span>
          </button>
        </div>
      </div>
    </div>
  );
}
