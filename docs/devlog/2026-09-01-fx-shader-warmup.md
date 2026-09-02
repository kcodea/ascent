# 2026-09-01 — the first-play freeze: the FX pre-warm that never ran

Follow-up to the recruit click-path measurement (`2026-09-01-perf-recruit-click-path.md`): the first minion
played in a run froze the page for 0.5–0.8 s in the prod build, on every machine, every session.

## What it was

A CPU profile through the sourcemaps put ~620 ms of the play window in `getProgramParameter` — a synchronous
shader link — under Pixi's `GlBatchAdaptor.start`, reached from `shapeTextures.ts`'s `generateTexture`. The
first `Graphics` the session ever rasterised (a burst's shape) compiled Pixi's batch shader, the most
expensive program in the app, on the first fire.

There was already a pre-warm for the FX programs (`prewarmFxMaterials`, from 2026-08). Two reasons it never
helped:

1. **It never ran.** `schedulePrewarm` polled `pixiFx.renderer` every 120 ms and gave up after 8 s. The FX
   canvas only mounted with the board, which in real play is a title screen, a mode pick and a hero ceremony
   after `ensureDefsReady()` fires on `Game` mount — well past 8 s. So every session's first fire linked its
   programs itself. (Any DEV session with the workbench open had the renderer early and looked fine.)
2. **It warmed the wrong context.** Even when forced, it linked the custom particle / ribbon / shockwave
   programs on the MAIN canvas — and the landing FX plays on the UNDER canvas, its own GL context with its own
   program cache. Confirmed with a second profile after fixing (1): the compile moved to
   `GlParticleContainerAdaptor.execute` under `pixiFx.renderUnder`, ~550 ms.

## What changed

- **`pixiFx.onRendererReady(cb)`** — called with every renderer the controller has now and every one it
  creates later (main canvas on each `attach`, each slot canvas as it comes up). The pre-warm hangs off this
  instead of a poll; a re-attach after `detach()` warms the new context again, because the old programs died
  with the old one.
- **The shape bake is part of the warm-up** (`prewarmShapeTextures`): baking the six built-in shapes is the
  same `generateTexture` the first fire would do, so it links the batch shader and caches the shapes.
- **Slot canvases get a link-only set** (`slotPrewarmSteps`): shape bake + one particle material + one ribbon
  + one shockwave, linked against the slot's own renderer and anchored per renderer so the programs stay
  cached. The module-global pools are untouched — they belong to the main context.
- **Steps run one per macrotask**, so no single frame absorbs every link.
- **The FX overlay mounts from the hero picker onward** (`Game.tsx`), not only with the board — it is an
  inert transparent canvas until a fire, so it sits outside the 2026-08-30 "nothing before a run" ruling, and
  it gives the warm-up the picker + ceremony seconds instead of the shop's card fly-in. One JSX position across
  both states, so the picker → board transition never detaches it.

## Measured (prod builds, headed Chrome, frame-rate cap off, RTX 4080)

Worst frame in each window, turn 1 of a Practice run, per run:

| window | main | this branch |
|---|---|---|
| hero picker (2.5 s after it opens) | 19 / 20 ms | 148 / 151 / 163 ms |
| shop entry (first 1.5 s) | 343 / 351 ms | 33 / 180 / 182 ms |
| first minion played | 484 / 520 ms (568–812 in earlier runs) | 15 / 50 / 67 ms |

The compile now lands as one ~150 ms frame during the hero picker — a screen that already runs at ~20 ms a
frame on this machine (129 of ~130 frames over budget on both builds; a separate finding, not touched here).
Shop entry also got cheaper, because attaching the canvas and building `pixiFx`'s own textures moved out of
that moment too. The profile of the fixed build shows zero `getProgramParameter` samples from the picker
onward.

## Not done

- Later plays still spike 70–160 ms intermittently on both builds (texture uploads / first-use variants —
  unattributed).
- The hero picker's own ~20 ms frames.
- `KHR_parallel_shader_compile` would make the link itself non-blocking, but Pixi queries `LINK_STATUS`
  synchronously right after linking; using it means patching Pixi's `generateProgram`. Not worth it while the
  link has a quiet moment to hide in.

Bench driver + profile attribution live in the session scratchpad (`bench/run.js`, `bench/attrib.js`).
