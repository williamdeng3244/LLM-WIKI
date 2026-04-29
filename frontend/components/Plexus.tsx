'use client';
import { useEffect, useRef } from 'react';

// All distances/sizes are in CSS pixels — the canvas transform handles
// DPR scaling at draw time so the rest of the math reads naturally.
const PARTICLE_COUNT_MIN = 60;
const PARTICLE_COUNT_MAX = 160;
const PARTICLE_AREA_PER = 14000;
const LINK_RADIUS = 130;
const CURSOR_RADIUS = 180;
const PULL = 0.012;
const DAMPING = 0.985;
const JITTER = 0.005;
const MAX_SPEED = 0.35;
const INIT_SPEED_MIN = 0.05;
const INIT_SPEED_MAX = 0.15;
const PARTICLE_RADIUS = 1.2;
const HALO_RADIUS = 6;
const WARMUP_FRAMES = 120;

// Palette tuned to match the reference image: cyan-dominant connections,
// soft violet glow on cursor interaction, near-white particle cores.
const ACCENT = '122, 220, 255';   // cyan-blue plexus lines + halos
const GLOW = '255, 199, 116';     // warm amber for the cursor zone
const CORE = '230, 244, 255';     // cool white-blue cores

type Particle = { x: number; y: number; vx: number; vy: number };

function makeParticles(count: number, w: number, h: number): Particle[] {
  const ps: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = INIT_SPEED_MIN + Math.random() * (INIT_SPEED_MAX - INIT_SPEED_MIN);
    ps.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    });
  }
  return ps;
}

function step(
  particles: Particle[], w: number, h: number,
  cx: number | null, cy: number | null,
) {
  for (const p of particles) {
    if (cx !== null && cy !== null) {
      const dx = cx - p.x;
      const dy = cy - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < CURSOR_RADIUS * CURSOR_RADIUS && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const t = 1 - d / CURSOR_RADIUS;
        const s = t * t * PULL;
        p.vx += (dx / d) * s;
        p.vy += (dy / d) * s;
      }
    }
    p.vx *= DAMPING;
    p.vy *= DAMPING;
    p.vx += (Math.random() - 0.5) * JITTER;
    p.vy += (Math.random() - 0.5) * JITTER;
    const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (sp > MAX_SPEED) {
      p.vx = (p.vx / sp) * MAX_SPEED;
      p.vy = (p.vy / sp) * MAX_SPEED;
    }
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) { p.x = 0; p.vx = -p.vx; }
    else if (p.x > w) { p.x = w; p.vx = -p.vx; }
    if (p.y < 0) { p.y = 0; p.vy = -p.vy; }
    else if (p.y > h) { p.y = h; p.vy = -p.vy; }
  }
}

// Apply the scene transform (rotation around viewport center + offset) to a
// physics-space point and return its display-space position. Physics stays
// screen-aligned; the visual rotation is a render-time effect.
function project(
  px: number, py: number,
  cx: number, cy: number,
  rot: number, ox: number, oy: number,
): [number, number] {
  const rx = px - cx;
  const ry = py - cy;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  return [rx * cs - ry * sn + cx + ox, rx * sn + ry * cs + cy + oy];
}

function draw(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  cx: number | null, cy: number | null,
  w: number, h: number,
  scene: { rotation: number; offsetX: number; offsetY: number },
) {
  const cxv = w / 2;
  const cyv = h / 2;
  const rot = scene.rotation;
  const ox = scene.offsetX;
  const oy = scene.offsetY;

  // Precompute display positions once.
  const sx = new Float32Array(particles.length);
  const sy = new Float32Array(particles.length);
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const [x, y] = project(p.x, p.y, cxv, cyv, rot, ox, oy);
    sx[i] = x;
    sy[i] = y;
  }

  // Particle-particle lines (accent, ambient). Distance check uses physics
  // positions so connections don't form/break as the field rotates.
  ctx.lineWidth = 0.6;
  for (let i = 0; i < particles.length; i++) {
    const a = particles[i];
    for (let j = i + 1; j < particles.length; j++) {
      const b = particles[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < LINK_RADIUS * LINK_RADIUS) {
        const d = Math.sqrt(d2);
        const alpha = 0.18 * (1 - d / LINK_RADIUS);
        ctx.strokeStyle = `rgba(${ACCENT}, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(sx[i], sy[i]);
        ctx.lineTo(sx[j], sy[j]);
        ctx.stroke();
      }
    }
  }

  // Cursor-particle lines (violet glow — distinguishes interaction zone).
  // Cursor stays in screen space; we use display positions for the targets.
  if (cx !== null && cy !== null) {
    ctx.lineWidth = 0.7;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const dx = cx - p.x;
      const dy = cy - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < CURSOR_RADIUS * CURSOR_RADIUS) {
        const d = Math.sqrt(d2);
        const alpha = 0.30 * (1 - d / CURSOR_RADIUS);
        ctx.strokeStyle = `rgba(${GLOW}, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(sx[i], sy[i]);
        ctx.stroke();
      }
    }
  }

  // Halos use additive blending so overlaps brighten naturally.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < particles.length; i++) {
    const grad = ctx.createRadialGradient(sx[i], sy[i], 0, sx[i], sy[i], HALO_RADIUS);
    grad.addColorStop(0, `rgba(${ACCENT}, 0.42)`);
    grad.addColorStop(1, `rgba(${ACCENT}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx[i], sy[i], HALO_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Particle cores.
  ctx.fillStyle = `rgba(${CORE}, 0.85)`;
  for (let i = 0; i < particles.length; i++) {
    ctx.beginPath();
    ctx.arc(sx[i], sy[i], PARTICLE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default function Plexus() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let w = window.innerWidth;
    let h = window.innerHeight;
    let particles: Particle[] = [];
    let cursorX: number | null = null;
    let cursorY: number | null = null;
    let raf = 0;
    let paused = false;
    let motionEnabled = true;

    // Scene transform: external sources (e.g. the GraphView drag handler)
    // dispatch `plexus:transform` events. The scene state lerps toward the
    // target each frame; if no event arrives for a beat, target gently
    // decays toward neutral so the field springs back when the user lets go.
    const scene = { rotation: 0, offsetX: 0, offsetY: 0 };
    const target = { rotation: 0, offsetX: 0, offsetY: 0 };
    let lastTransformAt = 0;
    const SCENE_LERP = 0.08;
    const SCENE_DECAY = 0.99;
    const SCENE_DECAY_AFTER_MS = 250;

    function targetCount(): number {
      return Math.max(
        PARTICLE_COUNT_MIN,
        Math.min(PARTICLE_COUNT_MAX, Math.round((w * h) / PARTICLE_AREA_PER)),
      );
    }

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const target = targetCount();
      if (particles.length === 0) {
        particles = makeParticles(target, w, h);
      } else if (particles.length > target) {
        particles.length = target;
      } else if (particles.length < target) {
        particles.push(...makeParticles(target - particles.length, w, h));
      }
    }

    function clearAndScale() {
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function updateScene() {
      // Decay the target back to neutral if nothing's been driving it.
      if (performance.now() - lastTransformAt > SCENE_DECAY_AFTER_MS) {
        target.rotation *= SCENE_DECAY;
        target.offsetX *= SCENE_DECAY;
        target.offsetY *= SCENE_DECAY;
      }
      scene.rotation += (target.rotation - scene.rotation) * SCENE_LERP;
      scene.offsetX += (target.offsetX - scene.offsetX) * SCENE_LERP;
      scene.offsetY += (target.offsetY - scene.offsetY) * SCENE_LERP;
    }

    function frame() {
      if (paused) {
        raf = requestAnimationFrame(frame);
        return;
      }
      // When motion is disabled the field is rendered as a static frame:
      // particles stop drifting, cursor attractor is ignored, scene
      // transform stays at neutral.
      if (motionEnabled) {
        step(particles, w, h, cursorX, cursorY);
        updateScene();
      }
      clearAndScale();
      draw(ctx!, particles, motionEnabled ? cursorX : null, motionEnabled ? cursorY : null, w, h, scene);
      raf = requestAnimationFrame(frame);
    }

    function onMouseMove(e: MouseEvent) {
      cursorX = e.clientX;
      cursorY = e.clientY;
    }
    // When the pointer leaves the document, clear so particles don't pile
    // against the last known position at the viewport edge.
    function onDocOut(e: MouseEvent) {
      if (!e.relatedTarget) {
        cursorX = null;
        cursorY = null;
      }
    }
    function onVisibility() {
      paused = document.hidden;
    }
    function onTransform(e: Event) {
      if (!motionEnabled) return;
      const detail = (e as CustomEvent).detail || {};
      target.rotation = typeof detail.rotation === 'number' ? detail.rotation : target.rotation;
      target.offsetX = typeof detail.offsetX === 'number' ? detail.offsetX : target.offsetX;
      target.offsetY = typeof detail.offsetY === 'number' ? detail.offsetY : target.offsetY;
      lastTransformAt = performance.now();
    }
    function onMotion(e: Event) {
      const detail = (e as CustomEvent).detail || {};
      motionEnabled = !!detail.enabled;
      if (!motionEnabled) {
        // Snap scene back to neutral so the static frame is centered.
        target.rotation = 0;
        target.offsetX = 0;
        target.offsetY = 0;
        scene.rotation = 0;
        scene.offsetX = 0;
        scene.offsetY = 0;
      }
    }

    resize();

    if (reduced) {
      // Run a physics warmup so the static frame doesn't show clustered
      // start positions, then draw once and attach only resize.
      for (let i = 0; i < WARMUP_FRAMES; i++) step(particles, w, h, null, null);
      clearAndScale();
      draw(ctx, particles, null, null, w, h, scene);
      const onResize = () => {
        resize();
        for (let i = 0; i < WARMUP_FRAMES; i++) step(particles, w, h, null, null);
        clearAndScale();
        draw(ctx, particles, null, null, w, h, scene);
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseout', onDocOut);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('plexus:transform', onTransform as EventListener);
    window.addEventListener('plexus:motion', onMotion as EventListener);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseout', onDocOut);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('plexus:transform', onTransform as EventListener);
      window.removeEventListener('plexus:motion', onMotion as EventListener);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}
