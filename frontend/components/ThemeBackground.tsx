'use client';
import { useEffect, useState } from 'react';
import type { ThemeDef, ThemeBg } from '@/lib/themes';

type Mode = 'dark' | 'light';

/**
 * Registry-driven background for any theme OTHER than Aurora (which keeps its
 * bespoke `VideoBackground` with swirl transition clips). Stacks the theme's
 * dark + light backgrounds and cross-fades opacity when the mode flips. Each
 * background is a looping muted <video> or a CSS-cover <img> per the registry.
 * Mode is read from <html data-theme> and tracked with a MutationObserver so it
 * never desyncs from the CSS theme. The scrim element matches VideoBackground.
 */
export default function ThemeBackground({ theme }: { theme: ThemeDef }) {
  const [mode, setMode] = useState<Mode>('dark');

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    const sync = () => setMode((el.getAttribute('data-theme') as Mode) || 'dark');
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  function layer(bg: ThemeBg, visible: boolean, key: string) {
    const cls = `absolute inset-0 w-full h-full object-cover ${
      visible ? 'opacity-100' : 'opacity-0'
    }`;
    const style = { transition: 'opacity 450ms linear' as const };
    if (bg.type === 'video') {
      return (
        <video
          key={key}
          src={bg.src}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className={cls}
          style={style}
          onLoadedMetadata={(e) => {
            // rate < 1 slows the clip so the loop runs longer (persists across loops)
            if (bg.rate) e.currentTarget.playbackRate = bg.rate;
          }}
        />
      );
    }
    if (bg.type === 'image') {
      return (
        <div
          key={key}
          className={cls}
          style={{ ...style, backgroundImage: `url(${bg.src})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
      );
    }
    return null;  // 'css' backgrounds are handled by the early branch above
  }

  // Minimal CSS-painted themes (no video/image): one layer that the globals.css
  // [data-theme-id][data-theme] rules paint; CSS handles the light/dark swap +
  // transition. No scrim — the flat backdrop already reads cleanly behind chrome.
  if (theme.background.dark.type === 'css' || theme.background.light.type === 'css') {
    return (
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 theme-css-bg" style={{ transition: 'background-color 400ms ease' }} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      {layer(theme.background.dark, mode === 'dark', `${theme.id}-dark`)}
      {layer(theme.background.light, mode === 'light', `${theme.id}-light`)}
      {/* Scrim — CSS class so each theme can tint it via [data-theme-id]. */}
      <div className="absolute inset-0 theme-scrim" />
    </div>
  );
}
