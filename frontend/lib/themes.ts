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
  | { type: 'video'; src: string }
  | { type: 'image'; src: string };

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
];

export const DEFAULT_THEME_ID = 'aurora';

/** Look up a theme by id, falling back to the first (Aurora). */
export function getTheme(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
