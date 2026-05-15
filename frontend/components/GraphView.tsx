'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Play, Square } from 'lucide-react';
import type { GraphData, PageSummary } from '@/lib/api';
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
  data, mode, onSelect, settings = DEFAULTS, treeHover = null, pages = [],
}: {
  data: GraphData; mode: '2d' | '3d';
  onSelect: (path: string) => void;
  settings?: GraphSettingsState;
  // Hover signal from the left-side file tree. When a folder is hovered,
  // every node whose path starts with that prefix lights up; when a file
  // is hovered, only that node + its graph neighbours light up. Other
  // nodes dim to the same "out of focus" alpha as the existing node-hover
  // focus mechanism.
  treeHover?: { kind: 'file' | 'folder'; path: string } | null;
  // Full page list, used by the timelapse animation to derive creation
  // order from numeric page.id (monotonic = chronological in practice).
  pages?: PageSummary[];
}) {
  // Obsidian-style timelapse: when active, nodes appear one-by-one in
  // creation order so you can watch the wiki "grow" up to its current
  // shape. 2D only.
  const [timelapseStep, setTimelapseStep] = useState<number | null>(null);
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
  //
  // Synthesized edges: the real `data.edges` only contains [[wikilinks]],
  // which can be sparse on a fresh wiki. We add two structural edge
  // categories so the graph reads as a network, not a swarm of dots:
  //   - 'folder': adjacent pages in the same immediate folder, chain-
  //     wired by path order (each folder forms a path/ring).
  //   - 'tag':    pairs of pages sharing ≥1 tag, capped per-page so the
  //     dense tags don't explode the edge count.
  // Wiki edges are drawn boldest; tag edges dimmer; folder edges dimmest.
  // All three feed the d3 link force, so structurally-related pages
  // naturally cluster.
  const graph = useMemo(() => {
    const nodes = data.nodes.map((n) => ({
      ...n,
      important: (n.backlinks || 0) >= importanceThreshold,
    }));

    type Link = {
      source: string; target: string;
      weight: number; kind: 'wiki' | 'folder' | 'tag';
    };
    const links: Link[] = [];
    const seen = new Set<string>();
    const key = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;

    // Real [[wikilinks]] first; they take priority.
    for (const e of data.edges) {
      const k = key(e.source, e.target);
      if (seen.has(k)) continue;
      seen.add(k);
      links.push({
        source: e.source, target: e.target,
        weight: Math.min(degree.get(e.source) || 1, degree.get(e.target) || 1),
        kind: 'wiki',
      });
    }

    // Folder-sibling chain: for each immediate folder, link adjacent
    // siblings (alphabetical). N pages → N-1 edges. No quadratic blow-up.
    const byFolder = new Map<string, string[]>();
    for (const n of nodes) {
      const i = n.id.lastIndexOf('/');
      if (i < 0) continue;
      const folder = n.id.slice(0, i);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder)!.push(n.id);
    }
    for (const paths of byFolder.values()) {
      if (paths.length < 2) continue;
      const sorted = [...paths].sort();
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i], b = sorted[i + 1];
        const k = key(a, b);
        if (seen.has(k)) continue;
        seen.add(k);
        links.push({ source: a, target: b, weight: 1, kind: 'folder' });
      }
    }

    // Tag overlap: for each tag with multiple pages, connect each page
    // to the next page in its tag's path-sorted list. This caps each
    // tag's contribution to O(N) edges instead of O(N²).
    const byTag = new Map<string, string[]>();
    for (const n of nodes) {
      for (const t of (n.tags || [])) {
        if (!byTag.has(t)) byTag.set(t, []);
        byTag.get(t)!.push(n.id);
      }
    }
    const MAX_TAG_EDGES_PER_PAGE = 3;
    const tagEdgesOnNode = new Map<string, number>();
    const inc = (id: string) => tagEdgesOnNode.set(id, (tagEdgesOnNode.get(id) || 0) + 1);
    const ok = (id: string) => (tagEdgesOnNode.get(id) || 0) < MAX_TAG_EDGES_PER_PAGE;
    for (const paths of byTag.values()) {
      if (paths.length < 2) continue;
      const sorted = [...paths].sort();
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i], b = sorted[i + 1];
        const k = key(a, b);
        if (seen.has(k)) continue;
        if (!ok(a) || !ok(b)) continue;
        seen.add(k);
        inc(a); inc(b);
        links.push({ source: a, target: b, weight: 1, kind: 'tag' });
      }
    }

    return { nodes, links };
  }, [data, degree, importanceThreshold]);

  // Adjacency rebuilt from the *combined* edge list so the hover-focus
  // mechanism (which dims non-neighbours) follows synthesised structural
  // edges too — not just real wiki-links.
  const fullAdjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of graph.links) {
      const src = typeof l.source === 'object' ? (l.source as { id: string }).id : (l.source as string);
      const tgt = typeof l.target === 'object' ? (l.target as { id: string }).id : (l.target as string);
      if (!m.has(src)) m.set(src, new Set());
      if (!m.has(tgt)) m.set(tgt, new Set());
      m.get(src)!.add(tgt);
      m.get(tgt)!.add(src);
    }
    return m;
  }, [graph.links]);

  // Set of page paths the tree is currently lighting up. For a folder
  // hover this is every page whose path starts with the prefix; for a
  // file hover it's the file + its full-adjacency neighbours.
  const treeHighlightedIds = useMemo<Set<string> | null>(() => {
    if (!treeHover) return null;
    const out = new Set<string>();
    if (treeHover.kind === 'folder') {
      const prefix = treeHover.path + '/';
      for (const n of data.nodes) {
        if (n.id === treeHover.path || n.id.startsWith(prefix)) out.add(n.id);
      }
    } else {
      out.add(treeHover.path);
      const neigh = fullAdjacency.get(treeHover.path);
      if (neigh) for (const id of neigh) out.add(id);
    }
    return out.size > 0 ? out : null;
  }, [treeHover, data.nodes, fullAdjacency]);

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

  // ── Timelapse: chronological reveal of nodes ───────────────────────────
  // Build a path → numeric-id map once. Page IDs are monotonic in this
  // app's schema (no UUIDs), so id-ascending order ≈ creation order.
  const idByPath = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pages) m.set(p.path, p.id);
    return m;
  }, [pages]);

  // Sort the graph's node IDs in creation order. Nodes without a known
  // page id (shouldn't happen normally) sort to the end.
  const chronoOrder = useMemo(() => {
    const ids = data.nodes.map((n) => n.id);
    ids.sort((a, b) => {
      const ia = idByPath.get(a) ?? Number.MAX_SAFE_INTEGER;
      const ib = idByPath.get(b) ?? Number.MAX_SAFE_INTEGER;
      return ia - ib;
    });
    return ids;
  }, [data.nodes, idByPath]);

  // While timelapse is active, only the first `timelapseStep` chronological
  // nodes are visible. Returns null when no filter is applied.
  const timelapseVisible = useMemo<Set<string> | null>(() => {
    if (timelapseStep == null) return null;
    return new Set(chronoOrder.slice(0, timelapseStep));
  }, [timelapseStep, chronoOrder]);

  // Filtered graph for the renderer when timelapse is running. Outside of
  // a timelapse this just returns the original graph reference, so the
  // simulation isn't reheated by switching modes.
  const renderGraph = useMemo(() => {
    if (!timelapseVisible) return graph;
    return {
      nodes: graph.nodes.filter((n) => timelapseVisible.has(n.id)),
      links: graph.links.filter((l) => {
        const src = typeof l.source === 'object'
          ? (l.source as { id: string }).id : (l.source as string);
        const tgt = typeof l.target === 'object'
          ? (l.target as { id: string }).id : (l.target as string);
        return timelapseVisible.has(src) && timelapseVisible.has(tgt);
      }),
    };
  }, [graph, timelapseVisible]);

  // Drive the reveal: step forward every TIMELAPSE_MS until everything's
  // visible, then auto-stop after a short hold so the user sees the final
  // shape before the controls reset.
  useEffect(() => {
    if (timelapseStep == null) return;
    if (timelapseStep >= chronoOrder.length) {
      const t = window.setTimeout(() => setTimelapseStep(null), 1500);
      return () => window.clearTimeout(t);
    }
    const TIMELAPSE_MS = 400;
    const t = window.setTimeout(() => {
      setTimelapseStep((prev) => (prev == null ? null : prev + 1));
    }, TIMELAPSE_MS);
    return () => window.clearTimeout(t);
  }, [timelapseStep, chronoOrder.length]);

  // ────────────────────────────────────────────────────────────────────────

  function isFocusedNode(id: string): boolean {
    // Tree hover takes priority — it's explicitly user-driven from
    // outside the graph, so it should dominate any stale node-hover state.
    if (treeHighlightedIds) return treeHighlightedIds.has(id);
    if (!hoverId) return true;
    if (id === hoverId) return true;
    return fullAdjacency.get(hoverId)?.has(id) || false;
  }
  function isFocusedLink(srcId: string, tgtId: string): boolean {
    if (treeHighlightedIds) {
      // Light up edges that connect two highlighted nodes (so a folder
      // hover reveals the internal network of that folder).
      return treeHighlightedIds.has(srcId) && treeHighlightedIds.has(tgtId);
    }
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

  // Translucent wash behind the graph so the background video shows
  // through softly but the graph reads cleanly. Themed at runtime: in
  // light mode <html data-theme="light"> swaps to a near-white wash.
  const isLight = typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-theme') === 'light';
  const GRAPH_BG = isLight ? 'rgba(255, 255, 255, 0.55)' : 'rgba(7, 10, 20, 0.55)';

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
      <div ref={containerRef} className="w-full h-full relative">
        {/* Play / Stop timelapse — 2D only. */}
        <button
          className="absolute top-3 right-14 z-10 w-8 h-8 grid place-items-center rounded-md border border-line bg-panel/85 text-muted hover:text-ink backdrop-blur transition-colors"
          onClick={() => setTimelapseStep(timelapseStep == null ? 1 : null)}
          title={timelapseStep == null
            ? 'Play timelapse — watch the wiki grow chronologically'
            : 'Stop timelapse'}
        >
          {timelapseStep == null ? <Play size={14} /> : <Square size={14} />}
        </button>
        {timelapseStep != null && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-panel/85 border border-line rounded-md px-3 py-1.5 text-[11.5px] text-muted backdrop-blur font-mono tabular-nums">
            {Math.min(timelapseStep, chronoOrder.length)} / {chronoOrder.length} pages
          </div>
        )}

        {/* @ts-expect-error dynamic import props */}
        <ForceGraph2D
          ref={fg2dRef}
          graphData={renderGraph}
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
            const kind: 'wiki' | 'folder' | 'tag' = l.kind || 'wiki';
            // Wiki-links lead; tags soften; folders barely there.
            const onAlpha  = kind === 'wiki' ? 0.65 : kind === 'tag' ? 0.36 : 0.22;
            const offAlpha = kind === 'wiki' ? 0.10 : kind === 'tag' ? 0.06 : 0.04;
            return hexToRgba(ACCENT, focused ? onAlpha : offAlpha);
          }}
          linkWidth={(l: any) => {
            const kind: 'wiki' | 'folder' | 'tag' = l.kind || 'wiki';
            const base = kind === 'wiki' ? 0.9 : kind === 'tag' ? 0.55 : 0.40;
            const scale = kind === 'wiki' ? 0.22 : 0.10;
            return (base + Math.min(l.weight || 1, 8) * scale) * settings.lineThickness;
          }}
          linkDirectionalParticles={(l: any) => l.kind === 'wiki' || !l.kind ? 2 : 0}
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
          const focused = isFocusedLink(src, tgt);
          const kind: 'wiki' | 'folder' | 'tag' = l.kind || 'wiki';
          const onAlpha  = kind === 'wiki' ? 0.85 : kind === 'tag' ? 0.45 : 0.28;
          const offAlpha = kind === 'wiki' ? 0.12 : kind === 'tag' ? 0.07 : 0.05;
          return hexToRgba(ACCENT, focused ? onAlpha : offAlpha);
        }}
        linkWidth={(l: any) => {
          const kind: 'wiki' | 'folder' | 'tag' = l.kind || 'wiki';
          const base = kind === 'wiki' ? 0.7 : kind === 'tag' ? 0.45 : 0.32;
          const scale = kind === 'wiki' ? 0.22 : 0.10;
          return (base + Math.min(l.weight || 1, 8) * scale) * settings.lineThickness;
        }}
        linkOpacity={0.85}
        linkDirectionalParticles={(l: any) => l.kind === 'wiki' || !l.kind ? 2 : 0}
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
