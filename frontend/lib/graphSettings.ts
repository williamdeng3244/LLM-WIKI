'use client';
import { useEffect, useState } from 'react';

export type GraphSettingsState = {
  nodeSize: number;        // 0.5–2.0 (multiplier)
  lineThickness: number;   // 0.5–3.0 (multiplier)
  glow: number;            // 0.0–2.0 (multiplier)
  centerForce: number;     // 0–0.3
  repelForce: number;      // -300 to -10
  linkForce: number;       // 0–1
  linkDistance: number;    // 20–200
  colors: Record<string, string>;
  motionEnabled: boolean;
};

// Orange/red palette — distinct hues across the warm spectrum so all six
// categories remain readable against the video background.
export const DEFAULT_COLORS: Record<string, string> = {
  engineering: '#ff8c42',  // bright orange
  product:     '#e63946',  // crimson red
  design:      '#ff5e3a',  // vermillion
  operations:  '#ffaf3a',  // amber-orange
  research:    '#d62828',  // deep red
  sources:     '#ff9b71',  // coral peach
};

export const CATEGORY_ORDER = [
  'engineering', 'product', 'design', 'operations', 'research', 'sources',
];

export const DEFAULTS: GraphSettingsState = {
  nodeSize: 1.0,
  lineThickness: 1.0,
  glow: 1.0,
  centerForce: 0.05,
  repelForce: -60,
  linkForce: 0.7,
  linkDistance: 80,
  colors: { ...DEFAULT_COLORS },
  motionEnabled: true,
};

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
    return {
      ...DEFAULTS,
      ...parsed,
      colors: { ...DEFAULT_COLORS, ...(parsed.colors || {}) },
    };
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
