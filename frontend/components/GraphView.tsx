'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { GraphData } from '@/lib/api';
import { type GraphSettingsState, DEFAULTS } from '@/lib/graphSettings';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });
const ForceGraph3D = dynamic(() => import('react-force-graph-3d'), { ssr: false });

const ACCENT = '#ff7a00';  // edges — saturated orange to match the node palette

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Stable hash from a string so each node's pulse phase is offset.
function phaseFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % 1000) / 1000) * Math.PI * 2;
}

// Cache one halo texture per category color — generated once and reused
// across every node sharing that color. Without the cache we'd allocate
// a 128×128 canvas per node per render.
const haloCache = new Map<string, THREE.Texture>();
function getHaloTexture(hex: string): THREE.Texture {
  const cached = haloCache.get(hex);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const cx = c.getContext('2d')!;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const grad = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0,    `rgba(${r}, ${g}, ${b}, 1)`);
  grad.addColorStop(0.18, `rgba(${r}, ${g}, ${b}, 0.85)`);
  grad.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, 0.35)`);
  grad.addColorStop(1,    `rgba(${r}, ${g}, ${b}, 0)`);
  cx.fillStyle = grad;
  cx.beginPath();
  cx.arc(64, 64, 64, 0, Math.PI * 2);
  cx.fill();
  const tex = new THREE.CanvasTexture(c);
  haloCache.set(hex, tex);
  return tex;
}

type NodeMeshes = {
  group: THREE.Group;
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  inner: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  halo: THREE.Sprite;
  category: string;
};

export default function GraphView({
  data, mode, onSelect, settings = DEFAULTS,
}: {
  data: GraphData; mode: '2d' | '3d';
  onSelect: (path: string) => void;
  settings?: GraphSettingsState;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const fg2dRef = useRef<any>(null);
  const fg3dRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // While the user drags inside the graph, emit a `plexus:transform`
  // event so the constellation background rotates and offsets in soft
  // parallax. Amount lowered (~40% of the prior value) to avoid the
  // dizziness reported earlier.
  useEffect(() => {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let accX = 0;
    let accY = 0;
    const MAX_ROT = 0.18;
    const MAX_OFF = 40;

    function onDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    }
    function onMove(e: PointerEvent) {
      if (!dragging) return;
      accX += e.clientX - lastX;
      accY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const rotation = Math.max(-MAX_ROT, Math.min(MAX_ROT, accX * 0.00035));
      const offsetX = Math.max(-MAX_OFF, Math.min(MAX_OFF, accX * 0.04));
      const offsetY = Math.max(-MAX_OFF, Math.min(MAX_OFF, accY * 0.04));
      window.dispatchEvent(new CustomEvent('plexus:transform', {
        detail: { rotation, offsetX, offsetY },
      }));
    }
    function onUp() {
      dragging = false;
      accX *= 0.7;
      accY *= 0.7;
    }

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  // Apply the d3 force tuning whenever any of the four force-related
  // settings change. Re-runs when `data` first arrives so the initial
  // sim is also reconfigured.
  useEffect(() => {
    const ref = mode === '2d' ? fg2dRef.current : fg3dRef.current;
    if (!ref || typeof ref.d3Force !== 'function') return;
    try {
      const charge = ref.d3Force('charge');
      if (charge && typeof charge.strength === 'function') {
        charge.strength(settings.repelForce);
      }
      const link = ref.d3Force('link');
      if (link) {
        if (typeof link.strength === 'function') link.strength(settings.linkForce);
        if (typeof link.distance === 'function') link.distance(settings.linkDistance);
      }
      const center = ref.d3Force('center');
      if (center && typeof center.strength === 'function') {
        center.strength(settings.centerForce);
      }
      ref.d3ReheatSimulation?.();
    } catch { /* lib not ready yet */ }
  }, [
    mode, data,
    settings.repelForce, settings.linkForce,
    settings.linkDistance, settings.centerForce,
  ]);

  // Adjacency for Obsidian-style hover focus.
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of data.edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [data.edges]);

  // Per-node degree (for edge thickness via min-endpoint-degree).
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of data.edges) {
      d.set(e.source, (d.get(e.source) || 0) + 1);
      d.set(e.target, (d.get(e.target) || 0) + 1);
    }
    return d;
  }, [data.edges]);

  // Top quartile by backlinks pulse; quiet nodes hold steady.
  const importanceThreshold = useMemo(() => {
    const counts = data.nodes.map((n) => n.backlinks || 0).sort((a, b) => b - a);
    if (counts.length === 0) return Infinity;
    const idx = Math.max(0, Math.floor(counts.length * 0.25) - 1);
    return Math.max(1, counts[idx]);
  }, [data.nodes]);

  // graphData identity is stable across visual setting changes — colors,
  // size, and glow are applied at render time (2D) or by mutating the
  // existing meshes (3D) so the d3 simulation never reheats just because
  // the user moved a slider. Only structural changes rebuild it.
  const graph = useMemo(() => ({
    nodes: data.nodes.map((n) => ({
      ...n,
      important: (n.backlinks || 0) >= importanceThreshold,
    })),
    links: data.edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: Math.min(degree.get(e.source) || 1, degree.get(e.target) || 1),
    })),
  }), [data, degree, importanceThreshold]);

  // Map of per-node Three.js objects, populated as `nodeThreeObject`
  // is called by force-graph. Mutated in place when visual settings
  // change so we never need to rebuild graphData.
  const meshesRef = useRef<Map<string, NodeMeshes>>(new Map());

  // When the structural data changes, drop stale mesh references —
  // force-graph creates fresh ones for the new node IDs.
  useEffect(() => {
    meshesRef.current.clear();
  }, [data]);

  // Apply visual settings to all existing 3D meshes whenever the user
  // moves a Display slider or recolors a category. No graphData reset,
  // no sim reheat, no wiggle.
  useEffect(() => {
    const glow = settings.glow;
    const sz = settings.nodeSize;
    for (const m of meshesRef.current.values()) {
      const color = settings.colors[m.category] || '#9aa1b8';
      m.group.scale.setScalar(sz);
      m.core.material.color.set(color);
      m.inner.material.opacity = Math.min(1, 0.55 * glow);
      m.halo.material.opacity = Math.min(1, 0.95 * glow);
      m.halo.material.map = getHaloTexture(color);
      m.halo.material.needsUpdate = true;
    }
  }, [settings.nodeSize, settings.glow, settings.colors]);

  function isFocusedNode(id: string): boolean {
    if (!hoverId) return true;
    if (id === hoverId) return true;
    return adjacency.get(hoverId)?.has(id) || false;
  }
  function isFocusedLink(srcId: string, tgtId: string): boolean {
    if (!hoverId) return true;
    return srcId === hoverId || tgtId === hoverId;
  }

  // Drive a continuous redraw on the 2D canvas so pulsing animates even
  // after the force simulation settles. force-graph-2d only redraws on
  // physics ticks otherwise, which would freeze the pulse.
  useEffect(() => {
    if (mode !== '2d') return;
    let raf = 0;
    const loop = () => {
      fg2dRef.current?.refresh();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  // Translucent dark wash so the rotating plexus shows through but the
  // graph reads cleanly against a calmer backdrop.
  const GRAPH_BG = 'rgba(7, 10, 20, 0.55)';

  // Releasing a dragged node should let it spring back into the simulation
  // — force-graph by default keeps `fx`/`fy` set after drag, which leaves
  // the node pinned and prevents the rest of the graph from re-settling
  // *with* it. Clearing the fixed coords + reheating gives the Obsidian
  // "tug the spring chain" feel.
  const releaseNode = (n: any, three = false) => {
    n.fx = undefined;
    n.fy = undefined;
    if (three) n.fz = undefined;
    const ref = three ? fg3dRef.current : fg2dRef.current;
    ref?.d3ReheatSimulation?.();
  };

  if (mode === '2d') {
    return (
      <div ref={containerRef} className="w-full h-full">
        {/* @ts-expect-error dynamic import props */}
        <ForceGraph2D
          ref={fg2dRef}
          graphData={graph}
          backgroundColor={GRAPH_BG}
          // No `nodeLabel` here — the canvas rendering below draws labels
          // itself (only for the focused node + neighbors, themed). The
          // lib's default would also pop up an HTML tooltip → double label.
          onNodeClick={(n: { id: string }) => onSelect(n.id)}
          onNodeHover={(n: { id: string } | null) => setHoverId(n?.id ?? null)}
          onNodeDragEnd={(n: any) => releaseNode(n, false)}
          nodeRelSize={5}
          nodeVal={(n: { backlinks?: number }) => 1 + (n.backlinks || 0) * 0.6}
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            // Force-graph can call this before the simulation has placed
            // freshly-mounted nodes; skip the frame if positions are not
            // finite yet, otherwise createRadialGradient throws.
            if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
            const color = settings.colors[node.category || ''] || '#9aa1b8';
            const focused = isFocusedNode(node.id);
            const baseAlpha = focused ? 1 : 0.18;
            const r = (3.4 + Math.sqrt((node.backlinks || 0) + 1) * 1.7) * settings.nodeSize;

            let pulseAmp = 0;
            if (node.important) {
              const t = performance.now() * 0.001;
              pulseAmp = (Math.sin(t * 1.5 + phaseFor(node.id)) + 1) * 0.5;
            }
            // Halo radius stays positive even when glow=0 so createRadialGradient
            // never gets a zero-radius outer circle.
            const haloR = Math.max(r * 1.05, r * (2.6 + pulseAmp * 1.0) * (0.4 + 0.6 * settings.glow));
            const haloPeak = (0.40 + pulseAmp * 0.45) * baseAlpha * settings.glow;

            // Outer halo (additive feel) — radial gradient.
            const grad = ctx.createRadialGradient(
              node.x, node.y, r * 0.4,
              node.x, node.y, haloR,
            );
            grad.addColorStop(0, hexToRgba(color, haloPeak));
            grad.addColorStop(1, hexToRgba(color, 0));
            const prevComp = ctx.globalCompositeOperation;
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(node.x, node.y, haloR, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = prevComp;

            // Saturated core.
            ctx.fillStyle = hexToRgba(color, baseAlpha);
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
            ctx.fill();

            // Bright inner highlight gives the orb depth.
            const innerGrad = ctx.createRadialGradient(
              node.x - r * 0.25, node.y - r * 0.25, 0,
              node.x, node.y, r,
            );
            innerGrad.addColorStop(0, `rgba(255, 255, 255, ${0.55 * baseAlpha})`);
            innerGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = innerGrad;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
            ctx.fill();

            // White rim for sharpness.
            ctx.lineWidth = 0.7 / globalScale;
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.55 * baseAlpha})`;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
            ctx.stroke();

            const showLabel =
              (hoverId && (hoverId === node.id || adjacency.get(hoverId)?.has(node.id))) ||
              globalScale > 1.7;
            if (showLabel) {
              ctx.font = `500 ${12 / globalScale}px "Inter Tight", system-ui, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillStyle = `rgba(238, 240, 247, ${baseAlpha})`;
              ctx.fillText(node.title, node.x, node.y + r + 4 / globalScale);
            }
          }}
          linkColor={(l: any) => {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            const focused = isFocusedLink(src, tgt);
            return hexToRgba(ACCENT, focused ? 0.62 : 0.10);
          }}
          linkWidth={(l: any) => (0.9 + Math.min(l.weight || 1, 8) * 0.22) * settings.lineThickness}
          linkDirectionalParticles={2}
          linkDirectionalParticleSpeed={0.005}
          linkDirectionalParticleWidth={(l: any) =>
            (1.8 + Math.min(l.weight || 1, 6) * 0.25) * settings.lineThickness}
          linkDirectionalParticleColor={(l: any) => {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            return isFocusedLink(src, tgt) ? '#ffd9a8' : 'rgba(0,0,0,0)';
          }}
          cooldownTicks={120}
        />
      </div>
    );
  }

  // 3D — replace the default flat sphere with a custom glowing-orb group
  // (core + white-hot inner + additive halo sprite). Edges remain library-
  // managed so the per-frame focus callbacks still apply.
  return (
    <div ref={containerRef} className="w-full h-full">
      {/* @ts-expect-error dynamic import props */}
      <ForceGraph3D
        ref={fg3dRef}
        graphData={graph}
        showNavInfo={false}
        backgroundColor={GRAPH_BG}
        nodeLabel={(n: { title: string }) => n.title}
        onNodeClick={(n: { id: string }) => onSelect(n.id)}
        onNodeHover={(n: { id: string } | null) => setHoverId(n?.id ?? null)}
        onNodeDragEnd={(n: any) => releaseNode(n, true)}
        nodeThreeObject={(n: any) => {
          const baseSize = 4 + Math.cbrt(1 + (n.backlinks || 0)) * 2.2;
          const cat = n.category || '';
          const color = settings.colors[cat] || '#9aa1b8';
          const group = new THREE.Group();

          const core = new THREE.Mesh(
            new THREE.SphereGeometry(baseSize * 0.65, 24, 24),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }),
          );
          group.add(core);

          const inner = new THREE.Mesh(
            new THREE.SphereGeometry(baseSize * 0.42, 16, 16),
            new THREE.MeshBasicMaterial({
              color: 0xffffff,
              transparent: true,
              opacity: Math.min(1, 0.55 * settings.glow),
            }),
          );
          group.add(inner);

          const halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: getHaloTexture(color),
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: Math.min(1, 0.95 * settings.glow),
          }));
          halo.scale.set(baseSize * 8, baseSize * 8, 1);
          group.add(halo);

          // The halo sprite is ~7× the core's diameter — leaving it
          // raycastable means hover triggers far from the visible orb.
          // Disable raycasting on every part of the node except the core.
          const noRaycast = () => {};
          (halo as unknown as { raycast: () => void }).raycast = noRaycast;
          (inner as unknown as { raycast: () => void }).raycast = noRaycast;

          // Apply current size via group scale — letting the slider mutate
          // group.scale later avoids rebuilding geometries.
          group.scale.setScalar(settings.nodeSize);

          meshesRef.current.set(n.id, {
            group,
            core: core as NodeMeshes['core'],
            inner: inner as NodeMeshes['inner'],
            halo,
            category: cat,
          });
          return group;
        }}
        nodeThreeObjectExtend={false}
        linkColor={(l: any) => {
          const src = typeof l.source === 'object' ? l.source.id : l.source;
          const tgt = typeof l.target === 'object' ? l.target.id : l.target;
          return hexToRgba(ACCENT, isFocusedLink(src, tgt) ? 0.85 : 0.12);
        }}
        linkWidth={(l: any) => (0.7 + Math.min(l.weight || 1, 8) * 0.22) * settings.lineThickness}
        linkOpacity={0.85}
        linkDirectionalParticles={2}
        linkDirectionalParticleSpeed={0.006}
        linkDirectionalParticleWidth={2.0 * settings.lineThickness}
        linkDirectionalParticleColor={(l: any) => {
          const src = typeof l.source === 'object' ? l.source.id : l.source;
          const tgt = typeof l.target === 'object' ? l.target.id : l.target;
          return isFocusedLink(src, tgt) ? '#ffe6c2' : 'rgba(0,0,0,0)';
        }}
      />
    </div>
  );
}
