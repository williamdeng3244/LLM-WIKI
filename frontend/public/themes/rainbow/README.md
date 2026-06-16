# Rainbow theme — background assets

Inspired by the Obsidian "Dracula for Obsidian" theme (id `rainbow`). Two
minimal **image** textures (not video): a dark Dracula backdrop and a light
Alucard backdrop. Signature features (all in `globals.css`): colored **note
title**, **rainbow markdown headings**, colored bold / links / inline-code
(`.prose-body`), and a **per-note rainbow file tree** (`[data-rainbow]` index
set in `FileTree.tsx`). Dark uses the Dracula palette; light uses vibrant jewel
tones legible on cream.

## Files (here, in `frontend/public/themes/rainbow/`)
| Mode | File        | Look                                  |
|------|-------------|---------------------------------------|
| Dark | `dark.png`  | Minimal deep-purple `#282a36` texture |
| Light| `light.png` | Minimal warm-cream `#fffbeb` texture  |

Minimal abstract textures (subtle gradient + soft grain, no objects) so note
text stays readable. Generated with Higgsfield GPT Image 2, 16:9, 2k.

## Palettes (official Dracula + Alucard specs)
### Dracula (dark)  — bg `#282a36`, fg `#f8f8f2`
pink `#ff79c6` · purple `#bd93f9` · red `#ff5555` · orange `#ffb86c` ·
yellow `#f1fa8c` · green `#50fa7b` · cyan `#8be9fd`

### Alucard (light) — bg `#fffbeb`, fg `#1f1f1f`
pink `#a3144d` · purple `#644ac9` · red `#cb3a2a` · orange `#a34d14` ·
yellow `#846e15` · green `#14710a` · cyan `#036a96`

## Rainbow mapping (`.prose-body`, per mode)
| Element | Dracula | Alucard |
|---------|---------|---------|
| H1 | pink    | `#a3144d` |
| H2 | purple  | `#644ac9` |
| H3 | red     | `#cb3a2a` |
| H4 | orange  | `#a34d14` |
| H5 | green   | `#14710a` |
| H6 | cyan    | `#036a96` |
| **bold** | green | `#14710a` |
| link | cyan  | `#036a96` |
| `inline code` | purple | `#644ac9` |

Code blocks (`pre code`) are intentionally left to their own styling.

## Higgsfield prompts
- **Dark:** "Minimal abstract dark background texture, deep Dracula
  purple-charcoal `#282a36`, very subtle soft diagonal gradient, faint violet
  glow in one corner, fine grain. No objects, no text. Calm, even, clean."
- **Light:** "Minimal abstract light background texture, warm cream `#fffbeb`,
  subtle soft gradient, faint lavender tint in one corner, fine paper grain.
  No objects, no text. Soft, airy, clean."
