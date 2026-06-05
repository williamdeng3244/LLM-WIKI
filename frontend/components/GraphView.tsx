'use client';
import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Play, Square } from 'lucide-react';
// Force-graph (the lib underlying both react-force-graph-2d AND -3d)
// uses d3-force-3d internally. Importing it directly lets us REPLACE
// the simulation's force instances cleanly rather than mutating the
// existing ones — the strength-mutation path turned out to be flaky
// across react-force-graph's internal re-renders.
// @ts-expect-error — d3-force-3d ships no types, but the public API
// matches @types/d3-force closely enough for our usage.
import { forceX, forceY } from 'd3-force-3d';
import type { GraphData, PageSummary } from '@/lib/api';
import { type GraphSettingsState, DEFAULTS, categoryColor, resolveFolderField } from '@/lib/graphSettings';
import { useLanguage } from '@/lib/i18n';

// Opt-in diagnostics: set NEXT_PUBLIC_GRAPH_DEBUG=1 to show the live physics
// overlay + verbose [graph] console logs. OFF by default so pulled users get a
// clean graph. The default docker-compose runs `next dev`, so this is gated on
// an explicit flag rather than NODE_ENV (which would still be "development").
const GRAPH_DEBUG = process.env.NEXT_PUBLIC_GRAPH_DEBUG === '1';
// eslint-disable-next-line no-console
const glog: (...args: unknown[]) => void = GRAPH_DEBUG ? console.log.bind(console) : () => {};

// next/dynamic + react-force-graph's forwardRef chain is broken in
// Next 14 — the callback ref never fires, which left every d3Force
// / d3ReheatSimulation call as a no-op. Bypass by lazy-loading the
// libs manually in a useEffect and stashing them in state. This is
// effectively what dynamic does, but keeps ref forwarding under
// our control.
type ForceGraphComp = React.ComponentType<Record<string, unknown> & { ref?: React.Ref<unknown> }>;
let _fg2dPromise: Promise<ForceGraphComp> | null = null;
let _fg3dPromise: Promise<ForceGraphComp> | null = null;
/** Error boundary so a render-time crash inside ForceGraph3D
 *  (THREE.js init, etc.) surfaces a readable error instead of a
 *  silent black screen. Mounted around the dynamically-loaded
 *  ForceGraph2D / ForceGraph3D components. */
class GraphErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error(`[graph ${this.props.label}] render crash:`, error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-md px-4 py-3 max-w-md">
            <div className="text-rose-300 text-[0.8929rem] font-medium mb-1">
              {this.props.label} crashed
            </div>
            <div className="text-muted text-[0.8214rem] font-mono">
              {this.state.error.message}
            </div>
            <button
              className="mt-3 text-[0.7857rem] text-muted hover:text-ink underline"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function loadFg2d(): Promise<ForceGraphComp> {
  if (!_fg2dPromise) {
    _fg2dPromise = import('react-force-graph-2d').then((m) => {
      const C = (m.default || m) as unknown as ForceGraphComp;
      // eslint-disable-next-line no-console
      glog('[graph] fg2d module loaded; type:', typeof C);
      return C;
    });
  }
  return _fg2dPromise;
}
function loadFg3d(): Promise<ForceGraphComp> {
  if (!_fg3dPromise) {
    _fg3dPromise = import('react-force-graph-3d').then((m) => {
      const C = (m.default || m) as unknown as ForceGraphComp;
      // eslint-disable-next-line no-console
      glog('[graph] fg3d module loaded; type:', typeof C);
      return C;
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[graph] fg3d failed to load:', err);
      throw err;
    });
  }
  return _fg3dPromise;
}

// Was a hardcoded module-level constant; now `settings.linkColor` is
// the source of truth and threads through to every link/particle call.

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
  /** Folders-deep for this node. Stored so the slider-driven mesh
   *  update can re-apply the depth scale without recomputing from
   *  the original path. */
  depth: number;
};

export default function GraphView({
  data, mode, onSelect, settings = DEFAULTS, treeHover = null, pages = [],
  customFolders = [],
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
  /** Empty-folder placeholders the user created in localStorage. We
   *  use them to materialize folder nodes that have no pages yet,
   *  so a freshly-created subfolder shows up in the graph
   *  immediately. */
  customFolders?: string[];
}) {
  // Obsidian-style timelapse: when active, nodes appear one-by-one in
  // creation order so you can watch the wiki "grow" up to its current
  // shape. 2D only.
  const [timelapseStep, setTimelapseStep] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Lazy-load the force-graph components into state. Once loaded,
  // we render them directly (no next/dynamic in between), so refs
  // forward cleanly.
  const [Fg2d, setFg2d] = useState<ForceGraphComp | null>(null);
  const [Fg3d, setFg3d] = useState<ForceGraphComp | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    loadFg2d().then((c) => setFg2d(() => c));
    loadFg3d().then((c) => setFg3d(() => c));
  }, []);

  // Ambient idle rotation for the 3D graph. Uses three.js OrbitControls'
  // built-in `autoRotate` (react-force-graph-3d exposes the controls via
  // `ref.controls()`). The renderer's per-frame `controls.update()` is
  // what actually advances the camera, so we just flip the flag based on
  // a "time since last interaction" probe — no extra rAF loop, no fight
  // with the library's animation cycle. Idle threshold ~1.5 s; speed is
  // tuned to ~3 minutes per full orbit so it reads as gentle background
  // motion, not as a turntable demo.
  useEffect(() => {
    if (mode !== '3d') return;
    if (typeof window === 'undefined') return;
    let raf = 0;
    let stopped = false;
    let lastInteraction = performance.now();
    let canvas: HTMLCanvasElement | null = null;
    let controls: { autoRotate?: boolean; autoRotateSpeed?: number } | null = null;
    const markInteraction = () => { lastInteraction = performance.now(); };
    const tryStart = () => {
      if (stopped) return;
      const ref = fg3dRef.current;
      const ctl = ref && typeof ref.controls === 'function' ? ref.controls() : null;
      const renderer = ref && typeof ref.renderer === 'function' ? ref.renderer() : null;
      const dom = renderer?.domElement as HTMLCanvasElement | undefined;
      // Bail out gracefully if the active control type doesn't expose
      // autoRotate (e.g. trackball/fly mode — we never set controlType
      // away from the default 'orbit', but be defensive anyway).
      if (!ctl || !dom || !('autoRotate' in ctl)) {
        raf = requestAnimationFrame(tryStart);
        return;
      }
      controls = ctl as { autoRotate?: boolean; autoRotateSpeed?: number };
      canvas = dom;
      canvas.addEventListener('pointerdown', markInteraction);
      canvas.addEventListener('wheel', markInteraction, { passive: true });
      canvas.addEventListener('touchstart', markInteraction, { passive: true });
      controls.autoRotateSpeed = 0.35;     // ~3 min per orbit
      const IDLE_MS = 1500;
      const loop = () => {
        if (stopped || !controls) return;
        raf = requestAnimationFrame(loop);
        controls.autoRotate = performance.now() - lastInteraction > IDLE_MS;
      };
      loop();
    };
    tryStart();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (canvas) {
        canvas.removeEventListener('pointerdown', markInteraction);
        canvas.removeEventListener('wheel', markInteraction);
        canvas.removeEventListener('touchstart', markInteraction);
      }
      if (controls) controls.autoRotate = false;
    };
  }, [mode, Fg3d]);

  // Callback refs into the directly-imported components.
  const fg2dRef = useRef<any>(null);
  const fg3dRef = useRef<any>(null);
  // Throttle reheat-on-slider-drag so 60+ slider events/sec don't
  // pile up energy and spin the graph violently.
  const lastReheatRef = useRef<number>(0);
  const [refReady, setRefReady] = useState(false);
  const set2dRef = useCallback((instance: any) => {
    fg2dRef.current = instance;
    setRefReady(!!instance);
    // eslint-disable-next-line no-console
    glog('[graph] fg2d ref →', instance ? 'BOUND' : 'null');
  }, []);
  const set3dRef = useCallback((instance: any) => {
    fg3dRef.current = instance;
    setRefReady(!!instance);
    // eslint-disable-next-line no-console
    glog('[graph] fg3d ref →', instance ? 'BOUND' : 'null');
  }, []);
  const { t } = useLanguage();
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
  // Diagnostic counter the visible overlay reads to confirm the
  // effect is firing on slider drags.
  const [effectTick, setEffectTick] = useState(0);
  // Apply the current physics settings to the live d3 simulation.
  // We expose this as a callable so external code (e.g. a slider
  // drag handler) can fire it on demand instead of relying solely
  // on React effects.
  const applyPhysics = (reheat: boolean) => {
    const ref = mode === '2d' ? fg2dRef.current : fg3dRef.current;
    // eslint-disable-next-line no-console
    glog('[graph applyPhysics]', {
      mode, hasRef: !!ref,
      repelForce: settings.repelForce,
      linkForce: settings.linkForce,
      linkDistance: settings.linkDistance,
      centerForce: settings.centerForce,
    });
    if (!ref || typeof ref.d3Force !== 'function') return;
    const charge = ref.d3Force('charge');
    if (charge && typeof charge.strength === 'function') {
      charge.strength((n: { id: string }) => {
        const ov = resolveFolderField(String(n.id), 'repelForce', settings.folderOverrides);
        return ov ?? settings.repelForce;
      });
      if (typeof charge.initialize === 'function') {
        charge.initialize(ref.graphData?.()?.nodes || []);
      }
    }
    const link = ref.d3Force('link');
    if (link && typeof link.strength === 'function') {
      // Per-link strength: real [[wikilinks]] use the full slider
      // value; synthesized structural edges (folder siblings, tag
      // overlap, parent-folder) pull softly so they HINT at clustering
      // without collapsing everything into a tight ball. Without this
      // every page would be link-pulled toward its folder siblings,
      // tag co-occurrents, AND parent folder all at full strength,
      // which dominates repel force and crushes the layout.
      try {
        link.strength((l: { kind?: string }) => {
          const kind = l?.kind || 'wiki';
          if (kind === 'wiki') return settings.linkForce;
          if (kind === 'parent') return settings.linkForce * 0.25;
          if (kind === 'tag') return settings.linkForce * 0.08;
          return settings.linkForce * 0.05;
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[graph] link.strength failed:', e);
        link.strength(settings.linkForce);   // safe scalar fallback
      }
      if (typeof link.distance === 'function') {
        try {
          link.distance((l: { kind?: string }) => {
            const kind = l?.kind || 'wiki';
            if (kind === 'wiki') return settings.linkDistance;
            if (kind === 'parent') return settings.linkDistance * 1.5;
            return settings.linkDistance * 2.5;
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[graph] link.distance failed:', e);
          link.distance(settings.linkDistance);
        }
      }
    }
    const center = ref.d3Force('center');
    if (center && typeof center.strength === 'function') {
      center.strength(settings.centerForce);
    }
    // Containment is purely a safety net for disconnected components
    // — kept very low so the user-controlled Center force slider is
    // the real knob. centerForce=0 → near-zero containment (max spread);
    // centerForce=0.3 (max) → ~0.06 containment (moderate pull).
    // This is what gives the graph room to breathe at low Center
    // values, like Obsidian. Floor at a tiny 0.002 so a 1-node
    // island doesn't drift to infinity.
    const containment = Math.max(0.002, settings.centerForce * 0.2);
    const existingX = ref.d3Force('x');
    if (existingX && typeof existingX.strength === 'function') {
      existingX.strength(containment);
    } else {
      ref.d3Force('x', forceX().strength(containment));
    }
    const existingY = ref.d3Force('y');
    if (existingY && typeof existingY.strength === 'function') {
      existingY.strength(containment);
    } else {
      ref.d3Force('y', forceY().strength(containment));
    }
    if (reheat && typeof ref.d3ReheatSimulation === 'function') {
      // Reheat applies new forces visibly, but we throttle so a
      // rapid slider drag (10–20 events/sec) doesn't pile up energy
      // and spin the graph wildly. Only one reheat per ~150 ms
      // window; the lib catches up with the latest forces on the
      // next tick anyway.
      //
      // CRITICAL: kapsule debounces three-forcegraph's `update()` by 1 ms
      // (kapsule.mjs ~line 118), so on the very first effect fire the
      // simulation's internal `state.layout` is still undefined.
      // `d3ReheatSimulation()` flips `state.engineRunning = true`
      // without checking that `state.layout` exists; the next rAF then
      // crashes with `Cannot read properties of undefined (reading 'tick')`
      // inside three-forcegraph's `layoutTick`. d3-force(-3d) sets
      // `node.index` on every node in `initializeNodes()`, which only
      // runs when the lib's `update()` has called `.nodes(...)` on the
      // sim — so `nodes[0].index` is a reliable "sim is initialized"
      // probe. Skip the reheat until then; the lib's own update() block
      // will start the sim via `resetCountdown` once `state.layout` is
      // assigned.
      const liveNodes = (typeof ref.graphData === 'function'
        ? ref.graphData()?.nodes : null) || [];
      const simReady = liveNodes.length > 0
        && typeof liveNodes[0].index === 'number';
      if (simReady) {
        const now = performance.now();
        const last = lastReheatRef.current;
        if (now - last > 150) {
          lastReheatRef.current = now;
          ref.d3ReheatSimulation();
        }
      } else {
        // eslint-disable-next-line no-console
        glog('[graph] reheat skipped — sim not initialized yet');
      }
    }
  };
  // Expose to window so a quick console test ("window._graphApply()")
  // can prove the application works even if React isn't re-running
  // the effect.
  if (GRAPH_DEBUG && typeof window !== 'undefined') {
    (window as unknown as { _graphApply: typeof applyPhysics })._graphApply = applyPhysics;
  }
  useEffect(() => {
    // ForceGraph2D/3D are dynamic-imported and bind their ref
    // asynchronously, so the first useEffect run hits a null ref and
    // returns without bumping the tick counter. Poll briefly until
    // the ref shows up, then apply the physics + start the counter.
    let cancelled = false;
    let pollCount = 0;
    const tryApply = () => {
      if (cancelled) return;
      const ref = mode === '2d' ? fg2dRef.current : fg3dRef.current;
      if (ref && typeof ref.d3Force === 'function') {
        setEffectTick((t) => t + 1);
        applyPhysics(true);
        return;
      }
      // Up to ~3s of polling — that's well past the lazy-import boundary.
      if (pollCount++ < 30) setTimeout(tryApply, 100);
    };
    tryApply();
    return () => { cancelled = true; };
    // applyPhysics depends on settings/mode; deps below cover that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode, data, refReady,
    settings.repelForce, settings.linkForce,
    settings.linkDistance, settings.centerForce,
    settings.folderOverrides,
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
    type GraphNode = {
      id: string;
      title?: string;
      category?: string | null;
      tags?: string[];
      backlinks?: number;
      important?: boolean;
      /** Synthesized folder nodes have isFolder=true; pages are
       *  undefined (treated as regular notes by the renderer). */
      isFolder?: boolean;
    };
    const nodes: GraphNode[] = data.nodes.map((n) => ({
      ...n,
      important: (n.backlinks || 0) >= importanceThreshold,
    }));

    // Synthesize folder nodes from page paths + user-created custom
    // folders. Each unique path prefix becomes a folder node, so the
    // user sees their tree structure mirrored in the graph and any
    // new subfolder shows up immediately without a backend round-trip.
    const folderSet = new Set<string>();
    const addFolderPrefixes = (path: string, includeFinal: boolean) => {
      const parts = path.split('/').filter(Boolean);
      const limit = includeFinal ? parts.length : parts.length - 1;
      for (let i = 1; i <= limit; i++) {
        folderSet.add(parts.slice(0, i).join('/'));
      }
    };
    for (const p of data.nodes) addFolderPrefixes(p.id, false);
    for (const f of customFolders) addFolderPrefixes(f, true);
    for (const folderPath of folderSet) {
      const segs = folderPath.split('/');
      nodes.push({
        id: folderPath,
        title: segs[segs.length - 1],
        category: segs[0],     // top-level segment doubles as category
        tags: [],
        backlinks: 0,
        important: false,
        isFolder: true,
      });
    }
    const folderIdSet = folderSet;

    type Link = {
      source: string; target: string;
      weight: number; kind: 'wiki' | 'folder' | 'tag' | 'parent';
    };
    const links: Link[] = [];
    const seen = new Set<string>();
    const key = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;

    // Parent edges: every page / folder connects to its immediate
    // parent folder. This is what gives the graph its "tree skeleton".
    const addParentEdge = (childPath: string) => {
      const i = childPath.lastIndexOf('/');
      if (i < 0) return;
      const parent = childPath.slice(0, i);
      if (!folderIdSet.has(parent)) return;
      const k = key(parent, childPath);
      if (seen.has(k)) return;
      seen.add(k);
      links.push({ source: parent, target: childPath, weight: 2, kind: 'parent' });
    };
    for (const n of data.nodes) addParentEdge(n.id);
    for (const f of folderSet) addParentEdge(f);

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

    // Dedupe nodes by id (a user-defined custom folder can collide
    // with a page path) and drop any link whose endpoint isn't present —
    // d3-force-3d's link force throws "node not found: <id>" otherwise,
    // killing the entire per-frame tick and leaving the 3D canvas black.
    // Page wins over folder on id collision.
    const nodeById = new Map<string, GraphNode>();
    for (const n of nodes) {
      const prev = nodeById.get(n.id);
      if (!prev || (prev.isFolder && !n.isFolder)) nodeById.set(n.id, n);
    }
    const finalNodes = Array.from(nodeById.values());
    const finalLinks = links.filter(
      (l) => nodeById.has(l.source) && nodeById.has(l.target),
    );
    // eslint-disable-next-line no-console
    if (finalLinks.length !== links.length) console.warn(
      `[graph] dropped ${links.length - finalLinks.length} dangling link(s)`,
    );
    return { nodes: finalNodes, links: finalLinks };
  }, [data, degree, importanceThreshold, customFolders]);

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
    const ds = settings.depthScale;
    for (const [nodeId, m] of meshesRef.current) {
      const overrideColor = resolveFolderField(nodeId, 'color', settings.folderOverrides);
      const overrideSize = resolveFolderField(nodeId, 'nodeSize', settings.folderOverrides);
      const color = overrideColor ?? categoryColor(m.category, settings.colors);
      const effectiveSize = overrideSize ?? sz;
      m.group.scale.setScalar(effectiveSize * Math.pow(ds, m.depth));
      m.core.material.color.set(color);
      m.inner.material.opacity = Math.min(1, 0.55 * glow);
      m.halo.material.opacity = Math.min(1, 0.95 * glow);
      m.halo.material.map = getHaloTexture(color);
      m.halo.material.needsUpdate = true;
    }
  }, [settings.nodeSize, settings.glow, settings.colors, settings.depthScale, settings.folderOverrides]);

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
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      const ref = fg2dRef.current;
      // Stale ref after HMR / mode-swap can be non-null but lack `.refresh`
      // (or have a torn-down canvas) — both would throw.
      if (ref && typeof ref.refresh === 'function') {
        try { ref.refresh(); } catch { /* canvas mid-teardown */ }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { stopped = true; cancelAnimationFrame(raf); };
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

  // Live debug overlay so users can see whether slider drags reach
  // the simulation without opening DevTools. Reads the same state
  // the force-tuning useEffect operates on.
  const debugOverlay = (
    <div className="absolute top-3 left-3 z-10 bg-panel/90 border border-line rounded-md px-3 py-2 text-[0.7143rem] font-mono tabular-nums text-muted backdrop-blur space-y-0.5 pointer-events-auto">
      <div className="text-accent text-[0.6875rem] uppercase tracking-[0.12em] mb-0.5">
        Physics — tick #{effectTick} {refReady ? '✓' : '⚠ no ref'}
      </div>
      <div>repel:    {settings.repelForce.toFixed(0)}</div>
      <div>link:     {settings.linkForce.toFixed(2)}</div>
      <div>linkDist: {settings.linkDistance.toFixed(0)}</div>
      <div>center:   {settings.centerForce.toFixed(3)}</div>
      <button
        className="mt-1 px-2 py-0.5 text-[0.7143rem] border border-white/10 rounded hover:bg-white/5 hover:text-ink transition-colors"
        onClick={() => {
          const ref = mode === '2d' ? fg2dRef.current : fg3dRef.current;
          ref?.d3ReheatSimulation?.();
        }}
        title="Reheat the simulation manually"
      >
        Reheat
      </button>
    </div>
  );

  if (mode === '2d') {
    return (
      <div ref={containerRef} className="w-full h-full relative">
        {GRAPH_DEBUG && debugOverlay}
        {/* Play / Stop timelapse — 2D only. */}
        <button
          className="absolute top-3 right-14 z-10 w-8 h-8 grid place-items-center rounded-md border border-line bg-panel/85 text-muted hover:text-ink backdrop-blur transition-colors"
          onClick={() => setTimelapseStep(timelapseStep == null ? 1 : null)}
          title={timelapseStep == null ? t('graph.timelapse.play') : t('graph.timelapse.stop')}
        >
          {timelapseStep == null ? <Play size={14} /> : <Square size={14} />}
        </button>
        {timelapseStep != null && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-panel/85 border border-line rounded-md px-3 py-1.5 text-[0.8214rem] text-muted backdrop-blur font-mono tabular-nums">
            {t('graph.timelapse.counter')
              .replace('{current}', String(Math.min(timelapseStep, chronoOrder.length)))
              .replace('{total}', String(chronoOrder.length))}
          </div>
        )}
        {!Fg2d && (
          <div className="absolute inset-0 flex items-center justify-center text-muted text-sm">
            Loading graph engine…
          </div>
        )}
        <GraphErrorBoundary label="ForceGraph2D">
        {Fg2d && <Fg2d
          ref={set2dRef}
          graphData={renderGraph}
          backgroundColor={GRAPH_BG}
          // Physics tuning. Defaults are alphaDecay=0.0228,
          // velocityDecay=0.4. We use slightly slower-than-default
          // alphaDecay so motion is visible when sliders change,
          // and slightly LIGHTER velocityDecay so dragged nodes
          // glide instead of slamming. The aggressive "snap back"
          // behavior came from a strong containment force, not
          // from these — containment is now ~0.025 (was 0.15+).
          d3AlphaDecay={0.018}
          d3VelocityDecay={0.35}
          // No `nodeLabel` here — the canvas rendering below draws labels
          // itself (only for the focused node + neighbors, themed). The
          // lib's default would also pop up an HTML tooltip → double label.
          // Node param is `any` (matches `onNodeDragEnd` + `nodeCanvasObject`)
          // because the lib's NodeAccessor type uses `{id?: string|number}`,
          // narrower types like `{id: string}` get rejected in strict mode.
          // Clicking a folder node is a no-op (it's not a page); pages
          // open as usual.
          onNodeClick={(n: any) => { if (!n.isFolder) onSelect(String(n.id)); }}
          onNodeHover={(n: any) => setHoverId(n ? String(n.id) : null)}
          onNodeDragEnd={(n: any) => releaseNode(n, false)}
          nodeRelSize={5}
          nodeVal={(n: any) => 1 + (n.backlinks || 0) * 0.6}
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            // Force-graph can call this before the simulation has placed
            // freshly-mounted nodes; skip the frame if positions are not
            // finite yet, otherwise createRadialGradient throws.
            if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
            // Folder override → category override → hash-derived.
            const overrideColor = resolveFolderField(node.id, 'color', settings.folderOverrides);
            const color = overrideColor ?? categoryColor(node.category, settings.colors);
            const overrideSize = resolveFolderField(node.id, 'nodeSize', settings.folderOverrides);
            const focused = isFocusedNode(node.id);
            const baseAlpha = focused ? 1 : 0.18;
            // Depth = how many folders deep this node sits. Subfolder
            // notes shrink by `depthScale ^ depth` so the eye reads
            // hierarchy at a glance. depthScale=1.0 disables the effect.
            const depth = Math.max(0, String(node.id).split('/').length - 1);
            const depthMul = Math.pow(settings.depthScale, depth);
            // Folder nodes render ~1.4× a page at the same depth so the
            // hierarchy is visually obvious (folder bigger than its notes).
            const kindMul = node.isFolder ? 1.4 : 1.0;
            const effectiveSize = overrideSize ?? settings.nodeSize;
            const r = (3.4 + Math.sqrt((node.backlinks || 0) + 1) * 1.7) * effectiveSize * depthMul * kindMul;

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
            // Hierarchy compressed: wiki still wins, but tag / folder /
            // parent edges stay visible instead of fading to invisible.
            const onAlpha  = kind === 'wiki' ? 0.65 : kind === 'tag' ? 0.48 : 0.38;
            const offAlpha = kind === 'wiki' ? 0.10 : kind === 'tag' ? 0.08 : 0.07;
            return hexToRgba(settings.linkColor, focused ? onAlpha : offAlpha);
          }}
          // Effective line-thickness multiplier is halved here so the
          // 0.1–2.0 slider range produces finer lines than the old
          // 0.5–3.0 range did — see graphSettings.ts comment.
          linkWidth={(l: any) => {
            const kind: 'wiki' | 'folder' | 'tag' = l.kind || 'wiki';
            // Bases lifted for non-wiki kinds so the visual gradient is
            // ~1.4× wiki:other instead of ~2.2×. Folder/parent edges no
            // longer disappear at default lineThickness.
            const base = kind === 'wiki' ? 0.9 : kind === 'tag' ? 0.75 : 0.65;
            const scale = kind === 'wiki' ? 0.22 : 0.15;
            return (base + Math.min(l.weight || 1, 8) * scale) * settings.lineThickness * 0.5;
          }}
          linkLineDash={() =>
            settings.linkStyle === 'dashed' ? [6, 4] : null
          }
          linkDirectionalParticles={(l: any) =>
            (l.kind === 'wiki' || !l.kind) ? settings.particleCount : 0}
          linkDirectionalParticleSpeed={settings.particleSpeed}
          linkDirectionalParticleWidth={(l: any) =>
            (1.8 + Math.min(l.weight || 1, 6) * 0.25) * settings.lineThickness * 0.5}
          linkDirectionalParticleColor={(l: any) => {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            return isFocusedLink(src, tgt) ? settings.particleColor : 'rgba(0,0,0,0)';
          }}
          // Run the sim perpetually instead of stopping at 120 ticks.
          // Obsidian-style: every force-slider tweak settles in
          // real-time without a freeze-then-thaw jump. d3-force is
          // cheap enough on wiki-scale graphs to keep ticking.
          cooldownTicks={Infinity}
          cooldownTime={Infinity}
        />}
        </GraphErrorBoundary>
      </div>
    );
  }

  // Pre-compute the 3D node-builder OUTSIDE the JSX. If a closure
  // capture throws, having it as a named function makes the stack
  // trace point at the real line, not somewhere inside react-force-
  // graph-3d's internals.
  const build3dNode = useCallback((n: { id: string; backlinks?: number; category?: string; isFolder?: boolean }) => {
    try {
      const depth = Math.max(0, String(n.id).split('/').length - 1);
      const depthMul = Math.pow(settings.depthScale, depth);
      const kindMul = n.isFolder ? 1.4 : 1.0;
      const overrideSize = resolveFolderField(n.id, 'nodeSize', settings.folderOverrides);
      const effectiveSize = overrideSize ?? settings.nodeSize;
      const baseSize = (4 + Math.cbrt(1 + (n.backlinks || 0)) * 2.2) * kindMul;
      const cat = n.category || '';
      const overrideColor = resolveFolderField(n.id, 'color', settings.folderOverrides);
      const color = overrideColor ?? categoryColor(cat, settings.colors);
      const group = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(baseSize * 0.65, 24, 24),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }),
      );
      group.add(core);
      const inner = new THREE.Mesh(
        new THREE.SphereGeometry(baseSize * 0.42, 16, 16),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true,
          opacity: Math.min(1, 0.55 * settings.glow),
        }),
      );
      group.add(inner);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getHaloTexture(color), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
        opacity: Math.min(1, 0.95 * settings.glow),
      }));
      halo.scale.set(baseSize * 8, baseSize * 8, 1);
      group.add(halo);
      const noRaycast = () => {};
      (halo as unknown as { raycast: () => void }).raycast = noRaycast;
      (inner as unknown as { raycast: () => void }).raycast = noRaycast;
      group.scale.setScalar(effectiveSize * depthMul);
      meshesRef.current.set(n.id, {
        group,
        core: core as NodeMeshes['core'],
        inner: inner as NodeMeshes['inner'],
        halo, category: cat, depth,
      });
      return group;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[graph build3dNode] failed for node', n.id, e);
      return new THREE.Group();    // empty group keeps render alive
    }
  }, [settings.depthScale, settings.nodeSize, settings.glow, settings.colors, settings.folderOverrides]);

  // 3D — replace the default flat sphere with a custom glowing-orb group
  // (core + white-hot inner + additive halo sprite). Edges remain library-
  // managed so the per-frame focus callbacks still apply.
  return (
    <div ref={containerRef} className="w-full h-full relative">
      {GRAPH_DEBUG && debugOverlay}
      {!Fg3d && (
        <div className="absolute inset-0 flex items-center justify-center text-muted text-sm">
          Loading 3D engine…
        </div>
      )}
      <GraphErrorBoundary label="ForceGraph3D">
      {Fg3d && <Fg3d
        ref={set3dRef}
        graphData={graph}
        showNavInfo={false}
        backgroundColor={GRAPH_BG}
        // Same Obsidian-style live physics as 2D — see the 2D comment.
        // See 2D comment — moderate settle + light velocity decay.
        d3AlphaDecay={0.018}
        d3VelocityDecay={0.35}
        nodeLabel={(n: any) => n.title}
        onNodeClick={(n: any) => { if (!n.isFolder) onSelect(String(n.id)); }}
        onNodeHover={(n: any) => setHoverId(n ? String(n.id) : null)}
        onNodeDragEnd={(n: any) => releaseNode(n, true)}
        nodeThreeObject={build3dNode}
        nodeThreeObjectExtend={false}
        linkColor={(l: any) => {
          const src = typeof l.source === 'object' ? l.source.id : l.source;
          const tgt = typeof l.target === 'object' ? l.target.id : l.target;
          const focused = isFocusedLink(src, tgt);
          const kind: 'wiki' | 'folder' | 'tag' = l.kind || 'wiki';
          // Hierarchy compressed: wiki still wins, but tag / folder /
          // parent edges stay visible instead of fading to invisible.
          const onAlpha  = kind === 'wiki' ? 0.85 : kind === 'tag' ? 0.62 : 0.50;
          const offAlpha = kind === 'wiki' ? 0.12 : kind === 'tag' ? 0.10 : 0.09;
          return hexToRgba(settings.linkColor, focused ? onAlpha : offAlpha);
        }}
        linkWidth={(l: any) => {
          const kind: 'wiki' | 'folder' | 'tag' = l.kind || 'wiki';
          // Bases lifted for non-wiki kinds so the visual gradient is
          // ~1.4× wiki:other instead of ~2.2×. Folder/parent edges no
          // longer disappear at default lineThickness.
          const base = kind === 'wiki' ? 0.7 : kind === 'tag' ? 0.58 : 0.50;
          const scale = kind === 'wiki' ? 0.22 : 0.15;
          return (base + Math.min(l.weight || 1, 8) * scale) * settings.lineThickness * 0.5;
        }}
        linkOpacity={0.85}
        linkDirectionalParticles={(l: any) =>
          (l.kind === 'wiki' || !l.kind) ? settings.particleCount : 0}
        linkDirectionalParticleSpeed={settings.particleSpeed}
        linkDirectionalParticleWidth={2.0 * settings.lineThickness * 0.5}
        linkDirectionalParticleColor={(l: any) => {
          const src = typeof l.source === 'object' ? l.source.id : l.source;
          const tgt = typeof l.target === 'object' ? l.target.id : l.target;
          return isFocusedLink(src, tgt) ? settings.particleColor : 'rgba(0,0,0,0)';
        }}
        // Perpetual sim — see 2D comment above.
        cooldownTicks={Infinity}
        cooldownTime={Infinity}
      />}
      </GraphErrorBoundary>
    </div>
  );
}
