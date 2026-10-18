# 2026-10-18 — Mobile perf pass: the missing particle pipe, a false ticker fault, cost-sized odds steps

Owner brief (2026-10-18): a "AAA experience, seamless 1:1 from mobile to desktop", with the standing >=160 fps bar,
and desktop must not regress. Branch `perf/mobile-pass`, built on the mobile audit's numbers (iPhone landscape,
4x CPU throttle, prod build).

## What shipped

1. **Particle effects could be invisible for a whole session (bug, R-FX-SCENE-PIPES-01).** Pixi v8 registers a
   scene type's render pipe when that type's module evaluates, and a renderer builds its pipe table once, at init.
   The only users of `ParticleContainer` and `NineSliceSprite` are in the lazily loaded FX primitives chunk, and
   Rollup tree-shook the classes out of the entry chunk, so their pipes registered only when that chunk ran. When
   the board overlay's `Application.init` finished first, the renderer had no `particle` pipe for the session:
   every burst, emitter and smoke on the board canvas was skipped, and every frame a live particle layer changed
   threw `Cannot read properties of undefined (reading 'updateRenderable')` out of the render pass. Measured on
   the prod bench build: the base renderer lacked the pipe in 3 of 5 full-flow sessions (both desktop runs, 1 of
   3 phone runs), and in 2 of 6 bare boot checks. Four `death-dissolve` plays fired into the shop drew nothing on
   base and drew their smoke on the fix. Fix: `pixiScenePipes.ts` imports `pixi.js/particle-container` and
   `pixi.js/sprite-nine-slice` (Pixi's own side-effect entry points) from `pixiFx.ts`, and `checkScenePipes`
   reports any renderer that still comes up without them as an `fx:faults` fault. Referencing the classes was
   tried first and does NOT work: the class modules are side-effect-free, so Rollup drops the reference. Entry
   chunk +23 kB minified, the lazy chunk -16 kB.
2. **False `ticker-stalled` faults (bug, R-FX-TICKER-WAKE-IN-TICK-01).** Pixi's `_tick` clears `_requestId` before
   running listeners, so `pixiFx.wake()` from inside a listener (a play retiring on its last frame) looked like the
   dead ticker and was reported (`console.error` with a stack) and stopped/started mid-frame. `reviveTicker` now
   judges the dead state in a microtask, after `_tick` has re-requested its frame. Base logged it in 5 of 5
   sessions; the fix in 0 of 5.
3. **Odds probe steps sized by measured cost.** The Combat Summary's 200-sim probe ran fixed 10-sim idle steps.
   `oddsStepper.ts` learns the per-sim cost and aims each step at ~2 ms (1 sim minimum, 10 maximum). Same sims,
   same seeds, same fold order: the result is byte-identical (odds.test.ts). `npm run perf:odds` now prints the
   1-sim floor beside the 10-sim slice: on Node, unthrottled, worst 10-sim slice 3-17 ms by wave vs worst single
   sim 0.7-4 ms. On the 4x phone a 10-sim step had been a 59 ms task (`odds:deferred` worst call).
4. **Phone-only FX budgets.** `deviceClass.ts` (`isPhone`: touch device whose shorter screen side is <= 600 px) gates
   `PHONE_DEFAULTS` in `fxBudgetConfig.ts`: 60% particle and filter ceilings. They only bite in pile-ups (oldest,
   faded plays trimmed first; wide fans thinned, never cut). Desktop, laptops and tablets keep the old numbers
   (pinned in `deviceClass.test.ts`).

Pixi resolution on phones was already capped at 2x on all three board canvases (`Math.min(dpr, 2)`), and at
`min(dpr, 2) * stageScale` or 1.5 on the others, so nothing changed there.

## What did not ship, and why

- **A drag write-skip** (write `zoom` / `perspective` / `transform-origin` / tilt only when changed). A trace of a
  moving drag showed `Layerize` on every frame before AND after (364/363 vs 277/276 frames, ~10 elements
  restyled a frame both ways), so it was reverted rather than shipped unmeasured. The per-frame re-layerize of the
  dragged card is the real drag cost and is written up as an open item in `docs/performance.md` §3i.
- **The "2.4 s combat-entry stall".** It is not shader compile, texture upload or entry-time layout. A WebGL hook
  showed no link, compile or texture upload in the frames before any big gap, and per-draw GPU time with
  `glFinish` maxed at 1.7 ms. The trace shows the GPU process's main thread blocked (`GLContextEGL::MakeCurrent`
  ~1 s wall with ~0 ms thread time) behind DOM raster flushes (`RasterDecoderImpl::DoEndRasterCHROMIUM`, 400+ ms):
  SwiftShader rasterising the DOM in software. Those gaps happen mid-combat and in the post-combat hold, not only
  at entry. Main thread idle through them. A real device is needed to say whether anything like it exists there.

## Measured (prod bench builds, `VITE_PERF_BENCH=1`, `vite preview`; headless Chromium, SwiftShader)

Flow: Practice god mode, Warden, seed 424242, buy and play to 7, a 90-move touch/mouse drag, End Turn into a
round-13 opponent board, the post-combat hold. Mobile = iPhone landscape 844x390 at 3x, touch, 4x CPU throttle.
Desktop = 1920x1080 at 1x, mouse, no throttle. Medians of 3 (mobile) / 2 (desktop), base and fix interleaved.
`over 6.25 ms` is not reported: headless presents at 60 Hz, so every frame is over it in both builds.

**Caveat, read before the table:** the machine was shared with other agents' headless browsers through the
whole run (CPU load 55-63%), and SwiftShader draws in software, so frame times swing 2-5x between identical runs.
Treat the table as "no regression visible", not as a measured improvement. The two bug fixes are binary
(fault counts, pipe present) and do not depend on load.

| Window (median) | Mobile base | Mobile fix | Desktop base | Desktop fix |
|---|---|---|---|---|
| shop idle p95 / p99 ms | 16.8 / 16.8 | 33.3 / 50 | 16.8 / 33.2 | 16.8 / 16.8 |
| buy + play p95 / p99 ms | 83.3 / 166.7 | 83.3 / 233.4 | 216.6 / 350.1 | 250 / 366.7 |
| buy + play long tasks / longest ms | 102 / 530 | 122 / 503 | 21 / 278 | 27 / 786 |
| drag p95 / p99 ms | 50 / 66.7 | 83.4 / 233.3 | 116.6 / 166.6 | 116.7 / 216.7 |
| combat p95 / p99 ms | 333.3 / 883.4 | 316.6 / 766.6 | 566.6 / 1449.9 | 716.6 / 1633.3 |
| combat long tasks / longest ms | 159 / 869 | 96 / 914 | 22 / 878 | 8 / 254 |
| round pick -> first combat frame ms | 998 | 935 | 903 | 435 |
| `ticker-stalled` faults (sessions) | 3/3 | 0/3 | 2/2 | 0/2 |
| particle-pipe render faults (sessions) | 1/3 | 0/3 | 2/2 | 0/2 |

The fix build draws particle effects in sessions where the base drew none, so its combat and buy windows carry
more real FX work than base's broken sessions did. "round pick -> first combat frame" includes the god-mode
opponent board fetch from the backend, so it is not a pure render number.

## Method notes

- The bench (`mpbench.mjs`, kept outside the repo) blocks the backend's `/auth/` so no anonymous accounts were
  created after the first runs; reads (snapshot boards) still go through.
- `npm run perf` is engine-only and unaffected (no engine change).

## Needs a real device

- Whether any GPU-side combat stall exists on an iPhone (Safari Web Inspector, Timeline, with the GPU lane).
- The real-device frame times for buy/play and drag at 120 Hz; headless only presents at 60 Hz.
- The drag `Layerize` per frame (open item above).
