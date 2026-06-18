// Theme registry — single source of truth for selectable themes. Each theme
// is a complete aesthetic bundle: its CSS variables live under
// [data-theme-id="<id>"] in globals.css (colors, accents, fonts), and it
// declares a background asset per mode here. The Appearance gallery and the
// ThemeBackground component both read from this list.
//
// Adding a theme = (1) drop assets in /public/themes/<id>/, (2) add a
// [data-theme-id="<id>"] CSS block in globals.css, (3) add an entry below.
export type ThemeMode = 'light' | 'dark';

export type ThemeBg =
  | { type: 'video'; src: string; rate?: number }   // rate < 1 slows playback → longer loop
  | { type: 'image'; src: string }
  | { type: 'css' };   // minimal CSS-painted backdrop (no asset); see globals.css

export type ThemeDef = {
  id: string;
  name: string;
  description: string;
  // Swatch colors for the Appearance gallery preview (per mode).
  preview: {
    light: { bg: string; accent: string };
    dark: { bg: string; accent: string };
  };
  background: { light: ThemeBg; dark: ThemeBg };
};

export const THEMES: ThemeDef[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Deep-space starfield (dark) and aurora sky (light).',
    preview: {
      light: { bg: '#f5f1e8', accent: '#3a63d9' },
      dark: { bg: '#070a14', accent: '#7c9cff' },
    },
    background: {
      light: { type: 'video', src: '/bg-light.mp4' },
      dark: { type: 'video', src: '/bg.mp4' },
    },
  },
  {
    id: 'sakura',
    name: 'Sakura',
    description: 'Cherry-blossom zen garden — bright day, lantern-lit night.',
    preview: {
      light: { bg: '#f6ece8', accent: '#c85d80' },
      dark: { bg: '#0b0c1a', accent: '#e88aa6' },
    },
    background: {
      light: { type: 'video', src: '/themes/sakura/light.mp4' },
      dark: { type: 'video', src: '/themes/sakura/dark.mp4' },
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    description: 'Minimal — flat backdrop with a faint dot grid and soft glow.',
    preview: {
      light: { bg: '#f6f7f9', accent: '#4f46e5' },
      dark: { bg: '#0e1014', accent: '#818cf8' },
    },
    background: {
      light: { type: 'css' },
      dark: { type: 'css' },
    },
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    description: 'Rainy cyberpunk neon city — Blade Runner night, misty chrome dawn.',
    preview: {
      light: { bg: '#f4f2f8', accent: '#7c3aed' },
      dark: { bg: '#0c0a14', accent: '#a855f7' },
    },
    background: {
      light: { type: 'video', src: '/themes/synthwave/light.mp4?v=2', rate: 0.6 },
      dark: { type: 'video', src: '/themes/synthwave/dark.mp4?v=2', rate: 0.6 },
    },
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    description: 'Rainbow titles, headings & notes — Dracula dark, Alucard light.',
    preview: {
      light: { bg: '#fffbeb', accent: '#8b2fd6' },
      dark: { bg: '#282a36', accent: '#bd93f9' },
    },
    background: {
      light: { type: 'image', src: '/themes/rainbow/light.png' },
      dark: { type: 'image', src: '/themes/rainbow/dark.png' },
    },
  },
  {
    id: 'frog',
    name: 'Frog Pond',
    description: 'A cozy lily pond with a little frog — sunny day, moonlit night.',
    preview: {
      light: { bg: '#eaf1dc', accent: '#3f8f63' },
      dark: { bg: '#0b1512', accent: '#74c69d' },
    },
    background: {
      // Light runs at 0.8× for a calmer drift; dark plays at native speed.
      light: { type: 'video', src: '/themes/frog/light.mp4', rate: 0.8 },
      dark: { type: 'video', src: '/themes/frog/dark.mp4' },
    },
  },
];

export const DEFAULT_THEME_ID = 'aurora';

/** Look up a theme by id, falling back to the first (Aurora). */
export function getTheme(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
