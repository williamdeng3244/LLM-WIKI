'use client';
// Central hotkey registry. The keydown handler (app/page.tsx) and the
// Settings → Hotkeys tab both read from here, so a binding has one source
// of truth. Customizable bindings are stored per-user in the account
// preferences (see api.savePreferences); defaults below match the original
// hardcoded behavior, so nothing changes until a user rebinds.
import type { UserPreferences } from '@/lib/api';

export type HotkeyId = 'search' | 'switcher' | 'suggest' | 'newTab' | 'closeTab';
export type HotkeyScope = 'global' | 'tabs' | 'dialog';

type LabelKey =
  | 'shortcuts.action.search' | 'shortcuts.action.switcher'
  | 'shortcuts.action.suggest' | 'shortcuts.action.newTab'
  | 'shortcuts.action.closeTab' | 'shortcuts.action.help'
  | 'shortcuts.action.nextTab' | 'shortcuts.action.prevTab'
  | 'shortcuts.action.escape';

export type HotkeyDef = {
  id: HotkeyId;
  labelKey: LabelKey;
  scope: HotkeyScope;
  default: string; // combo string, e.g. "mod+k"
};

// Rebindable, page-level shortcuts.
export const HOTKEYS: HotkeyDef[] = [
  { id: 'search', labelKey: 'shortcuts.action.search', scope: 'global', default: 'mod+k' },
  { id: 'switcher', labelKey: 'shortcuts.action.switcher', scope: 'global', default: 'mod+o' },
  { id: 'suggest', labelKey: 'shortcuts.action.suggest', scope: 'global', default: 'mod+e' },
  { id: 'newTab', labelKey: 'shortcuts.action.newTab', scope: 'tabs', default: 'mod+t' },
  // Unbound by default: Ctrl/Cmd+W is browser-reserved (close browser tab) and
  // a web page cannot override it — binding it advertised an in-app "close tab"
  // that actually closed the whole wiki. Close tabs via the tab's × button or
  // middle-click; users can assign a custom combo in Settings → Hotkeys.
  { id: 'closeTab', labelKey: 'shortcuts.action.closeTab', scope: 'tabs', default: '' },
];

// Shown in the list but not rebindable (special-cased / system keys).
export const FIXED_HOTKEYS: { keys: string; labelKey: LabelKey; scope: HotkeyScope }[] = [
  { keys: 'mod+?', labelKey: 'shortcuts.action.help', scope: 'global' },
  { keys: 'mod+shift+]', labelKey: 'shortcuts.action.nextTab', scope: 'tabs' },
  { keys: 'mod+shift+[', labelKey: 'shortcuts.action.prevTab', scope: 'tabs' },
  { keys: 'Escape', labelKey: 'shortcuts.action.escape', scope: 'dialog' },
];

export type Bindings = Record<HotkeyId, string>;

const DEFAULTS = HOTKEYS.reduce((acc, h) => {
  acc[h.id] = h.default;
  return acc;
}, {} as Bindings);

/** Merge a user's saved overrides over the defaults. */
export function resolveBindings(prefs?: UserPreferences | null): Bindings {
  const overrides = prefs?.hotkeys ?? {};
  const out: Bindings = { ...DEFAULTS };
  for (const h of HOTKEYS) {
    const v = overrides[h.id];
    if (typeof v === 'string' && v.trim()) out[h.id] = v;
  }
  return out;
}

function parseCombo(combo: string) {
  const parts = combo.toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  return {
    mod: parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    key: parts.filter((p) => !['mod', 'shift', 'alt'].includes(p)).pop() ?? '',
  };
}

/** Normalize a keydown event's key, layout-independent where it matters. */
function normalizeKey(e: KeyboardEvent): string {
  if (e.code === 'Slash') return '/';
  if (e.code === 'BracketRight') return ']';
  if (e.code === 'BracketLeft') return '[';
  let k = e.key.toLowerCase();
  if (k === ' ') k = 'space';
  return k;
}

/** Does this keydown match a combo string like "mod+shift+k"? */
export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false;
  const c = parseCombo(combo);
  if (c.mod !== (e.metaKey || e.ctrlKey)) return false;
  if (c.shift !== e.shiftKey) return false;
  if (c.alt !== e.altKey) return false;
  return normalizeKey(e) === c.key;
}

/** Capture a keydown into a combo string for rebinding. Returns null while
 *  only modifiers are held (binding not yet complete). */
export function eventToCombo(e: KeyboardEvent): string | null {
  const k = normalizeKey(e);
  if (['control', 'meta', 'shift', 'alt', 'os', 'capslock'].includes(k)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(k);
  return parts.join('+');
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform);

/** Pretty-print a combo for display: "mod+shift+k" → "⌘ ⇧ K" (or "Ctrl ⇧ K"). */
export function formatCombo(combo: string): string {
  const c = parseCombo(combo);
  const out: string[] = [];
  if (c.mod) out.push(IS_MAC ? '⌘' : 'Ctrl');
  if (c.shift) out.push('⇧');
  if (c.alt) out.push(IS_MAC ? '⌥' : 'Alt');
  if (c.key) {
    out.push(
      c.key.length === 1
        ? c.key.toUpperCase()
        : c.key.charAt(0).toUpperCase() + c.key.slice(1),
    );
  }
  return out.join(' ');
}
