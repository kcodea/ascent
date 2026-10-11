# 2026-10-10 — Gameplay performance pass, part 2: the run-start freeze, shout FX, slow-frame attribution

Owner's in-game monitor report (5173 on main fc1bc665d, dev):
- Worst frame 124.9 ms; 920 frames over 8.3 ms in 368 s, almost all in the Shop.
- Unlabelled 75-150 ms long tasks, each blamed on a `pointermove` over `div.row.warband` / `div.app.lobby`.
- Only 6% of time attributed.

## Root cause of the unlabelled long tasks

The FX WebGL contexts were built, and every shader and filter program linked, in the **first shop of every run**.
- `Game.tsx` mounted `<PixiFxLayer/>` only for a run or the hero picker.
- Going back to the title unmounted it, and `pixiFx.detach()` destroyed the GL contexts with their compiled programs.
- The next run rebuilt them and relinked every program, one link per macrotask.
- Prod bench, first 2.4 s of a new run: long tasks of 144, 243, 96, 469, 805, 93, 151 and 75 ms.
- CPU profile: `getProgramParameter` 861 ms and `getContext` 757 ms.
- The pointermove was only the last input before each task. Hover sweeps and 1.3 s dwells over the warband, shop and
  hand reproduced **no** long task on dev or prod.

## What changed (no visual change)

1. **The FX layer lives for the whole session** (`Game.tsx`).
   - It mounts behind the boot splash, so the context build and the warm-up run before the title is in hand.
   - Every later run starts warm.
   - The canvas is inert until something fires, so this stays outside the 2026-08-30 "no board before a run" ruling.
   - Never detaching between runs also removes one trigger of the separate "Pixi ticker dies" bug being fixed on
     `fix/pixi-fx-stops-rendering` (a short-lived app's teardown wiping Pixi's module-global resources).
2. **The wipe canvas warms on idle at the title**, like Discover's. Recruit's mount used to pay its `getContext`
   (~200-450 ms).
3. **The charge glyph's lit-pixel sample is computed once per session**, on a CPU-backed canvas
   (`willReadFrequently`). Its `getImageData` was a ~74 ms GPU readback, repeated every turn.
4. **Reverb convolvers are pooled and pre-built on idle** (`fx/audioFilters.ts`).
   - Assigning `ConvolverNode.buffer` is ~6 ms of main thread.
   - The Shout icon's sound layer is reverb'd, so every Shout paid it.
5. **Per-frame particle tints skip Pixi's colour parser** (`setParticleGreyTint`). `Particle.tint =` parsed and
   clamped a colour for every particle every frame. The fast path writes the same packed value; a test pins this
   against the real setter.
6. **Attribution.**
   - The warm-up steps are labelled `fx:prewarm:<slot>`.
   - The monitor reads **Long Animation Frames**: a frame over 50 ms now yields `loaf:<invoker>:<function>` and
     `loaf:style-layout-paint` breakdown spans.
   - Seen on dev during the first startup: `loaf:event-listener:performWorkUntilDeadline` 302 ms (a React render
     task) and `loaf:style-layout-paint` 53 ms.

## Numbers (prod bench, 240 Hz)

| Scenario | Before (prod / dev) | After (prod / dev) |
|---|---|---|
| New run, long tasks in the first 2.4 s | 7, totalling 1,019 ms / 7, 1,049 ms | **2, 263 ms / 2, 293 ms** |
| Second run after returning to the title, program links | 102 ms of `getProgramParameter` | **0** |
| Warband hover sweep, frames over 6.25 ms | 12 / 13 | 12 / 13 |
| Dwell-hover every card, frames over 6.25 ms | 28 / 30 | 26 / 28 |
| Shout plays (Storm Chaser, Mushy, Roomworks), over 6.25 ms | 80 / 89 | 83-88 / 98 (noise) |
| End of Turn storm (2 Shriekers, 2 Gemlings), over 6.25 ms | 119 / 135 | 117 / 135 |

- The remaining two run-start tasks are the run's own first board render (~160-220 ms, mostly React mounting the
  whole shop) and the hero-pick click.
- In the shop scenarios the FX changes cut JS work (`fx:sim` total -16%, Shout-icon frame worst 13.9 -> 11.8 ms
  before the convolver pool warms), but frame counts are unchanged. Those frames are bound by the browser's
  style/layout/paint and the GPU, not by FX JavaScript:
  - Turning every FX filter off changed nothing.
  - The per-element restyle cost is the recruit-pass-1 proposal, still pending.

## Not changed

- **FLIP write** (owner worst 19.1 ms): the cost is the style recalc the React commit forces when a row changes.
  It shrinks with the CSS proposal, not with the FLIP code.
- **The first board render of a run** (`render:recruit` 61 ms dev, ~30 ms prod, plus the commit's restyle): one
  React mount of the whole shop.
