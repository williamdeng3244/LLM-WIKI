'use client';
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'wiki:theme';

/**
 * Theme hook. Persists to localStorage and updates `data-theme` on
 * <html> so CSS rules under `[data-theme="light"]` take effect. Emits a
 * `theme:change` custom event whenever the value flips — VideoBackground
 * listens to that event to play the appropriate transition clip.
 */
export function useTheme(): {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
} {
  const [theme, setThemeState] = useState<Theme>('dark');

  // Hydrate from localStorage on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(KEY) as Theme | null;
    const value: Theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
    setThemeState(value);
    document.documentElement.setAttribute('data-theme', value);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState((prev) => {
      if (prev === next) return prev;
      if (typeof window !== 'undefined') {
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem(KEY, next); } catch { /* quota */ }
        window.dispatchEvent(new CustomEvent('theme:change', {
          detail: { from: prev, to: next },
        }));
      }
      return next;
    });
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}
