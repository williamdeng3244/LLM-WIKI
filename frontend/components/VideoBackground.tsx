'use client';
import { useEffect, useRef, useState } from 'react';

const SRC = '/bg.mp4';
// Lead time before the active clip ends to start fading the other one in.
const FADE_LEAD_S = 0.7;
// CSS opacity transition duration. Should be ≤ FADE_LEAD_S so the fade-in
// completes while the outgoing clip is still playing its tail.
const FADE_MS = 700;

// Two video elements alternate. Whichever is active is opaque; the other
// is paused at frame 0 until we approach the end of the active one, at
// which point we cross-fade. This gives a near-seamless loop even when
// the source clip's first and last frames don't perfectly match.
export default function VideoBackground() {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef<'a' | 'b'>('a');
  const [activeIsA, setActiveIsA] = useState(true);

  useEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;
    a.muted = true;
    b.muted = true;
    a.play().catch(() => { /* autoplay blocked → user gesture will resume */ });

    const onTime = (e: Event) => {
      const cur = e.target as HTMLVideoElement;
      const which: 'a' | 'b' = cur === a ? 'a' : 'b';
      if (activeRef.current !== which) return;
      const dur = cur.duration;
      if (!dur || !Number.isFinite(dur)) return;
      const remaining = dur - cur.currentTime;
      if (remaining < FADE_LEAD_S) {
        const other = cur === a ? b : a;
        other.currentTime = 0;
        other.play().catch(() => {});
        activeRef.current = which === 'a' ? 'b' : 'a';
        setActiveIsA(activeRef.current === 'a');
      }
    };

    a.addEventListener('timeupdate', onTime);
    b.addEventListener('timeupdate', onTime);

    return () => {
      a.removeEventListener('timeupdate', onTime);
      b.removeEventListener('timeupdate', onTime);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      <video
        ref={aRef}
        src={SRC}
        autoPlay
        muted
        playsInline
        preload="auto"
        className={`absolute inset-0 w-full h-full object-cover ${
          activeIsA ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transition: `opacity ${FADE_MS}ms linear` }}
      />
      <video
        ref={bRef}
        src={SRC}
        muted
        playsInline
        preload="auto"
        className={`absolute inset-0 w-full h-full object-cover ${
          activeIsA ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ transition: `opacity ${FADE_MS}ms linear` }}
      />
      {/* Dark scrim so chrome and prose stay legible over the video. */}
      <div className="absolute inset-0 bg-[rgba(7,10,20,0.40)]" />
    </div>
  );
}
