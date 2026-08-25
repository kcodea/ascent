# Scene Lighting Prototype — Handoff (PARKED)

**Status:** built as a prototype on `feat/scene-lighting`, evaluated live with the owner, then **parked** and
the branch **deleted** (2026-08-25). This doc is the durable record so it can be resumed or rebuilt from
scratch. Nothing from the prototype shipped to `main`.

**Goal it chased:** the owner's spec `ASCENT_LIGHTING_VISUAL_TARGET_HANDOFF.md` (Codex-authored, kept outside the
repo under the owner's `Documents/Codex/`) — move the board from a flat look toward a warm-key / cool-fill /
vignette "lit scene," via a selective CSS grade + material response,
*without* touching gameplay, hit-testing, or Mike's authored FX. Feasibility was assessed as high (every hook
the spec named exists), and it was: the technique works. It was parked on a **taste** call, not a technical
blocker — see [Why it was parked](#why-it-was-parked).

---

## What was built

Two of the spec's three parts, all behind a master toggle (dev-tuner) with zero gameplay impact:

- **Part 1 — board grade.** Three root-level `position:fixed` gradient layers over the board: a warm key
  (upper-left), a cool fill (lower-right), and a focus vignette. Tunable colour / strength / position / spread /
  **angle** / **blend-mode** per layer.
- **Part 2 — card-frame material response.** A warm, upper-left directional gradient **masked to each card
  frame's silhouette** (standard / spell / taunt), so the frame *metal* catches the key while portraits stay
  untouched. Tunable colour + strength; folded through the master toggle.
- **🌅 Scene Lighting dev tuner** — the full control surface, following the repo's config/tuner pattern.

**Part 3 (event light pulses on placement/Ruby/Ward/etc.) was NOT built** — the review-after-Part-1 gate was
reached first.

### Files (all on the deleted branch)

| File | Role |
|---|---|
| `packages/ui/src/scene-lighting/SceneLightingLayer.tsx` | The 3 gradient layers. **Root-level fragment, NOT a wrapper** (see blend gotcha). Mounted in `Game.tsx` after `<Recruit/>`. |
| `packages/ui/src/scene-lighting/sceneLightingConfig.ts` | Config + `--scene-*` var apply + dev persistence. |
| `packages/ui/src/scene-lighting/SceneLightingTuner.tsx` | The tuner spec. Registered in `DevMenu.tsx`, `tunerAll.ts`, `tunerSchema.ts` (`scenelighting: '🌅'`). |
| `packages/ui/src/styles.css` | `.scene-lighting__warm/__cool/__focus` + `.card-ambient-light` (per-frame geometry mirrors `.cframe-tint`). |
| `packages/ui/src/Card.tsx` | `<span className="card-ambient-light">` added to std / spell / taunt frames. |
| `packages/ui/src/Game.tsx` | Mounts `<SceneLightingLayer/>` at root (NOT in Recruit — see z-index gotcha). |

### Branch commits (reference; branch deleted)

- `268fb12a` Part 1 board grade + tuner (mounted **in Recruit, under the cards** — the spec's original placement)
- `aa2e4d14` raise grade to z-index 7, lift card zones to 8 (light the frame, keep portraits) — **superseded**
- `4f971c23` root grade (z 50) + blend/angle controls + Part 2 frames
- `df8d5375` **flatten layers to root** so blend modes actually blend

---

## The three hard-won lessons (the valuable part)

### 1. To light the board *furniture*, the grade must be a ROOT layer above the HUD — which makes it global

The board's controls are NOT low z-index. The tier-up button is `.tvbwrap` at **z-index 41** (fixed); the
hero-power panel lives in the root `.statusbar` at **z 40/41**; the lobby rail is **z 60**; `.shopbar` is z 6;
board minions are `z:auto`. So a grade mounted *under the cards* (the spec's first idea) leaves every button
sitting flat on top, unlit — the owner's first rejection.

The only z that sits above the buttons + the root HUD is a **root-level layer above `.statusbar`** — landed at
**z-index 50** (below tooltips 60 / drag 115 / modals 160+ / dev-menu 9990). But that necessarily grades the
*cards too* (they're below it). **There is no z-index that is above the z-41 buttons yet below the cards, because
the buttons are already above the cards.** So "light the buttons, keep cards pristine" is impossible with a
single grade — it's global or nothing. This is the core tension the spec's "selective, under-cards" framing did
not anticipate.

### 2. A wrapper with `z-index` ISOLATES `mix-blend-mode` — the blend must live on a top-level element

The blend-mode control did nothing at first. Cause: the layers were children of a `.scene-lighting` wrapper
whose `position:fixed; z-index:50` forms a **stacking context**, which **isolates** blending — the children
blended only against each other (a transparent backdrop), so every mode looked identical. **Fix: flatten the
layers to root-level `position:fixed` siblings (no wrapper).** Then each layer's blend backdrop is the board, and
`multiply` darkens / `screen` lightens / `soft-light` reads dimensional — all distinct. Verified live.

> Rule of thumb: `mix-blend-mode` only blends within its own stacking context. Any ancestor that forms a
> stacking context (z-index + position, opacity < 1, filter, transform, `isolation`) walls the blend off from
> everything outside it.

### 3. `soft-light`/`overlay` beat `screen` for "not flat/hazy"

A flat `screen` lighten reads as a haze laid *on top*. `soft-light` / `overlay` interact with the pixels beneath
(darks stay dark), which reads as light *in* the scene. Defaults ended at `soft-light`, warm key ~0.42, vignette
cut to ~0.12.

### Part 2 masking recipe (reusable)

`.card-ambient-light` reuses the frame PNG masks the card already ships (same as `.cglow-rim` / `.cframe-tint`):
`-webkit-mask-image: url('/frames/standard-oval-v2.png' | 'spell-frame-arch.webp' | 'taunt-shield.png')`, with
per-frame geometry copied verbatim from the `.cframe-tint` rules (width / aspect-ratio / left / top). A
`linear-gradient(135deg, warm 0%, …, transparent 55%)` filled into that mask = warm metal on the upper-left,
`mix-blend-mode: screen`, `opacity: calc(var(--scene-frame-op) * var(--scene-master))`. Because the mask is the
frame silhouette (the window is transparent), it never touches the portrait.

---

## Why it was parked

The technique works and is fully tunable, but a **CSS gradient overlay has a ceiling**: it approximates
*atmosphere*, not *material relighting*. The Photoshop target relit every element individually; a gradient can
warm/cool and add depth, but can't make 3D-looking metal and gems catch light the way the target does. Part 1
alone is intentionally subtle; Part 2 helps (frames catch light); but even together the owner judged it short of
the target and not worth carrying further as an overlay.

**The honest next step for the target look is art relighting** (re-rendered/relit frame + board art, or a
shader), which is a separate, much larger project — not more overlay tuning.

## If resuming

- **To rebuild the overlay prototype:** recreate the files above. Mount the layers at **root** (Game.tsx), keep
  them **un-wrapped** (blend isolation), land the grade at **z 50**, drive everything off `--scene-*` vars with
  the styles.css fallbacks mirroring `SCENE_DEFAULTS`. The config/tuner follows the same pattern as
  `loadScreenConfig.ts` + `LoadScreenTuner.tsx` (a good, small reference that shipped).
- **Performance** was never a concern (static compositing; no new WebGL context; the spec's perf rules mirror
  the repo's own). Part 3 (event pulses) would ride the existing under-card Pixi lifecycle via `playDef` +
  `slot:'under'`.
- **The real decision** before any more work: overlay grade (cheap, ceiling ~"atmospheric") vs art relighting
  (expensive, can hit the target). Don't re-litigate the overlay unless the goal is explicitly just atmosphere.
