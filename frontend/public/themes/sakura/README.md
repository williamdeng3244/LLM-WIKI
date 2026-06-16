# Sakura theme — background assets

Generate these two backgrounds in **Higgsfield**, drop them in this folder, look
them over, and when they look good tell Claude **"Sakura looks good, go"** — the
theme then gets implemented (palette sampled from these images + Aurora untouched).

## Files to add (here, in `frontend/public/themes/sakura/`)
| Mode | Filename            | Scene                                   |
|------|---------------------|-----------------------------------------|
| Day  | `light.jpg` / `.mp4`| Bright daytime zen garden               |
| Night| `dark.jpg`  / `.mp4`| The *same* garden at night, lamps lit   |

Image **or** video both work — the theme background renderer supports either.
Use **video** if you want the petals to actually animate (like Aurora); a still
**image** is lighter and still looks great.

## Specs (for a crisp full-screen background)
- **Aspect:** 16:9
- **Resolution:** 2560×1440 (min 1920×1080)
- **Image:** JPG/PNG, compressed to ~1–2 MB
- **Video:** MP4 (H.264), 5–10 s seamless loop, muted, ~3–8 MB
- **Keep the upper ~20% calm/open** — the app's topbar + panels sit there, so a
  busy top edge fights the chrome. Put the trees/lanterns lower in frame.

## Higgsfield prompts

### Light (day — bright sky, spiritual, zen)
> Hyperrealistic cinematic wide-angle photograph of a serene Japanese zen garden
> in full spring bloom. Majestic sakura (cherry-blossom) trees heavy with soft
> pink petals arch over a tranquil koi pond. A gentle shower of cherry-blossom
> petals drifts through the air. Bright clear soft-blue sky, diffused morning
> sunlight, golden volumetric light rays filtering through the branches. A
> weathered moss-covered stone lantern and smooth stepping stones beside the
> water. Spiritual, peaceful, zen atmosphere; warm and airy; shallow depth of
> field; ultra-detailed; 8K; cinematic color grading. Calm open sky in the upper
> third. Mood: enlightenment, stillness, renewal.

### Dark (night — same scene, lamps lit)
> Hyperrealistic cinematic wide-angle photograph of the SAME serene Japanese zen
> garden at night. The same sakura trees and koi pond, now lit by warm glowing
> stone lanterns and hanging paper lamps whose light pools across the petals and
> water. A gentle shower of cherry-blossom petals drifts through the air, catching
> the warm lamplight. Deep twilight-blue sky, soft moonlight, a scatter of stars,
> low atmospheric mist. Warm amber light against cool blue shadows; intimate,
> magical, meditative nighttime mood; volumetric light; ultra-detailed; 8K;
> cinematic color grading. Darker calm sky in the upper third. Keep the
> composition identical to the daytime version — same trees, pond, lantern,
> framing — just transformed to night.

## Tip for matching light <-> dark
Generate the **light** image first, then feed it back into Higgsfield as an
**image-to-image / style reference** for the **dark** one. Sharing the same
composition (day -> night) is what makes the light/dark toggle feel magical.
