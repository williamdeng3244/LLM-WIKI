'use client';
import { X, RotateCcw } from 'lucide-react';
import {
  type GraphSettingsState,
  DEFAULTS,
  DEFAULT_COLORS,
  CATEGORY_ORDER,
} from '@/lib/graphSettings';

type Props = {
  settings: GraphSettingsState;
  onChange: (s: GraphSettingsState) => void;
  onClose: () => void;
};

function Slider({
  label, value, min, max, step, onInput, fmt,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onInput: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span className="text-ink/85 font-mono tabular-nums text-[10.5px]">
          {fmt ? fmt(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onInput(parseFloat(e.target.value))}
        className="w-full mt-1 h-1 accent-accent cursor-pointer"
      />
    </div>
  );
}

export default function GraphSettings({ settings, onChange, onClose }: Props) {
  const set = <K extends keyof GraphSettingsState>(k: K, v: GraphSettingsState[K]) =>
    onChange({ ...settings, [k]: v });

  const setColor = (cat: string, color: string) =>
    onChange({ ...settings, colors: { ...settings.colors, [cat]: color } });

  const resetAll = () => onChange({ ...DEFAULTS, colors: { ...DEFAULT_COLORS } });

  return (
    <div className="absolute bottom-3 left-3 z-20 w-[280px] bg-panel/95 border border-line rounded-md shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)] backdrop-blur p-4 text-[12px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] uppercase tracking-[0.18em] text-muted">Graph Settings</h3>
        <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3">
        <Slider label="Node size" value={settings.nodeSize}
          min={0.5} max={2.0} step={0.05}
          onInput={(v) => set('nodeSize', v)} />
        <Slider label="Line thickness" value={settings.lineThickness}
          min={0.5} max={3.0} step={0.1}
          onInput={(v) => set('lineThickness', v)} />
        <Slider label="Glow" value={settings.glow}
          min={0} max={2.0} step={0.05}
          onInput={(v) => set('glow', v)} />
      </div>

      <div className="mt-4 pt-3 border-t border-white/[0.06]">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">Forces</div>
        <div className="space-y-3">
          <Slider label="Center force" value={settings.centerForce}
            min={0} max={0.3} step={0.005}
            onInput={(v) => set('centerForce', v)}
            fmt={(v) => v.toFixed(3)} />
          <Slider label="Repel force" value={settings.repelForce}
            min={-300} max={-10} step={5}
            onInput={(v) => set('repelForce', v)}
            fmt={(v) => v.toFixed(0)} />
          <Slider label="Link force" value={settings.linkForce}
            min={0} max={1} step={0.05}
            onInput={(v) => set('linkForce', v)} />
          <Slider label="Link distance" value={settings.linkDistance}
            min={20} max={200} step={5}
            onInput={(v) => set('linkDistance', v)}
            fmt={(v) => v.toFixed(0)} />
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-white/[0.06]">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">Colors</div>
        <div className="grid grid-cols-3 gap-2">
          {CATEGORY_ORDER.map((cat) => {
            const hex = settings.colors[cat] || '#9aa1b8';
            return (
              <label key={cat} className="flex items-center gap-1.5 cursor-pointer group">
                <span
                  className="relative w-5 h-5 rounded-full border border-white/15 shrink-0 shadow-[0_0_8px_-1px] overflow-hidden"
                  style={{ backgroundColor: hex, boxShadow: `0 0 10px -1px ${hex}` }}
                >
                  <input
                    type="color"
                    value={hex}
                    onChange={(e) => setColor(cat, e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </span>
                <span className="text-[10.5px] text-muted truncate group-hover:text-ink">
                  {cat}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer text-[11px]">
          <input
            type="checkbox"
            checked={settings.motionEnabled}
            onChange={(e) => set('motionEnabled', e.target.checked)}
            className="accent-accent cursor-pointer"
          />
          <span className="text-muted">Background motion</span>
        </label>
        <button
          className="text-muted hover:text-ink flex items-center gap-1 text-[10.5px]"
          onClick={resetAll}
          title="Reset all graph settings"
        >
          <RotateCcw size={11} /> Reset
        </button>
      </div>
    </div>
  );
}
