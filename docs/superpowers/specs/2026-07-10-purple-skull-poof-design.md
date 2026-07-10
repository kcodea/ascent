# Purple Skull Poof — Deathrattle FX Redesign

**Date:** 2026-07-10 · **Author:** Mike (+ Claude) · **Status:** approved, pre-plan

Replace the Deathrattle bone skull-and-crossbones **shatter** with a **purple glowing skull that pops up and
poofs into smoke** — emulating the look of the CSS purple Rally float (`.float.rally.sym`) in the Pixi FX
layer. **Presentation-only**: no sim, no event log, no timing changes. `pixiFx.deathrattle(x, y, size)` keeps
its exact signature and call sites.

## Current behavior

`pixiFx.deathrattle()` ([`pixiFx.ts`](../../../packages/ui/src/pixiFx.ts)) pops a painted **bone**
skull-and-crossbones over the dying unit, holds, then EXPLODES it:

- `loadSkull()` fetches `/fx/skull-crossbones.png` (painted on black), alpha-keys the background, crops to the
  content bbox, and **grid-slices** it into a 6×6 atlas of fragment sub-textures (`skullFrags`).
- The `SkullPop` tick runs an elastic pop-in with a small upward drift + a hold jiggle, then calls
  `burstSkull()`.
- `burstSkull()` spawns: a warm flash, the 36 bone **fragments** (radial velocity + gravity + spin), ~7 bone
  **splinters** (`shardRectTex`), and a ~21-particle grey **smoke** bloom. `sfx.skullBurst()` fires on the break.
- Baked constants: `DR_SKULL_SCALE`, `DR_POP`, `DR_SPREAD`, `DR_SPLINTERS`, `DR_SMOKE`, `DR_GRID`.

## Desired behavior

Same beat (**pop → hold → burst**), new material:

1. A **purple glowing ☠** scales in with the existing elastic overshoot + upward drift + jiggle.
2. On burst it **poofs**: the skull itself scales up and fades (it dissolves, it does not shatter), a purple
   flash pulses, a **purple smoke plume** blooms outward, and a scatter of **glowing purple embers** flies
   radially and dies out.
3. No bone fragments. No splinters. No gravity. No debris.

The glyph is **☠** — the same character the Rally float uses — so the Pixi FX and the CSS float read as one
family. The colours are lifted from `.float.rally.sym` ([`styles.css`](../../../packages/ui/src/styles.css)):
fill `#cba6f0`, glow `rgba(180,120,240,.95)` / `rgba(160,100,230,.7)`.

## Design

Everything lives in `packages/ui/src/pixiFx.ts`. The `SkullPop` machinery (the pop-in tick) is untouched.

### 1. `loadSkull()` → `buildSkullTex()`

Drop the PNG entirely. Draw `☠` to an offscreen canvas: a large `ctx.font`, `fillStyle = #cba6f0`, filled 2–3
times through `ctx.shadowColor` / `ctx.shadowBlur` to **bake the CSS `text-shadow` stack into the texture**. The
glow then travels with the sprite through the pop and the fade — which is what sells "glowing." `Texture.from(canvas)`.

- Synchronous (no image fetch), so the `!this.skullTex` no-op guard becomes vestigial but stays for safety.
- Deletes `skullFrags`, `skullSrcH`'s fragment use, `DR_GRID`, the `Rectangle` sub-texture loop, and the
  alpha-key/bbox-crop pass (~40 lines).
- The sprite draws `blendMode: 'normal'`; an **additive glow sprite** sits behind it (`glowTex`, tinted, ~0.5
  alpha) so the skull blooms against the dark board. The glow sprite is parented in the pop and released with it.
- `/fx/skull-crossbones.png` is left on disk (unreferenced) — removing an LFS asset is its own PR.

### 2. `burstSkull()` rewritten

On the burst instant (`sfx.skullBurst()` fires unchanged, at the same moment):

| Layer | What |
|---|---|
| **Skull dissolve** | The skull texture hands off to a particle that scales ~1.6× and fades over ~200ms. The eye reads *this* as the poof — without it the skull just vanishes. |
| **Flash** | One additive `glowTex`, tint `#b478f0`, ~150ms, scaling out. |
| **Smoke** | The existing `glowTex` smoke particles (same count/drag/lifetime knobs), tinted from a purple-grey ramp (`#4a3a5e` → `#6b5580`), biased more **outward** than upward so it explodes rather than rises. |
| **Embers** | ~14 small additive `glowTex` sparks, radial velocity, high drag, tint `#cba6f0` / `#e0c4ff`, shrinking to nothing over ~500ms. These replace the splinters and carry the explosion energy. |

### 3. Constants

`DR_SKULL_SCALE`, `DR_POP`, `DR_SPREAD`, `DR_SMOKE` keep their shape. `DR_SPLINTERS` + `DR_GRID` are removed.
Added: `DR_EMBERS` (count multiplier) and a `DR_TINT` palette block (fill / glow / flash / smoke ramp / ember
pair). Baked constants, **no live tuner** — same as today, by design.

## Non-goals

- No `@game/core` / `sim` / `content` changes. No change to *when* the FX fires.
- No change to the CSS Rally float, the Rally medallion pulse, or `sfx.skullBurst`.
- No live tuner panel. Tuned once on the preview, then baked.
- Not deleting the now-unused `skull-crossbones.png` asset.

## Testing

The Pixi FX methods no-op under node, so this is **preview-verified, not unit-tested**.

Per the project's FX rule (agree the look on a cheap preview *before* wiring the feature), the work is gated:

1. **Preview first.** Build `apps/web/public/fx/purple-skull-preview.html` — a standalone page (mirroring the
   deleted `skull-shatter-preview.html`) running the same math, with live sliders for scale / pop / spread /
   smoke / embers / tint. Owner tunes it and hands back the numbers.
2. **Only then** touch `pixiFx.ts`, baking the tuned values.
3. `npm run typecheck && npm run lint && npm test && npm run build:web` green; owner previews the real fight.

## Rollout

Built in an isolated worktree (`feat/purple-skull-poof`, off `origin/main`). Parallel-safe with
`feat/aftermath-ordering` (that branch retimes *when* `deathrattle()` is called, in `useCombatReplay.ts`; this
one changes *what it draws*, in `pixiFx.ts`) — whichever lands second rebases. Owner previews before merge.
