'use client';
import { useEffect, useState } from 'react';
import VideoBackground from './VideoBackground';
import ThemeBackground from './ThemeBackground';
import { getTheme, DEFAULT_THEME_ID } from '@/lib/themes';

/**
 * Picks the background renderer based on <html data-theme-id>:
 *   - 'aurora' (default) → the original `VideoBackground` UNCHANGED, so its
 *     bespoke loops + swirl transition clips keep working exactly as before.
 *   - any other theme   → the registry-driven `ThemeBackground` cross-fader.
 * Tracks data-theme-id with a MutationObserver so switching themes in Settings
 * swaps the background live.
 */
export default function BackgroundLayer() {
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    const sync = () => setThemeId(el.getAttribute('data-theme-id') || DEFAULT_THEME_ID);
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme-id'] });
    return () => obs.disconnect();
  }, []);

  // Aurora is the bespoke video background (hardcoded /bg.mp4 + light/dark
  // invert). It is no longer the default, so route on the literal id rather
  // than DEFAULT_THEME_ID — every other theme (including the Slate default,
  // which is type:'css') falls through to the registry-driven renderer.
  if (themeId === 'aurora') return <VideoBackground />;
  return <ThemeBackground theme={getTheme(themeId)} />;
}
