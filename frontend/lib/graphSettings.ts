'use client';
import { useEffect, useState } from 'react';

export type GraphSettingsState = {
  nodeSize: number;        // 0.3–1.4 (multiplier — shifted smaller per user request)
  lineThickness: number;   // 0.1–2.0 (multiplier — effective ×0.5 in renderer for finer lines)
  glow: number;            // 0.0–2.0 (multiplier)
  centerForce: number;     // 0–0.3
  repelForce: number;      // -300 to -10
  linkForce: number;       // 0–1
  linkDistance: number;    // 20–200
  colors: Record<string, string>;
  // Link + particle customization. Particles are the small dots that
  // travel along wiki links to show direction.
  particleCount: number;       // 0–5 (integer)
  particleSpeed: number;       // 0.001–0.02
  particleColor: string;       // hex
  linkColor: string;           // hex, base color of every link
  linkStyle: 'solid' | 'dashed';
  /** Per-depth size decay: each path segment below the root scales
   *  the node's rendered radius by this factor. 1.0 = uniform size
   *  regardless of nesting; 0.92 (default) makes notes inside a
   *  deeper folder visibly smaller than the top-level ones. Applied
   *  AFTER `nodeSize` so it composes correctly. */
  depthScale: number;          // 0.7–1.0
  /** Per-folder overrides keyed by full folder path. When set, these
   *  win over the category-wide values and the global slider values
   *  for any node whose path starts with the key. The deepest matching
   *  path wins, so `meetings/hr` can have a different repel than
   *  `meetings`. */
  folderOverrides: Record<string, FolderOverride>;
};

export type FolderOverride = {
  color?: string;         // hex
  nodeSize?: number;      // multiplier, 0.3–1.4
  repelForce?: number;    // -300 to -10
};

// Default palette for the seed categories that ship with the app.
// User-created categories (e.g. `concepts`, `people` from a PHL vault)
// get a deterministic hash-derived color until the user picks one — see
// `categoryColor` below.
export const DEFAULT_COLORS: Record<string, string> = {
  engineering: '#ff8c42',  // bright orange
  product:     '#e63946',  // crimson red
  design:      '#ff5e3a',  // vermillion
  operations:  '#ffaf3a',  // amber-orange
  research:    '#d62828',  // deep red
  sources:     '#ff9b71',  // coral peach
};

// Preferred listing order in the GraphSettings color grid. Seeds first
// (in playbook order), then any user-created categories appended
// alphabetically by the consumer.
export const CATEGORY_ORDER = [
  'engineering', 'product', 'design', 'operations', 'research', 'sources',
];

// HSL → #rrggbb. `<input type="color">` only accepts hex, so even our
// hash-derived defaults need to be hex strings.
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const to2 = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/** Resolve the display color for a category. Lookup order:
 *  1. user override in `settings.colors[cat]`
 *  2. seed `DEFAULT_COLORS[cat]`
 *  3. stable hash-derived hue (so unknown categories still get a
 *     distinct color instead of falling through to gray). */
export function categoryColor(cat: string | null | undefined, overrides?: Record<string, string>): string {
  if (!cat) return '#9aa1b8';
  if (overrides && overrides[cat]) return overrides[cat];
  if (DEFAULT_COLORS[cat]) return DEFAULT_COLORS[cat];
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) | 0;
  return hslToHex(Math.abs(h) % 360, 70, 60);
}

/** Merge the seed category list with whatever the live graph contains,
 *  preserving the seeds' canonical order and appending unknown
 *  categories alphabetically. Used by `<GraphSettings>` so the color
 *  grid always shows a swatch for every category present in the data. */
export function visibleCategories(present: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const c of CATEGORY_ORDER) set.add(c);
  for (const c of present) if (c) set.add(c);
  const seedRank = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
  return Array.from(set).sort((a, b) => {
    const ar = seedRank.get(a), br = seedRank.get(b);
    if (ar != null && br != null) return ar - br;
    if (ar != null) return -1;
    if (br != null) return 1;
    return a.localeCompare(b);
  });
}

export const DEFAULTS: GraphSettingsState = {
  nodeSize: 1.0,
  lineThickness: 0.5,      // half of the old default — finer lines out of the box
  glow: 1.0,
  centerForce: 0.05,
  // Stronger repel by default so the natural equilibrium between
  // wiki-link pulls and inter-node push spreads the graph into a
  // readable layout instead of a tight cluster. Tunable via slider.
  repelForce: -150,
  linkForce: 0.7,
  linkDistance: 60,
  colors: { ...DEFAULT_COLORS },
  particleCount: 2,
  particleSpeed: 0.005,
  particleColor: '#ffd9a8',
  linkColor: '#ff7a00',
  linkStyle: 'solid',
  depthScale: 0.92,
  folderOverrides: {},
};

/** Walk a node's path from deepest to shallowest, returning the first
 *  matching folder-override value for `field`. Used by both the
 *  renderer (color, nodeSize) and the d3 physics tuner (repelForce). */
export function resolveFolderField<K extends keyof FolderOverride>(
  nodePath: string,
  field: K,
  overrides: Record<string, FolderOverride>,
): FolderOverride[K] | undefined {
  if (!nodePath || !overrides) return undefined;
  const parts = nodePath.split('/').filter(Boolean);
  // Try every prefix from deepest to shallowest.
  for (let i = parts.length; i > 0; i--) {
    const prefix = parts.slice(0, i).join('/');
    const v = overrides[prefix]?.[field];
    if (v !== undefined) return v;
  }
  return undefined;
}

// Bumped from `wiki:graph-settings` (cyan/amber palette) so the new
// orange/red defaults apply automatically without users having to hit
// Reset on the GraphSettings panel.
const KEY = 'wiki:graph-settings:v2';

function loadSettings(): GraphSettingsState {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    const merged: GraphSettingsState = {
      ...DEFAULTS,
      ...parsed,
      colors: { ...DEFAULT_COLORS, ...(parsed.colors || {}) },
      folderOverrides: parsed.folderOverrides && typeof parsed.folderOverrides === 'object'
        ? parsed.folderOverrides
        : {},
    };
    // Clamp into the current slider ranges so values saved under older
    // versions (when nodeSize went up to 2.0 etc.) don't peg the slider
    // at an unreachable position.
    const clamp = (v: number, lo: number, hi: number) =>
      Math.min(hi, Math.max(lo, v));
    merged.nodeSize = clamp(merged.nodeSize, 0.3, 1.4);
    merged.lineThickness = clamp(merged.lineThickness, 0.1, 2.0);
    merged.particleCount = clamp(Math.round(merged.particleCount), 0, 5);
    merged.particleSpeed = clamp(merged.particleSpeed, 0.001, 0.02);
    merged.depthScale = clamp(merged.depthScale, 0.7, 1.0);
    if (merged.linkStyle !== 'solid' && merged.linkStyle !== 'dashed') {
      merged.linkStyle = 'solid';
    }
    return merged;
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(s: GraphSettingsState) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota */ }
}

export function useGraphSettings(): [
  GraphSettingsState,
  (next: GraphSettingsState | ((prev: GraphSettingsState) => GraphSettingsState)) => void,
] {
  const [s, setS] = useState<GraphSettingsState>(DEFAULTS);
  useEffect(() => { setS(loadSettings()); }, []);
  const update = (
    next: GraphSettingsState | ((prev: GraphSettingsState) => GraphSettingsState),
  ) => {
    setS((prev) => {
      const value = typeof next === 'function'
        ? (next as (p: GraphSettingsState) => GraphSettingsState)(prev)
        : next;
      saveSettings(value);
      return value;
    });
  };
  return [s, update];
}
