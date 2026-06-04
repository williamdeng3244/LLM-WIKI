'use client';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_THEME_ID } from '@/lib/themes';

export type Theme = 'dark' | 'light';

const MODE_KEY = 'wiki:theme';
const THEME_KEY = 'wiki:theme-id';

/**
 * Theme hook. Manages two orthogonal axes on <html>:
 *   - `data-theme` = mode ('light' | 'dark')      → `theme` / `setTheme` / `toggle`
 *   - `data-theme-id` = which theme ('aurora', …) → `themeId` / `setThemeId`
 *
 * Both persist to localStorage and apply to <html>. A mode change emits the
 * original `theme:change` event with `{ from, to }` so VideoBackground keeps
 * working unchanged. `theme`/`setTheme`/`toggle` are kept (back-compat) so
 * existing mode-only consumers don't change. A theme-id change only updates
 * the attribute today (Aurora is the only theme + uses the same background);
 * theme-specific backgrounds get wired when a second theme is authored.
 */
export function useTheme(): {
  theme: Theme;
  themeId: string;
  setTheme: (next: Theme) => void;
  setThemeId: (next: string) => void;
  toggle: () => void;
} {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [themeId, setThemeIdState] = useState<string>(DEFAULT_THEME_ID);

  // Hydrate both axes from localStorage on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedMode = localStorage.getItem(MODE_KEY) as Theme | null;
    const mode: Theme = savedMode === 'light' || savedMode === 'dark' ? savedMode : 'dark';
    const savedId = localStorage.getItem(THEME_KEY) || DEFAULT_THEME_ID;
    setThemeState(mode);
    setThemeIdState(savedId);
    const el = document.documentElement;
    el.setAttribute('data-theme', mode);
    el.setAttribute('data-theme-id', savedId);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState((prev) => {
      if (prev === next) return prev;
      if (typeof window !== 'undefined') {
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem(MODE_KEY, next); } catch { /* quota */ }
        // Original event shape — VideoBackground reads { to } to swap clips.
        window.dispatchEvent(new CustomEvent('theme:change', {
          detail: { from: prev, to: next },
        }));
      }
      return next;
    });
  }, []);

  const setThemeId = useCallback((next: string) => {
    setThemeIdState((prev) => {
      if (prev === next) return prev;
      if (typeof window !== 'undefined') {
        document.documentElement.setAttribute('data-theme-id', next);
        try { localStorage.setItem(THEME_KEY, next); } catch { /* quota */ }
      }
      return next;
    });
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return { theme, themeId, setTheme, setThemeId, toggle };
}
