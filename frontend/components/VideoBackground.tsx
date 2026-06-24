'use client';
import { useEffect, useRef } from 'react';

// Aurora (the default theme) background. A single deep-space starfield clip
// (`bg.mp4`) plays continuously behind the chrome. Light vs dark is a pure-CSS
// concern: globals.css applies a luminance-inverting `filter` to
// `.aurora-bg-video` under `[data-theme="light"]`, so the light backdrop is the
// SAME motion as dark, just light-toned. There is no separate light loop and no
// swirl light↔dark transition clips to keep in sync — the swap is a calm CSS
// filter fade (see globals.css). BackgroundLayer routes the default theme here;
// every other theme uses ThemeBackground.
export default function VideoBackground() {
  const ref = useRef<HTMLVideoElement>(null);

  // Browsers require muted + an explicit play() for autoplay; if autoplay is
  // blocked it resumes on the first user interaction.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => { /* autoplay blocked → resumes on first interaction */ });
  }, []);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      <video
        ref={ref}
        src="/bg.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="aurora-bg-video absolute inset-0 w-full h-full object-cover"
      />
      {/* Scrim — CSS class so the light theme can lighten it via [data-theme]. */}
      <div className="absolute inset-0 theme-scrim" />
    </div>
  );
}
