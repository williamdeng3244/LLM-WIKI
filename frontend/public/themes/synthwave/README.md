# Synthwave theme — background assets

Two looping video backgrounds generated in **Higgsfield**: a rainy cyberpunk
night (dark, the hero) and the *same* street at hazy dawn (light). When they
look good, tell Claude **"Synthwave looks good, go"** — the theme then gets
implemented (palette sampled from these + Aurora/Sakura/Slate untouched).

## Files to add (here, in `frontend/public/themes/synthwave/`)
| Mode  | Filename    | Scene                                            |
|-------|-------------|--------------------------------------------------|
| Night | `dark.mp4`  | Rain-soaked cyberpunk neon street, flying car    |
| Dawn  | `light.mp4` | The *same* street at misty dawn, neon dimmed      |

## Specs (crisp full-screen background)
- **Aspect:** 16:9 · **Resolution:** >=1920x1080 (2560x1440 ideal)
- **Video:** MP4 (H.264), 5-10 s seamless loop, muted, ~3-10 MB
- **Keep the upper ~20% calm/darker** — the app topbar + panels sit there. Put
  the bright signs and street lower in frame; keep sky/upper buildings quieter.

## Palette (target — sampled from finished videos)
| Mode  | accent           | glow            | base bg   |
|-------|------------------|-----------------|-----------|
| Dark  | violet `#a855f7` | pink `#f472b6`  | `#0c0a14` |
| Light | violet `#7c3aed` | violet `#a855f7`| `#f4f2f8` |
*(Light uses a darker violet so accent text stays legible on the pale bg.)*

## Higgsfield prompts

### Dark (night — hero: rainy cyberpunk neon city)
> Hyperrealistic cinematic wide-angle photograph of a rain-soaked cyberpunk city
> street at night. Towering futuristic skyscrapers lined with glowing neon signs
> in electric violet, magenta-pink and cyan, their light reflecting in shimmering
> puddles and wet asphalt. Heavy atmospheric rain streaks through the air,
> volumetric light beams cutting through drifting fog and haze. A sleek flying
> car streaks past in the background, taillights trailing. Holographic billboards,
> dense hyperdetail, deep wet shadows, moody noir lighting, anamorphic lens
> flares. Violet and pink dominant palette against deep near-black. Ultra-detailed,
> 8K, cinematic color grading, shallow depth of field. Keep the upper third a
> calmer/darker sky for UI chrome. Mood: futuristic, electric, rainy nocturne.

### Light (dawn — same street, neon dimmed)
> Hyperrealistic cinematic wide-angle photograph of the SAME cyberpunk city street
> at hazy early dawn. The same towering skyscrapers and neon signs, now dimmed to
> a soft glow under pale misty daylight. Wet pavement and puddles catch cool
> morning light, light fog rolling between buildings; rain easing. A sleek flying
> car streaks past in the background. Cool desaturated chrome-and-violet palette,
> soft diffused light. Ultra-detailed, 8K, cinematic color grading, shallow depth
> of field. Calm pale sky in the upper third. Keep composition identical to the
> night version — same street, buildings, signs, framing — just transformed to
> misty dawn.

## Tip for matching light <-> dark
Generate the **dark** keyframe first (it's the hero), then feed it back into
Higgsfield as an **image reference** for the **light** one, then animate both to a
looping video. Sharing the composition (night -> dawn) is what makes the toggle
feel like a scene transition.

## What shipped (final recipe)
- **Keyframes:** GPT Image 2, 16:9 2k. Dark = hooded figure **leaning on the
  railing, slowly smoking a cigarette**, facing the city (Blade Runner 2049 /
  Altered Carbon mood). Light = same composition, misty dawn, neon dimmed.
- **Video:** Kling 3.0 (`kling3_0`), `--start-image <keyframe>`, `--duration 8`,
  `--mode pro`, 16:9. Natural continuous motion (no forced start=end — a leaning,
  non-walking subject loops cleanly; forcing the end frame caused a rewind).
- **Motion that worked:** keep the hero leaning/smoking (no turning, no walking);
  let the background pedestrian + flying car drift; rain on the wet floor.
- **Avoid:** Seedance 2.0 here returned empty results (silent failure). A walking
  hero + forced loop closure = visible "walk forward then rewind". Keep him still.
