# Theme System — Design Spec

**Date:** 2026-06-04
**Status:** Approved (design); pending implementation plan
**Owner:** William

## Goal

Turn the app's single light/dark aesthetic into a **multi-theme system**. A
*theme* is a complete aesthetic bundle — colors (text, accents, bars/panels,
note/content backgrounds), background asset (video or image), and optionally
fonts — with its own **light and dark** variants. Users pick a theme by
preference/mood, independently of light/dark mode.

The current aesthetic becomes the first theme, **"Aurora."** Future themes
(e.g. a Higgsfield-generated one) drop in without architecture changes.

Inspiration: Obsidian community themes (e.g. Wasp), where a theme is a bundle
of CSS variables scoped by light/dark.

## Core model: two independent axes

`<html>` carries two attributes:

| Attribute | Meaning | Example values |
|---|---|---|
| `data-theme-id` | which theme | `aurora`, `wasp` |
| `data-theme` | mode | `light`, `dark` |

CSS variables resolve **base → theme → mode**:

```css
:root { /* safe fallback defaults */ }
[data-theme-id="aurora"] { /* Aurora dark tokens */ }
[data-theme-id="aurora"][data-theme="light"] { /* Aurora light overrides */ }
```

Theme and mode are orthogonal: changing the theme keeps the current mode, and
toggling mode keeps the current theme.

## Foundational refactor: unify color tokens onto CSS variables

Today colors exist in **two systems**:

1. **CSS variables** (`--bg`, `--bg-panel`, `--accent`, …) used by `.form-input`,
   `.btn`, and `var(--x)` call sites.
2. **Hardcoded hex in `tailwind.config.ts`** (`paper`, `panel`, `ink`, `elev`,
   `accent`, …) consumed as utility classes (`bg-paper`, `text-ink`), with
   per-class light overrides in `globals.css` under `[data-theme="light"]`.

A theme must change **all** colors, so we unify these:

- `tailwind.config.ts` color tokens are repointed at CSS variables, reusing the
  existing names where present: `accent: 'var(--accent)'`,
  `panel: 'var(--bg-panel)'`, `elev: 'var(--bg-elev)'`, `paper: 'var(--bg)'`,
  `ink: 'var(--ink)'`, `muted: 'var(--text-muted)'`, etc. Add a variable for any
  tailwind-only token (e.g. `--ink`, `--paper`) that lacks one.
- Each theme defines the full variable set (dark block + light block). Where a
  tailwind token's current hex differs slightly from an existing variable (e.g.
  `ink` `#e6e9f2` vs `--text` `#eef0f7`), reconcile to one value during
  implementation — the Aurora-parity check guards this.
- The current per-class `[data-theme="light"]` overrides in `globals.css` are
  **replaced** by redefining the variables in the Aurora light block. Utility
  class *names* in JSX do not change — only the token values become
  variable-driven. (Net result: `bg-panel`, `text-ink`, etc. keep working
  everywhere; their color now comes from the active theme.)

**Constraint:** Aurora (dark + light) must look pixel-identical to today after
the refactor. This is the main implementation risk and the primary thing to
verify.

### Themeable token set

A theme may override:

- **Text / "words":** `--text` / `--ink` (primary), `--text-muted`, `--text-faint`.
- **Accents:** `--accent`, `--accent-glow` (links, active states, buttons,
  highlights).
- **Bars / panels / surfaces:** `--bg-panel`, `--bg-elev`, `--line`,
  `--line-strong`.
- **Note / content background:** `--bg` (page base / opaque reading surface used
  by reading view, `/help`, `/artifacts`), plus the `theme-scrim` /
  `reading-wash` overlay tints.
- **Background asset:** video or image per mode (see below).
- **Fonts (optional):** `--font-sans/display/serif/mono` — a theme may restyle
  typography or inherit the defaults.

## Theme registry — `lib/themes.ts`

Single source of truth. Typed list:

```ts
type ThemeBg =
  | { type: 'video'; src: string; fadeMs?: number }
  | { type: 'image'; src: string };

type ThemeDef = {
  id: string;            // 'aurora'
  name: string;          // 'Aurora'
  description: string;   // short blurb for the gallery card
  accent: string;        // hex used for the gallery swatch preview
  background: { light: ThemeBg; dark: ThemeBg };
};

export const THEMES: ThemeDef[] = [ /* aurora first */ ];
export const DEFAULT_THEME_ID = 'aurora';
```

Aurora's entry maps the existing assets: `dark → {video, /bg.mp4}`,
`light → {video, /bg-light.mp4}`. (The two transition clips are an Aurora
detail; the generic background component does a cross-fade and does not require
per-theme transition clips.)

## Background component — `ThemeBackground` (replaces `VideoBackground`)

- Reads the active `{themeId, mode}`, looks up `THEMES`, and renders the right
  element: `<video autoplay loop muted playsinline>` for `type:'video'`,
  `<img>` (or a CSS `background-image` layer) for `type:'image'`.
- **Cross-fades** on theme *or* mode change: render the outgoing and incoming
  layers stacked, fade opacity. (Generalizes the current video swap; drops the
  hard dependency on bespoke transition clips, which become optional.)
- Mounted once in `layout.tsx` (as today). Listens to a `theme:change` window
  event carrying `{ themeId, mode }`.

## Persistence — account-bound + local cache

- `useTheme` is extended to manage `{ themeId, mode }` (was: just `mode`).
- **Source of truth:** `user.preferences.appearance = { themeId, mode }` — saved
  via the existing `PUT /api/auth/me/preferences`; syncs across devices on login.
- **No-flash cache:** mirror to localStorage (`wiki:theme-id`, `wiki:theme`) and
  apply synchronously on mount (and via an inline pre-paint script in
  `layout.tsx`) so the saved theme/mode is set on `<html>` before first paint.
- **Reconciliation:** on login, the account value wins and updates the cache;
  signed-out users use the cache/defaults. Changing theme while signed in saves
  to the account (debounced) and updates the cache immediately.

## Appearance tab (Settings)

Replace the current Light/Dark cards with:

- **Theme gallery:** one card per `THEMES` entry. Each card shows a small
  **light + dark preview** (a swatch strip built from the theme's `accent` +
  surface colors, or a thumbnail of its background) and the name/description.
  Clicking a card applies that theme (keeps current mode). The active theme is
  checked/highlighted.
- **Mode toggle:** a separate Light / Dark control that sets the mode within the
  selected theme.
- Account-bound: changes persist to the user's preferences.

## Adding a new theme later (e.g. the Higgsfield theme)

Three steps, **no architecture changes**:

1. **Assets:** drop background files in `/public/themes/<id>/` (light + dark;
   video and/or image).
2. **CSS:** add a `[data-theme-id="<id>"]` block (dark tokens) and a
   `[data-theme-id="<id>"][data-theme="light"]` block (light overrides) defining
   the `--c-*` set (and optionally fonts).
3. **Registry:** add one `ThemeDef` entry to `lib/themes.ts`.

It then appears in the Appearance gallery automatically.

## Non-goals (YAGNI)

- **No runtime/plugin theme loading.** Themes are code (CSS + registry), built
  with the app — not dropped-in files at runtime like Obsidian. Simpler and
  type-safe; revisit only if user-supplied themes are needed.
- **No in-app theme editor / color picker.** Themes are authored in CSS.
- **No per-theme layout changes.** Themes restyle (colors, background, fonts),
  not the component structure.

## Verification

- **Aurora parity:** dark and light Aurora render identically to pre-refactor
  (spot-check topbar, panels, reading view, `/help`, `/artifacts`, inputs,
  buttons). This is the gating check for the token unification.
- Theme switch updates `data-theme-id`, swaps the background (cross-fade), and
  recolors the whole UI; mode toggle still works within a theme.
- Choice persists across reload (cache) and across devices when signed in
  (account); no flash of the wrong theme on load.
- A throwaway second theme (added during implementation, then removed) proves
  the "add a theme" path works end-to-end.

## Affected files (anticipated)

- `frontend/tailwind.config.ts` — color tokens repointed to CSS variables.
- `frontend/app/globals.css` — Aurora dark/light blocks under `[data-theme-id]`;
  replace per-class light overrides with variable redefinition; pre-paint inline
  theme script (or in `layout.tsx`).
- `frontend/lib/themes.ts` — **new** registry.
- `frontend/lib/theme.ts` — `useTheme` manages `{themeId, mode}` + account/cache.
- `frontend/components/VideoBackground.tsx` → `ThemeBackground.tsx`
  (video + image, cross-fade, registry-driven).
- `frontend/components/SettingsModal.tsx` — Appearance tab → theme gallery.
- `frontend/app/layout.tsx` — mount `ThemeBackground`; pre-paint theme script.
- (Backend unchanged — reuses `preferences` + the existing PUT.)
