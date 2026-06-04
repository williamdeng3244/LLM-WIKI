# Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current light/dark aesthetic a selectable theme ("Aurora") in Settings → Appearance, with the infrastructure to add more themes (each with its own light+dark background, accents, and colors) later.

**Architecture:** Split the single aesthetic into two orthogonal axes on `<html>`: `data-theme-id` (which theme) × `data-theme` (light/dark mode). Unify the color tokens onto CSS variables so a theme overrides everything by redefining one variable set, scoped under `[data-theme-id="<id>"]`. A registry (`lib/themes.ts`) drives the background component and the Appearance gallery. Selection persists to the account (`preferences.appearance`) with a localStorage cache for no-flash load.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind (CSS-variable tokens), existing `preferences` JSON column + `PUT /api/auth/me/preferences`.

**Gating constraint:** Aurora (dark + light) must render identically to pre-refactor. Verify visually after the token unification (Task 2) before continuing.

---

## File structure

- `frontend/lib/themes.ts` — **new.** Theme registry (`THEMES`, `DEFAULT_THEME_ID`, lookup helpers, background asset types). One responsibility: declare available themes + their assets.
- `frontend/tailwind.config.ts` — **modify.** Repoint color tokens to `var(--*)`.
- `frontend/app/globals.css` — **modify.** Define the full variable set under `[data-theme-id="aurora"]` (dark) and `[data-theme-id="aurora"][data-theme="light"]` (light); keep `:root` as fallback; replace the per-class `[data-theme="light"]` overrides with variable redefinition.
- `frontend/lib/theme.ts` — **modify.** `useTheme` manages `{ themeId, mode }`; writes `data-theme-id` + `data-theme`; localStorage cache; emits `theme:change` with `{ themeId, mode }`.
- `frontend/components/ThemeBackground.tsx` — **new** (replaces `VideoBackground.tsx`). Registry-driven; renders `<video>` or `<img>`; cross-fades on theme/mode change.
- `frontend/app/layout.tsx` — **modify.** Mount `ThemeBackground`; add a pre-paint inline script that sets `data-theme-id`/`data-theme` from localStorage before first paint.
- `frontend/components/SettingsModal.tsx` — **modify.** Appearance tab → theme gallery + a mode (light/dark) toggle; persist to the account.
- `frontend/app/page.tsx` — **modify.** Reconcile account ↔ theme: apply `user.preferences.appearance` on load; save on change when signed in.

Backend: **unchanged** (reuses `preferences` + the existing PUT).

---

### Task 1: Theme registry (`lib/themes.ts`)

**Files:**
- Create: `frontend/lib/themes.ts`

- [ ] **Step 1: Write the registry**

```ts
// Theme registry — single source of truth for selectable themes. Each theme
// is an aesthetic bundle: CSS variables (defined under [data-theme-id="<id>"]
// in globals.css) + a background asset per mode + a gallery preview accent.
export type ThemeMode = 'light' | 'dark';

export type ThemeBg =
  | { type: 'video'; src: string }
  | { type: 'image'; src: string };

export type ThemeDef = {
  id: string;
  name: string;
  description: string;
  // Preview swatch colors for the Appearance gallery card (per mode).
  preview: { light: { bg: string; accent: string }; dark: { bg: string; accent: string } };
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

export function getTheme(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
```

- [ ] **Step 2: Typecheck**

Run: `docker exec wiki-frontend-1 sh -c "cd /app && npx tsc --noEmit -p tsconfig.json" 2>&1 | grep themes.ts || echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/themes.ts
git commit -m "feat(themes): theme registry (Aurora) with per-mode backgrounds"
```

---

### Task 2: Unify color tokens onto CSS variables (the parity-critical refactor)

**Files:**
- Modify: `frontend/tailwind.config.ts`
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Read the current values** — record the exact hex for each Tailwind token (`paper`, `panel`, `elev`, `ink`, `accent`, `accent-glow`, `line`, `muted`, etc.) and each existing `--*` var, so the variable definitions reproduce them exactly.

Run: `sed -n '1,40p' frontend/tailwind.config.ts; sed -n '7,24p' frontend/app/globals.css`

- [ ] **Step 2: Repoint Tailwind color tokens to variables** in `frontend/tailwind.config.ts` — replace each hardcoded hex with `var(--token)` (introduce `--ink`, `--paper` etc. for tokens that lack a variable). Example shape:

```ts
colors: {
  ink:    'var(--ink)',
  paper:  'var(--paper)',
  panel:  'var(--panel)',
  elev:   'var(--elev)',
  line:   'var(--line)',
  'line-strong': 'var(--line-strong)',
  muted:  'var(--muted)',
  accent: 'var(--accent)',
  'accent-glow': 'var(--accent-glow)',
  // …keep any others, all as var(--*)
},
```

- [ ] **Step 3: Define the Aurora variable blocks** in `frontend/app/globals.css`. Keep `:root` as the fallback (current dark values). Add an Aurora dark block and a light block that **reproduce today's exact values** (dark from `:root` + the current Tailwind hex; light from the current `[data-theme="light"]` overrides):

```css
/* Default/fallback = Aurora dark, so untagged HTML still renders. */
:root,
[data-theme-id="aurora"] {
  --paper: #070a14;  --panel: #0e1322;  --elev: #141a2e;
  --line: #1f2638;   --line-strong: #2c3650;
  --ink: #e6e9f2;    --text: #eef0f7;   --muted: #9aa1b8;  --text-faint: #6c7388;
  --accent: #7c9cff; --accent-glow: #a78bfa;
  /* keep existing --bg/--bg-panel/--bg-elev aliases pointing at the same values
     if any call sites still use them, or migrate them to the names above */
}
[data-theme-id="aurora"][data-theme="light"] {
  --paper: #f5f1e8;  --panel: #ffffff;  --elev: #ffffff;
  --line: rgba(0,0,0,0.10);  --line-strong: rgba(0,0,0,0.18);
  --ink: #1a1a1a;    --text: #1a1a1a;   --muted: #5a6273;  --text-faint: #9aa1b8;
  --accent: #3a63d9; --accent-glow: #7c5cff;
}
```

  Then **remove the now-redundant per-class `[data-theme="light"]` color overrides** (e.g. `.bg-panel`, `.bg-elev`, `.bg-paper`, `.text-ink`, `.border-line`) — they're replaced by the variable redefinition. Keep non-color light overrides (scrim/wash opacity) but re-scope them to `[data-theme-id="aurora"][data-theme="light"]` (or leave as `[data-theme="light"]` since mode is still on `<html>`).

- [ ] **Step 4: Build + typecheck**

Run: `docker exec wiki-frontend-1 sh -c "cd /app && npx tsc --noEmit -p tsconfig.json" 2>&1 | grep -iE "tailwind|globals|error TS" | grep -v three || echo OK`
Expected: `OK`

- [ ] **Step 5: Apply Aurora on the html element** — temporarily ensure `data-theme-id="aurora"` is set (Task 5 makes it dynamic; for now, the `:root, [data-theme-id="aurora"]` selector means untagged HTML already gets Aurora). Restart the frontend.

Run: `docker compose restart frontend`

- [ ] **Step 6: VERIFY AURORA PARITY (gating)** — open `localhost:3000` in dark and light; spot-check topbar, panels, sidebar, reading view, `/help`, `/artifacts`, form inputs, buttons, the version badge. They must look identical to before. If anything shifted, fix the variable value to match the old hex. Do not proceed until parity holds.

- [ ] **Step 7: Commit**

```bash
git add frontend/tailwind.config.ts frontend/app/globals.css
git commit -m "refactor(theme): unify color tokens onto CSS variables under data-theme-id (Aurora parity)"
```

---

### Task 3: `useTheme` manages `{ themeId, mode }`

**Files:**
- Modify: `frontend/lib/theme.ts`

- [ ] **Step 1: Extend the hook.** Keep the `mode` behavior (key `wiki:theme`); add `themeId` (key `wiki:theme-id`, default `DEFAULT_THEME_ID`). On mount, hydrate both and set `data-theme-id` + `data-theme` on `<html>`. Expose `{ themeId, mode, setMode, setThemeId, toggle }`. Emit `theme:change` with `detail: { themeId, mode }` on either change.

```ts
import { DEFAULT_THEME_ID } from '@/lib/themes';
// …existing Theme = 'dark' | 'light' …
const MODE_KEY = 'wiki:theme';
const THEME_KEY = 'wiki:theme-id';

// inside the hook: track [mode, setModeState] (existing) AND
// [themeId, setThemeIdState]; hydrate both from localStorage; on set,
// write the data-* attribute, persist, and dispatch theme:change with
// { themeId, mode }. `toggle` flips mode (back-compat).
```

- [ ] **Step 2: Typecheck**

Run: `docker exec wiki-frontend-1 sh -c "cd /app && npx tsc --noEmit -p tsconfig.json" 2>&1 | grep -E "theme.ts|VideoBackground|SettingsModal|page.tsx" || echo OK`
Expected: `OK` (existing `useTheme()` consumers still get `theme`/`toggle`; keep those names as aliases — `theme` = `mode` — so nothing breaks).

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/theme.ts
git commit -m "feat(theme): useTheme manages themeId + mode, sets data-theme-id"
```

---

### Task 4: `ThemeBackground` (video/image, cross-fade) replacing `VideoBackground`

**Files:**
- Create: `frontend/components/ThemeBackground.tsx`
- Modify: `frontend/app/layout.tsx`
- Delete: `frontend/components/VideoBackground.tsx`

- [ ] **Step 1: Write `ThemeBackground.tsx`.** State: `{ themeId, mode }`, hydrated from `<html>` data-attrs on mount and updated via the `theme:change` listener. Resolve `getTheme(themeId).background[mode]`. Render two stacked fixed layers (outgoing + incoming) and cross-fade opacity on change; each layer is a `<video autoPlay loop muted playsInline>` for `type:'video'` or an `<img>`/CSS background for `type:'image'`. Keep the existing scrim element (`theme-scrim` class).

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { getTheme, type ThemeMode } from '@/lib/themes';
// fixed inset-0 -z-0; layer = video or img; crossfade via opacity transition.
```

- [ ] **Step 2: Swap the mount in `layout.tsx`** — `import ThemeBackground from '@/components/ThemeBackground'` and replace `<VideoBackground />` with `<ThemeBackground />`.

- [ ] **Step 3: Delete `VideoBackground.tsx`**

```bash
git rm frontend/components/VideoBackground.tsx
```

- [ ] **Step 4: Typecheck + restart + verify** the Aurora background still shows (dark video on dark, light video on light) and cross-fades on mode toggle.

Run: `docker exec wiki-frontend-1 sh -c "cd /app && npx tsc --noEmit -p tsconfig.json" 2>&1 | grep -E "ThemeBackground|layout" || echo OK; docker compose restart frontend`
Expected: `OK`; background renders.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ThemeBackground.tsx frontend/app/layout.tsx
git commit -m "feat(theme): ThemeBackground (video/image, cross-fade), retire VideoBackground"
```

---

### Task 5: Pre-paint script (no flash)

**Files:**
- Modify: `frontend/app/layout.tsx`

- [ ] **Step 1: Add an inline pre-paint script** in `<head>` (before body) that reads `wiki:theme-id` + `wiki:theme` from localStorage and sets `data-theme-id` / `data-theme` on `document.documentElement` synchronously, so the saved theme/mode is applied before first paint.

```tsx
<script dangerouslySetInnerHTML={{ __html:
  "try{var d=document.documentElement;var ti=localStorage.getItem('wiki:theme-id')||'aurora';d.setAttribute('data-theme-id',ti);var m=localStorage.getItem('wiki:theme');if(m==='light'||m==='dark')d.setAttribute('data-theme',m);}catch(e){}"
}} />
```

- [ ] **Step 2: Restart + verify** no flash of wrong theme on reload (set light, reload — stays light immediately).

Run: `docker compose restart frontend`

- [ ] **Step 3: Commit**

```bash
git add frontend/app/layout.tsx
git commit -m "feat(theme): apply saved theme/mode pre-paint (no flash)"
```

---

### Task 6: Appearance tab → theme gallery

**Files:**
- Modify: `frontend/components/SettingsModal.tsx`

- [ ] **Step 1: Replace the Appearance tab body.** Render a **theme gallery**: `THEMES.map(...)` → a card per theme showing the name, description, and a light+dark preview built from `theme.preview` (two swatches using `preview.{mode}.bg` + `preview.{mode}.accent`). Clicking a card calls `setThemeId(theme.id)`; the active theme is highlighted/checked. Keep a separate **Light / Dark** toggle that calls `setMode`. Use `useTheme()` for `{ themeId, mode, setThemeId, setMode }`. Add 中/EN strings (`themeLabel`, `mode`, etc.) to the existing `STR` map.

- [ ] **Step 2: Persist to the account.** On `setThemeId`/`setMode`, if `user` is signed in, save `appearance: { themeId, mode }` into preferences via `api.savePreferences({ ...user.preferences, appearance })` and `onUserChange(updated)`. (localStorage is already updated by `useTheme`.)

- [ ] **Step 3: Typecheck + restart + verify** the gallery shows Aurora as a card; selecting it + toggling mode works; reload persists.

Run: `docker exec wiki-frontend-1 sh -c "cd /app && npx tsc --noEmit -p tsconfig.json" 2>&1 | grep SettingsModal || echo OK; docker compose restart frontend`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add frontend/components/SettingsModal.tsx
git commit -m "feat(settings): Appearance theme gallery (Aurora) + mode toggle"
```

---

### Task 7: Reconcile account ↔ theme on the main page

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Apply saved appearance on login.** Add an effect: when `user?.preferences?.appearance` is present and differs from the current `useTheme` values, call `setThemeId` / `setMode` to apply it (account wins over cache on sign-in). Guard against loops (only apply when different).

- [ ] **Step 2: Typecheck + restart + verify** signing in on a second browser applies the saved theme.

Run: `docker exec wiki-frontend-1 sh -c "cd /app && npx tsc --noEmit -p tsconfig.json" 2>&1 | grep page.tsx || echo OK; docker compose restart frontend`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(theme): apply account-saved appearance on login (account wins over cache)"
```

---

### Task 8: Prove the "add a theme" path, then revert

**Files:**
- Temp-modify: `frontend/lib/themes.ts`, `frontend/app/globals.css`

- [ ] **Step 1: Add a throwaway second theme** — a `THEMES` entry `{ id: 'test', name: 'Test', … }` (image background or reuse Aurora's video) + a `[data-theme-id="test"]` CSS block with obviously different accent/bg. Restart.

- [ ] **Step 2: Verify** it appears as a second gallery card; selecting it recolors the UI + swaps the background; mode toggle still works; the choice persists.

- [ ] **Step 3: Revert the throwaway theme** (remove the entry + CSS block) so only Aurora ships.

```bash
git checkout frontend/lib/themes.ts frontend/app/globals.css   # if uncommitted
```

- [ ] **Step 4: Final check + push**

```bash
docker exec wiki-frontend-1 sh -c "cd /app && npx tsc --noEmit -p tsconfig.json" 2>&1 | grep -v three | grep "error TS" || echo "typecheck clean"
docker exec wiki-backend-1 pytest tests/test_artifacts.py -q | tail -2
git push origin main
```

---

## Self-review notes

- **Spec coverage:** two axes (T2/T3/T5), token unification (T2), registry (T1), background video/image+crossfade (T4), persistence account+cache (T3/T6/T7), Appearance gallery (T6), add-a-theme path (T8). All covered.
- **Aurora parity** is an explicit gating step (T2 Step 6).
- **Back-compat:** `useTheme` keeps `theme`/`toggle` names so existing consumers (artifacts page, login page, SettingsModal) don't break (T3 Step 2).
- **No backend changes** — reuses `preferences` + PUT.
