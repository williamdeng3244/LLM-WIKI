'use client';
import { X, RotateCcw } from 'lucide-react';
import {
  type GraphSettingsState,
  DEFAULTS,
  DEFAULT_COLORS,
  categoryColor,
  visibleCategories,
} from '@/lib/graphSettings';
import { useLanguage } from '@/lib/i18n';

type Props = {
  settings: GraphSettingsState;
  onChange: (s: GraphSettingsState) => void;
  onClose: () => void;
  /** Categories actually present in the graph data — passed by the
   *  parent so the color grid always shows a swatch for every
   *  category the user can see, including user-created ones like
   *  `concepts` or `people` that aren't in the seed CATEGORY_ORDER. */
  categories?: string[];
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
      <div className="flex items-baseline justify-between text-[0.7857rem]">
        <span className="text-muted">{label}</span>
        <span className="text-ink/85 font-mono tabular-nums text-[0.75rem]">
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

export default function GraphSettings({ settings, onChange, onClose, categories }: Props) {
  const { t } = useLanguage();
  const set = <K extends keyof GraphSettingsState>(k: K, v: GraphSettingsState[K]) =>
    onChange({ ...settings, [k]: v });

  const setColor = (cat: string, color: string) =>
    onChange({ ...settings, colors: { ...settings.colors, [cat]: color } });

  const resetAll = () => onChange({ ...DEFAULTS, colors: { ...DEFAULT_COLORS } });

  // Categories to show in the color grid: union of seeds + whatever the
  // graph data actually contains. Falls back to seeds-only when the
  // parent didn't pass a list.
  const catList = visibleCategories(categories || []);

  return (
    // Cap height + scrollable body so a tall panel doesn't get clipped at
    // the top of the graph area. The header + footer (Reset / motion
    // toggle) stay pinned; the slider sections scroll in between.
    <div className="absolute bottom-3 left-3 z-20 w-[280px] max-h-[calc(100vh-6rem)] bg-panel/95 border border-line rounded-md shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)] backdrop-blur text-[0.8571rem] flex flex-col">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between shrink-0 border-b border-white/[0.06]">
        <h3 className="text-[0.7143rem] uppercase tracking-[0.18em] text-muted">
          {t('graphSettings.title')}
        </h3>
        <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className="overflow-y-auto scroll-thin px-4 py-3 flex-1">
        <div className="text-[0.7143rem] uppercase tracking-[0.18em] text-muted mb-2">
          {t('graphSettings.section.display')}
        </div>
        <div className="space-y-3">
          <Slider label={t('graphSettings.nodeSize')} value={settings.nodeSize}
            min={0.3} max={1.4} step={0.05}
            onInput={(v) => set('nodeSize', v)} />
          <Slider label={t('graphSettings.lineThickness')} value={settings.lineThickness}
            min={0.1} max={2.0} step={0.05}
            onInput={(v) => set('lineThickness', v)} />
          <Slider label={t('graphSettings.glow')} value={settings.glow}
            min={0} max={2.0} step={0.05}
            onInput={(v) => set('glow', v)} />
        </div>

        <div className="mt-4 pt-3 border-t border-white/[0.06]">
          <div className="text-[0.7143rem] uppercase tracking-[0.18em] text-muted mb-2">
            {t('graphSettings.section.forces')}
          </div>
          <div className="space-y-3">
            <Slider label={t('graphSettings.centerForce')} value={settings.centerForce}
              min={0} max={0.3} step={0.005}
              onInput={(v) => set('centerForce', v)}
              fmt={(v) => v.toFixed(3)} />
            <Slider label={t('graphSettings.repelForce')} value={settings.repelForce}
              min={-300} max={-10} step={5}
              onInput={(v) => set('repelForce', v)}
              fmt={(v) => v.toFixed(0)} />
            <Slider label={t('graphSettings.linkForce')} value={settings.linkForce}
              min={0} max={1} step={0.05}
              onInput={(v) => set('linkForce', v)} />
            <Slider label={t('graphSettings.linkDistance')} value={settings.linkDistance}
              min={20} max={200} step={5}
              onInput={(v) => set('linkDistance', v)}
              fmt={(v) => v.toFixed(0)} />
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-white/[0.06]">
          <div className="text-[0.7143rem] uppercase tracking-[0.18em] text-muted mb-2">
            {t('graphSettings.section.links')}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.7857rem] text-muted">{t('graphSettings.linkColor')}</span>
              <label className="relative w-7 h-5 rounded border border-white/15 overflow-hidden cursor-pointer"
                     style={{ backgroundColor: settings.linkColor }}>
                <input type="color" value={settings.linkColor}
                  onChange={(e) => set('linkColor', e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.7857rem] text-muted">{t('graphSettings.linkStyle')}</span>
              <div className="flex border border-white/[0.10] rounded overflow-hidden">
                {(['solid', 'dashed'] as const).map((s) => (
                  <button key={s}
                    className={`px-2 py-0.5 text-[0.75rem] transition-colors ${
                      settings.linkStyle === s
                        ? 'bg-accent/20 text-ink'
                        : 'text-muted hover:text-ink'
                    }`}
                    onClick={() => set('linkStyle', s)}
                  >
                    {t(`graphSettings.linkStyle.${s}` as 'graphSettings.linkStyle.solid' | 'graphSettings.linkStyle.dashed')}
                  </button>
                ))}
              </div>
            </div>
            <Slider label={t('graphSettings.particleCount')} value={settings.particleCount}
              min={0} max={5} step={1}
              onInput={(v) => set('particleCount', Math.round(v))}
              fmt={(v) => v.toFixed(0)} />
            <Slider label={t('graphSettings.particleSpeed')} value={settings.particleSpeed}
              min={0.001} max={0.02} step={0.0005}
              onInput={(v) => set('particleSpeed', v)}
              fmt={(v) => v.toFixed(4)} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.7857rem] text-muted">{t('graphSettings.particleColor')}</span>
              <label className="relative w-7 h-5 rounded border border-white/15 overflow-hidden cursor-pointer"
                     style={{ backgroundColor: settings.particleColor }}>
                <input type="color" value={settings.particleColor}
                  onChange={(e) => set('particleColor', e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-white/[0.06]">
          <div className="text-[0.7143rem] uppercase tracking-[0.18em] text-muted mb-2">
            {t('graphSettings.section.colors')}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {catList.map((cat) => {
              const hex = categoryColor(cat, settings.colors);
              return (
                <label key={cat} title={cat} className="flex items-center gap-1.5 cursor-pointer group">
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
                  <span className="text-[0.75rem] text-muted truncate group-hover:text-ink">
                    {cat}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-4 pt-2.5 pb-3 border-t border-white/[0.06] flex items-center justify-end shrink-0">
        <button
          className="text-muted hover:text-ink flex items-center gap-1 text-[0.75rem]"
          onClick={resetAll}
          title={t('graphSettings.resetTitle')}
        >
          <RotateCcw size={11} /> {t('graphSettings.reset')}
        </button>
      </div>
    </div>
  );
}
