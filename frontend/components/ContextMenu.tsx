'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

  // Viewport clamping with a generous bottom safety margin.
  //
  // We don't trust `window.innerHeight` as the actual visible area: on
  // Windows the OS taskbar (or browser auto-hide UI) can overlap the
  // bottom strip of the viewport without changing `innerHeight`, so a
  // menu rendered "inside" the viewport per browser metrics still
  // ends up visually hidden behind the taskbar. Reserve ~80px (or
  // 12% of H, whichever is larger) at the bottom and ensure the menu
  // never crosses that line — when the click is near the bottom this
  // pushes the menu up into the middle of the screen, which is what
  // the user wants ("偏中间高度") so the lower-half items (Bookmark,
  // Move file to…, Delete) are always reachable.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const SAFE_BOTTOM = Math.max(80, Math.round(H * 0.12));
    const SAFE_TOP = 8;
    const usableH = H - SAFE_TOP - SAFE_BOTTOM;
    // Cap max-height to the usable area so we never need to render
    // pixels into the unsafe bottom strip.
    el.style.maxHeight = `${Math.max(120, usableH)}px`;

    // Measure after max-height applies.
    const rect = el.getBoundingClientRect();
    const menuW = rect.width;
    const menuH = rect.height;

    // Horizontal clamp: shift left if overflowing the right edge.
    if (x + menuW > W - 4) {
      el.style.left = `${Math.max(4, W - menuW - 4)}px`;
    }

    // Vertical anchor:
    //   - prefer to keep the menu's TOP at cursor y (default behaviour)
    //   - if its bottom would cross the safe line, shift it up so the
    //     bottom sits exactly at the safe line (menu floats into the
    //     middle of the screen rather than disappearing behind the
    //     taskbar)
    //   - if the menu is taller than the usable area, pin top at
    //     SAFE_TOP and let overflow-y:auto handle internal scroll.
    const safeBottomY = H - SAFE_BOTTOM;
    if (menuH >= usableH) {
      el.style.top = `${SAFE_TOP}px`;
    } else if (y > H / 2) {
      // Lower half: flip the menu ABOVE the cursor. Inside the dolphin
      // embed the iframe can be TALLER than the real screen, so the
      // "viewport bottom" we clamp against is a lie — but the cursor
      // position is always truly visible, and a menu extending upward
      // from it stays on-screen (删除按钮点不到, QA 2026-07-07).
      el.style.top = `${Math.max(SAFE_TOP, y - menuH)}px`;
    } else if (y + menuH > safeBottomY) {
      el.style.top = `${Math.max(SAFE_TOP, safeBottomY - menuH)}px`;
    }
  }, [x, y]);

  // Render into document.body so the menu escapes any local stacking
  // context (e.g. PageView's toolbar has backdrop-blur, the chat panel
  // sits in the same grid context, etc.) and consistently paints above
  // everything. SSR-safe: only mount the portal once we have a DOM.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const menu = (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[210px] overflow-y-auto scroll-thin bg-panel border border-line rounded-md shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.20)] py-1 text-[0.8929rem] backdrop-blur"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => {
        if (it.kind === 'divider') {
          return <div key={i} className="h-px my-0.5 bg-white/[0.06]" />;
        }
        return (
          <button
            key={i}
            disabled={it.disabled}
            title={it.disabled ? it.hint : undefined}
            className={`w-full text-left px-3 py-1 flex items-center gap-2.5 transition-colors ${
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

  return createPortal(menu, document.body);
}
