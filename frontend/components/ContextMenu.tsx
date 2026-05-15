'use client';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Check } from 'lucide-react';

export type MenuItem =
  | {
      kind: 'item';
      label: string;
      icon?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
      danger?: boolean;
      hint?: string;
      checked?: boolean;
    }
  | { kind: 'divider' };

type Props = {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Latest onClose without retriggering the effect when a parent passes
  // an inline `() => setX(null)` and changes identity each render. Older
  // code did `useEffect(..., [onClose])` which tore down and re-attached
  // listeners every render, occasionally swallowing outside clicks.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    function isOutside(target: EventTarget | null): boolean {
      return !!ref.current && !ref.current.contains(target as Node);
    }
    function maybeClose(e: Event) {
      if (isOutside(e.target)) onCloseRef.current();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current();
    }
    // Capture phase + multiple event names: covers left-click, touch,
    // right-click reopen elsewhere, and any inner element that calls
    // stopPropagation on its own click handler.
    document.addEventListener('pointerdown', maybeClose, true);
    document.addEventListener('mousedown', maybeClose, true);
    document.addEventListener('contextmenu', maybeClose, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', maybeClose, true);
      document.removeEventListener('mousedown', maybeClose, true);
      document.removeEventListener('contextmenu', maybeClose, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Keep within the viewport once we know our size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (rect.right > W - 4) el.style.left = `${Math.max(4, W - rect.width - 4)}px`;
    if (rect.bottom > H - 4) el.style.top = `${Math.max(4, H - rect.height - 4)}px`;
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[210px] bg-panel border border-line rounded-md shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.20)] py-1 text-[12.5px] backdrop-blur"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => {
        if (it.kind === 'divider') {
          return <div key={i} className="h-px my-1 bg-white/[0.06]" />;
        }
        return (
          <button
            key={i}
            disabled={it.disabled}
            title={it.disabled ? it.hint : undefined}
            className={`w-full text-left px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
              it.disabled
                ? 'opacity-40 cursor-not-allowed text-muted'
                : it.danger
                  ? 'text-rose-300 hover:bg-rose-500/[0.10]'
                  : 'text-ink hover:bg-white/[0.06]'
            }`}
            onClick={() => {
              if (it.disabled) return;
              it.onClick?.();
              onClose();
            }}
          >
            {it.icon && (
              <span className="w-3.5 h-3.5 flex items-center justify-center text-muted shrink-0">
                {it.icon}
              </span>
            )}
            <span className="flex-1 truncate">{it.label}</span>
            {it.checked && (
              <Check
                size={12}
                className={`shrink-0 ml-2 ${it.disabled ? 'text-muted' : 'text-accent'}`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
