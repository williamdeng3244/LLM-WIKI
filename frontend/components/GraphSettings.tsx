'use client';
import { useMemo, useState } from 'react';
import { X, RotateCcw, ChevronRight, Sliders } from 'lucide-react';
import {
  type GraphSettingsState,
  type FolderOverride,
  DEFAULTS,
  DEFAULT_COLORS,
  categoryColor,
  resolveFolderField,
  visibleCategories,
} from '@/lib/graphSettings';
import { useLanguage } from '@/lib/i18n';

type Props = {
  settings: GraphSettingsState;
  onChange: (s: GraphSettingsState) => void;
  onClose: () => void;
  /** Every folder path present in the wiki — both real page-path
   *  prefixes (`meetings/hr` because a page lives there) AND
   *  user-created custom folders (`meetings/it-team` because the
   *  user made it empty). Each becomes a row in the color tree
   *  with its own color picker + per-folder physics overrides.
   *  Top-level categories that aren't paths show too, so the seed
   *  palette still has entries. */
  folderPaths?: string[];
};

type TreeNode = {
  path: string;        // full slash path, '' for root
  name: string;        // last segment
  children: TreeNode[];
};

function buildFolderTree(paths: Iterable<string>): TreeNode {
  const root: TreeNode = { path: '', name: '', children: [] };
  for (const p of [...paths].sort()) {
    const parts = p.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const segPath = parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.path === segPath);
      if (!child) {
        child = { path: segPath, name: parts[i], children: [] };
        node.children.push(child);
      }
      node = child;
    }
  }
  return root;
}

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

export default function GraphSettings({ settings, onChange, onClose, folderPaths }: Props) {
  const { t } = useLanguage();
  const set = <K extends keyof GraphSettingsState>(k: K, v: GraphSettingsState[K]) =>
    onChange({ ...settings, [k]: v });

  const setColor = (cat: string, color: string) =>
    onChange({ ...settings, colors: { ...settings.colors, [cat]: color } });

  const resetAll = () => onChange({ ...DEFAULTS, colors: { ...DEFAULT_COLORS }, folderOverrides: {} });

  // Build the folder tree: union of seed categories, every folder
  // path the graph data exposes, and top-level entries from the seed
  // category list (so a category without any pages still shows).
  const tree = useMemo(() => {
    const seeds = visibleCategories(folderPaths || []);
    return buildFolderTree([...seeds, ...(folderPaths || [])]);
  }, [folderPaths]);

  // Folder overrides: per-folder color + nodeSize + repelForce.
  const setOverride = (folder: string, patch: Partial<FolderOverride>) => {
    const cur = settings.folderOverrides[folder] || {};
    const next: FolderOverride = { ...cur, ...patch };
    // If every field is unset, drop the entry entirely so the state
    // doesn't bloat with empty objects.
    const cleaned: Record<string, FolderOverride> = { ...settings.folderOverrides };
    if (next.color === undefined && next.nodeSize === undefined && next.repelForce === undefined) {
      delete cleaned[folder];
    } else {
      cleaned[folder] = next;
    }
    onChange({ ...settings, folderOverrides: cleaned });
  };

  // Which folder's physics sub-panel is expanded inline. Only one
  // open at a time keeps the panel from ballooning.
  const [physicsOpen, setPhysicsOpen] = useState<string | null>(null);

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
          <Slider label={t('graphSettings.depthScale')} value={settings.depthScale}
            min={0.7} max={1.0} step={0.01}
            onInput={(v) => set('depthScale', v)} />
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
          <div className="space-y-0">
            {tree.children.map((node) => (
              <FolderRow
                key={node.path}
                node={node}
                depth={0}
                settings={settings}
                setColor={setColor}
                setOverride={setOverride}
                physicsOpen={physicsOpen}
                togglePhysics={(p) => setPhysicsOpen((cur) => cur === p ? null : p)}
              />
            ))}
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

/** Recursive row for the per-folder settings tree. Each folder gets
 *  its own color swatch (overridable via picker), a chevron to drill
 *  into subfolders, and a sliders icon that toggles an inline mini-
 *  panel with `nodeSize` + `repelForce` overrides for that folder. */
function FolderRow({
  node, depth, settings, setColor, setOverride, physicsOpen, togglePhysics,
}: {
  node: TreeNode;
  depth: number;
  settings: GraphSettingsState;
  setColor: (cat: string, color: string) => void;
  setOverride: (folder: string, patch: Partial<FolderOverride>) => void;
  physicsOpen: string | null;
  togglePhysics: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);  // top-level open by default
  const hasChildren = node.children.length > 0;
  const isPhysicsOpen = physicsOpen === node.path;
  const ov = settings.folderOverrides[node.path] || {};

  // Effective color for the picker: explicit override wins; otherwise
  // walk up via `resolveFolderField`; otherwise category default;
  // otherwise hash-derived for unknown categories.
  const effColor = resolveFolderField(node.path, 'color', settings.folderOverrides)
    ?? categoryColor(node.path.split('/')[0], settings.colors);
  // Decide whether the picker writes into folderOverrides (sub-paths)
  // or into the top-level `colors` map (root categories). Keeping the
  // top-level grid working with the legacy `colors` map keeps the
  // chosen colors stable for existing setups that didn't know about
  // overrides.
  const isTopLevel = depth === 0;
  const onPickColor = (hex: string) => {
    if (isTopLevel) setColor(node.path, hex);
    else setOverride(node.path, { color: hex });
  };

  // Indent grows with depth so nesting reads visually. Cap so the
  // rightmost controls don't get pushed off.
  const indent = Math.min(depth, 4) * 12;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1 group"
        style={{ paddingLeft: indent }}
      >
        {hasChildren ? (
          <button
            className="w-3.5 h-3.5 grid place-items-center shrink-0 text-muted hover:text-ink"
            onClick={() => setExpanded((p) => !p)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              size={11}
              className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <label
          title={node.path}
          className="relative w-4 h-4 rounded-full border border-white/15 shrink-0 cursor-pointer overflow-hidden"
          style={{ backgroundColor: effColor, boxShadow: `0 0 6px -1px ${effColor}` }}
        >
          <input
            type="color"
            value={effColor}
            onChange={(e) => onPickColor(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <span className="text-[0.75rem] text-muted truncate flex-1 group-hover:text-ink">
          {node.name}
        </span>
        <button
          className={`w-5 h-5 grid place-items-center rounded transition-colors ${
            isPhysicsOpen
              ? 'bg-accent/20 text-accent'
              : 'text-muted/60 hover:text-ink hover:bg-white/[0.06]'
          }`}
          onClick={() => togglePhysics(node.path)}
          title="Per-folder physics"
        >
          <Sliders size={10} />
        </button>
      </div>

      {isPhysicsOpen && (
        <div
          className="ml-3 mr-1 mb-2 px-2.5 py-2 border-l-2 border-accent/30 bg-white/[0.03] rounded-r space-y-2"
          style={{ marginLeft: indent + 8 }}
        >
          <MiniSlider
            label="Node size"
            value={ov.nodeSize ?? settings.nodeSize}
            min={0.3} max={1.4} step={0.05}
            onInput={(v) => setOverride(node.path, { nodeSize: v })}
            onClear={ov.nodeSize !== undefined ? () => setOverride(node.path, { nodeSize: undefined }) : undefined}
          />
          <MiniSlider
            label="Repel force"
            value={ov.repelForce ?? settings.repelForce}
            min={-300} max={-10} step={5}
            onInput={(v) => setOverride(node.path, { repelForce: v })}
            onClear={ov.repelForce !== undefined ? () => setOverride(node.path, { repelForce: undefined }) : undefined}
            fmt={(v) => v.toFixed(0)}
          />
          {ov.color && (
            <button
              className="text-[0.7143rem] text-muted hover:text-rose-300 underline-offset-2 hover:underline"
              onClick={() => setOverride(node.path, { color: undefined })}
            >
              Reset color
            </button>
          )}
        </div>
      )}

      {hasChildren && expanded && node.children.map((c) => (
        <FolderRow
          key={c.path}
          node={c}
          depth={depth + 1}
          settings={settings}
          setColor={setColor}
          setOverride={setOverride}
          physicsOpen={physicsOpen}
          togglePhysics={togglePhysics}
        />
      ))}
    </div>
  );
}

/** Compact slider with a tiny "reset to default" toggle. */
function MiniSlider({
  label, value, min, max, step, onInput, onClear, fmt,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onInput: (v: number) => void;
  onClear?: () => void;
  fmt?: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[0.7143rem]">
        <span className="text-muted">{label}</span>
        <span className="flex items-center gap-1.5">
          <span className="text-ink/85 font-mono tabular-nums text-[0.7143rem]">
            {fmt ? fmt(value) : value.toFixed(2)}
          </span>
          {onClear && (
            <button
              className="text-muted/70 hover:text-rose-300 text-[0.7143rem]"
              onClick={onClear}
              title="Use global value"
            >
              ×
            </button>
          )}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onInput(parseFloat(e.target.value))}
        className="w-full mt-0.5 h-1 accent-accent cursor-pointer"
      />
    </div>
  );
}
