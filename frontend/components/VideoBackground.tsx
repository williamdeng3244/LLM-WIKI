'use client';
import { useEffect, useRef, useState } from 'react';

const DARK_LOOP = '/bg.mp4';
const LIGHT_LOOP = '/bg-light.mp4';
const LIGHT_TO_DARK = '/bg-light-to-dark.mp4';
const DARK_TO_LIGHT = '/bg-dark-to-light.mp4';

// The light loop is paced down slightly for a calmer feel than the dark
// version. Tweak to taste; values in (0,1] slow the clip, >1 speed it up.
const LIGHT_PLAYBACK_RATE = 0.8;
// Transitions run 3× to hide motion stutter introduced by upscaling.
const TRANSITION_PLAYBACK_RATE = 3;

type Theme = 'dark' | 'light';
type TransitionDir = 'to-dark' | 'to-light' | null;

/**
 * Animated background. Holds four <video> elements:
 *
 *  - The dark loop (`bg.mp4`) and the light loop (`bg-light.mp4`) play
 *    continuously, but only one is visible at a time (opacity 1 vs 0).
 *  - Two transition clips (`bg-light-to-dark.mp4`, `bg-dark-to-light.mp4`)
 *    sit paused at frame 0 above everything (z-100, including over the
 *    chrome) and are revealed + played once when the user flips themes.
 *    When the clip ends, it fades back to invisible and the new loop is
 *    already running underneath.
 *
 * Listens for the `theme:change` window event emitted by `lib/theme.ts`.
 */
export default function VideoBackground() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [transitionDir, setTransitionDir] = useState<TransitionDir>(null);

  const darkRef = useRef<HTMLVideoElement>(null);
  const lightRef = useRef<HTMLVideoElement>(null);
  const l2dRef = useRef<HTMLVideoElement>(null);
  const d2lRef = useRef<HTMLVideoElement>(null);

  // Hydrate initial theme from <html data-theme> (set by useTheme on mount).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const initial = (document.documentElement.getAttribute('data-theme') as Theme) || 'dark';
    setTheme(initial);
  }, []);

  // Apply per-clip playback rates: slow down the light loop, speed up
  // the transitions so they feel snappy rather than chuggy.
  useEffect(() => {
    if (lightRef.current) lightRef.current.playbackRate = LIGHT_PLAYBACK_RATE;
    if (l2dRef.current) l2dRef.current.playbackRate = TRANSITION_PLAYBACK_RATE;
    if (d2lRef.current) d2lRef.current.playbackRate = TRANSITION_PLAYBACK_RATE;
  }, []);

  // Kick both loops off muted; browsers require this for autoplay.
  useEffect(() => {
    [darkRef, lightRef].forEach((r) => {
      const v = r.current;
      if (!v) return;
      v.muted = true;
      v.play().catch(() => { /* autoplay blocked → resumes on first interaction */ });
    });
  }, []);

  // Listen for theme flips and trigger the matching transition clip.
  useEffect(() => {
    function onChange(e: Event) {
      const detail = (e as CustomEvent).detail || {};
      const next = detail.to as Theme;
      if (!next || next === theme) return;
      const dir: TransitionDir = next === 'dark' ? 'to-dark' : 'to-light';
      // Flip the theme + play the transition video together. The transition
      // video covers the chrome at z-100 so any UI repaint below is masked.
      setTheme(next);
      setTransitionDir(dir);
      const v = dir === 'to-dark' ? l2dRef.current : d2lRef.current;
      if (v) {
        v.currentTime = 0;
        v.playbackRate = TRANSITION_PLAYBACK_RATE;
        v.play().catch(() => {});
      }
    }
    window.addEventListener('theme:change', onChange as EventListener);
    return () => window.removeEventListener('theme:change', onChange as EventListener);
  }, [theme]);

  function onTransitionEnded() {
    setTransitionDir(null);
  }

  const darkLoopVisible = theme === 'dark';
  const lightLoopVisible = theme === 'light';
  const l2dVisible = transitionDir === 'to-dark';
  const d2lVisible = transitionDir === 'to-light';

  return (
    <>
      {/* Loops — behind the chrome. */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <video
          ref={darkRef}
          src={DARK_LOOP}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className={`absolute inset-0 w-full h-full object-cover ${
            darkLoopVisible ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transition: 'opacity 200ms linear' }}
        />
        <video
          ref={lightRef}
          src={LIGHT_LOOP}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className={`absolute inset-0 w-full h-full object-cover ${
            lightLoopVisible ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transition: 'opacity 200ms linear' }}
        />
        {/* Scrim — CSS class so the light theme can lighten it via [data-theme]. */}
        <div className="absolute inset-0 theme-scrim" />
      </div>

      {/* Transition clips — between the background loop and the chrome
          so the dashboard stays visible while the swirl plays behind it. */}
      <video
        ref={l2dRef}
        src={LIGHT_TO_DARK}
        muted
        playsInline
        preload="auto"
        onEnded={onTransitionEnded}
        className="fixed inset-0 w-full h-full object-cover pointer-events-none"
        style={{
          // Sit between the looping background (z-0) and the chrome
          // (z-10 via Home's wrapper) so the dashboard stays visible
          // and the transition plays through translucent panel surfaces.
          zIndex: 1,
          opacity: l2dVisible ? 1 : 0,
          visibility: l2dVisible ? 'visible' : 'hidden',
          transition: 'opacity 250ms linear',
        }}
      />
      <video
        ref={d2lRef}
        src={DARK_TO_LIGHT}
        muted
        playsInline
        preload="auto"
        onEnded={onTransitionEnded}
        className="fixed inset-0 w-full h-full object-cover pointer-events-none"
        style={{
          // Sit between the looping background (z-0) and the chrome
          // (z-10 via Home's wrapper) so the dashboard stays visible
          // and the transition plays through translucent panel surfaces.
          zIndex: 1,
          opacity: d2lVisible ? 1 : 0,
          visibility: d2lVisible ? 'visible' : 'hidden',
          transition: 'opacity 250ms linear',
        }}
      />
    </>
  );
}
