# ASCENT — performance (the north star)

**Performance is ASCENT's north star. The game must feel snappy at all times** — instant shop response, a
combat replay that never drops a frame, drag that tracks the cursor with no stutter. Snappiness is
fundamental to the feel of play; a hitch at the wrong moment reads as a bug even when the logic is correct.
Treat a frame drop as a defect, not a polish item. When a change *could* cost performance, measure it
(below) before shipping — **against the budget in §0, on the `worst` frame, not the mean.**

This doc is how we keep it honest — half of it I can automate, half we do together.

---

## 0. The frame budget (the number every measurement is judged against)

| | Refresh | Budget per frame |
|---|---|---|
| **Target** | **240 Hz** | **4.17 ms** |
| Stretch | 360 Hz (the owner's display) | 2.78 ms |
| Legacy reference | 60 Hz | 16.67 ms |

**The whole game, combat *and* shop, must fit in 4.17 ms.** Not the average frame — *every* frame. That
includes the shop opening, a drag, a combat collision, an autosave, and whatever React does when a phase
changes.

### `worst`, not mean, is the metric

A mean improvement that leaves the worst frame where it was **has not fixed anything a player can feel**. A
hitch is one frame; averages are exactly the instrument that hides it. Real example from this repo: the
`plateGild` canvas fix cut the mean frame in the gild's opening window by **24%** (6.48 → 5.82 ms) — a
genuine win, correctly measured — but the *worst* frame in that same window was ~16.7 ms, which read as
"fine, that's a 60 fps frame" and is **4× over budget** on the hardware the game is played on. Judge a
change by:

1. `worst` frame in the affected window (must trend toward ≤ 4.17 ms),
2. then the `long` / `jank` counts,
3. then p95. The mean is context, not a verdict.

### The calibration trap (why this section exists)

**A fixed millisecond threshold silently encodes an assumed refresh rate.** `perfMonitor` shipped with
`LONG_FRAME_MS = 33` / `JANK_MS = 50`, which look like neutral "slow frame" numbers and are in fact *60 Hz*
numbers: 2 and 3 frames at 16.67 ms. On a 360 Hz display a frame drops at 2.8 ms, so `long` only counted
after ~8 dropped frames and `jank` after ~12 — **the HUD reported a clean session while the game dropped
frames continuously.** The number that looks fine at 60 Hz is four times over budget at 240.

So the thresholds are no longer constants. They are **derived from the display we are actually presenting
to** (`packages/ui/src/refreshRate.ts`):

- `long` = **2 frame intervals** (dropped at least one frame), `jank` = **3** (a visible hitch). At 60 Hz
  that is exactly 33.3 / 50.0, so every log recorded before this change stays comparable; at 240 Hz it is
  **8.33 / 12.5**; at 360 Hz, **5.56 / 8.33**.
- The refresh is estimated from the **low decile of observed rAF intervals**, not the mean or median. Load
  can only make a frame interval *longer*, never shorter, so the fastest sustained cadence is the panel —
  and a loaded warm-up second (module eval, shader link, first paint) can no longer read as a low refresh
  rate and under-report for the rest of the session. Estimates snap to the ladder of real panel rates, which
  is what keeps a VRR/G-Sync display from wobbling the thresholds every second.
- Adoption is **asymmetric on purpose**: a *faster* reading is adopted immediately (nothing can fake a short
  interval), a *slower* one needs three consecutive corroborating windows. So a throttled or occluded
  second cannot permanently re-baseline the HUD, while genuinely dragging the window to a 60 Hz monitor
  does re-calibrate a few seconds later. Backgrounded buckets (`hidden`) are never fed in at all.
- Anything outside 24–1000 Hz is rejected as *no evidence* rather than clamped — a clamped absurd sample
  would masquerade as a real reading.

**Reading the HUD:** the `display · budget` row tells you which calibration is in force
(`240 Hz · 4.17 ms`). `60 Hz (assumed)` means no window has been measured yet — the first second. The
`long / jank` row prints its own thresholds, and every exported bucket carries the `hz` it was measured
against, because `long: 0` means "smooth" at one refresh and "we weren't looking" at another. The export
header also carries `display`, `thresholds` and the `budget` above, so a saved log is self-describing.

---


## The in-game perf HUD (measuring a real session)

`?perf=1` (sticky, or `localStorage.ascent.perf = '1'`, or 📊 Perf HUD in the dev menu) turns on a
bottom-right frame-health readout. **It ships in the production build on purpose** — this doc's own rule is
that a slowness report only counts against the prod build, so a dev-only HUD would measure the wrong thing.
Disabled it costs nothing: no rAF loop, no observers, nothing registered.

What it records, once per second, into an exportable timeline:

| | |
|---|---|
| `fps` | frames actually presented. A **ceiling**, not a score — rAF is capped at the display refresh, so 60 means "nothing dropped", not "fast". |
| `med / p95 / worst` | frame times. **`worst` is the number that finds hitches** — a 500ms stall inside an otherwise smooth second is invisible in an average, and it is judged against the §0 budget, not against 16.7 ms. |
| `long` / `jank` | frames over 2 / 3 frame intervals — **derived from the detected refresh** (§0), not fixed ms. 8.33 / 12.5 ms at 240 Hz. |
| `display · budget` | the detected refresh and its per-frame budget — the calibration the two rows above are measured against. `(assumed)` = not yet measured. |
| `longest task` | longest main-thread block, from `PerformanceObserver('longtask')`. Attributed by the browser, not inferred. |
| counters | live particles, sprite pool, weld rings, shields (from `pixiFx`). |
| `heap`, `dom nodes` | leak detection — a climbing node count shows up as slow style recalc. |
| context | phase + wave, so a spike is tied to where in the run it happened. |
| marks | which FX fired that second (`fx:weld`, `fx:aura`, …). |

### marks vs hotspots — correlation vs attribution

Two layers, and the difference matters:

- **`marks`** are cheap annotations — "this happened in this second". `suspects` ranks them by jank that
  co-occurred. That is **correlation**: a bucket is a whole second and several marks share it, so it ranks
  what to profile first, it does not name a culprit.
- **`hotspots`** are *measured* spans from `perfMonitor.measure(label, fn)` — the milliseconds are on the
  clock for that named block. Ranked by the **worst single call**, not total, because a hitch is one slow
  call and a cheap thing called 10,000 times will out-total the 58ms stall that actually dropped the frame.
  **Read hotspots before suspects.**

Currently measured: `reduce:<action>` (every run-logic dispatch — shop rolls, combat resolution, end of
turn) and `autosave` (the whole run serialized to JSON on every state change). Wrap anything else with
`perfMonitor.measure()`; it's a transparent passthrough when the monitor is off.

**If the frame is slow but no hotspot is:** the time is not in instrumented JS. Check `task` — a long frame
with `task: 0` means the main thread never blocked, so it went to style/layout/paint/decode/GC, which the
Long Tasks API does not attribute. That combination showed up at phase transitions in the 2026-07-19
captures, alongside the DOM node count roughly doubling as the shop opens.

From the console: `__perf.summary()`, `__perf.exportLog()`, `__perfHud(true)`.

Add a mark anywhere with `perfMonitor.mark('label')` — it's a no-op when the monitor is off, so call sites
don't need a guard.


## The Perf Analytics screen (reading a session after the fact)

The HUD answers *is it smooth right now*. **Perf Analytics** (dev menu → 📈) answers the four questions you
have afterwards, and is where a slowdown actually gets diagnosed.

Open it from the dev menu at any time — it reads saved recordings, so it works from the title screen as well
as mid-run. The monitor itself is still **opt-in** (`?perf=1`, `localStorage.ascent.perf`, or the dev menu):
recording is cheap but not free, and a diagnostic that runs unasked is a cost every player pays for a tool
only we use.

### What it tells you

| | |
|---|---|
| **Findings** | Plain English, worst first, each with a next step. `plateGild took 96 ms in its worst call` — not a table of percentiles you have to interpret. |
| **By phase** | Frame health split by shop / combat / End of Turn, compared by dropped frames **per second** so a long shop phase does not out-rank a short combat one on volume. |
| **Timeline** | One column per second, coloured against the budget. Click any second for what fired in it — marks, measured timings, live FX counts. |
| **vs an earlier run** | Pick any saved recording to compare against. Answers "did my change regress this?" directly. |
| **Copy report** | The whole analysis as markdown, ready to paste to Claude. |

### MEASURED vs POSSIBLE LEAD — the distinction the whole tool rests on

Every finding carries its confidence, and they are visually different on purpose:

- **MEASURED** — the milliseconds are on the clock for that named block. A culprit.
- **POSSIBLE LEAD** — it *co-occurs* with the symptom. A bucket is a whole second and several things share
  one, so this ranks what to look at; it never names a cause.

Reading a lead as a fact is how an afternoon gets spent on the wrong thing. If a lead matters, the tool tells
you how to promote it: wrap the suspect in `perfMonitor.time()` and re-record, which converts the guess into
an attribution or clears it.

### Absence is a finding too

**A low "time attributed" percentage is information, not a gap.** If almost nothing we time is slow and frames
are still dropping, the cost is in render, paint, style recalc or GC — and the screen says so, pointing at the
paint-property-in-a-loop trap from §4 rather than reporting "no hotspots" and looking clean.

### Where recordings live

IndexedDB (`ascent.perf`), on your machine, capped at 25 runs and pruned oldest-first — **not** localStorage,
whose ~5 MB budget is shared with `ascent.save`. Press **save** on the HUD to keep a recording (it prompts for
a label, e.g. "after the sheen change"); the build sha is stamped automatically so a comparison can name which
change moved the number. Nothing is uploaded anywhere.

The reasoning lives in `packages/ui/src/perfDiagnose.ts` and is unit-tested — the sampler is rAF-bound and
cannot run headlessly, which is exactly why the analysis was split out of it.

---

## 1. The two kinds of cost (and who can measure them)

| Cost | Where | Who measures |
|---|---|---|
| **Engine / logic** — `simulate()`, the reducer, the run loop, allocation/GC | pure TS, runs identically headless and in-browser | **I can, headlessly** → `npm run perf` |
| **Render / paint / animation** — CSS repaints, React reconcile, GSAP, layout thrash | browser-only (needs a real compositor + paint) | **We do together** → Chrome DevTools (§3) |

The headless harness can't see a janky box-shadow repaint, and DevTools can't easily diff a reducer
regression across 100 runs. We need both.

---

## 2. Headless harness — `npm run perf`

Times the engine + run-loop hot paths over large, deterministic workloads and prints `ms/op` for each:

- **`simulate()`** across board archetypes, including a **keyword-heavy 7v7 (Divine Shield + Windfury)** —
  the "tons of magnetics" worst case (longest, busiest fights).
- **`reduce()`** per dispatch *with a populated `lastCombat`* — the state where the
  "deep-clone the whole event log every click" regression lived. If this number jumps, the clone crept back.
- **a full greedy-bot run** end to end (combat + economy + the 1000-odds-sim `faceOmen`) — the closest proxy
  for "is a whole session snappy".

Each line has a coarse **regression tripwire** budget (~10–50× the expected value), so the harness exits
non-zero only on an *algorithmic* regression (an accidental O(n²), a megaclone), not on machine variance.

**Workflow:** the budgets are a backstop; the real signal is **comparison on the same machine**. Run it
before and after a change that touches the engine, the reducer, or anything in a render/animation loop:

```
npm run perf        # record the ms/op numbers
# … make the change …
npm run perf        # a 2×+ jump on the same machine is a real regression — investigate
```

Add a new archetype/scenario to `packages/tools/src/perf.ts` whenever a feature introduces a new hot path.

---

## 3. Render profiling in the browser (we do this together)

The harness can't catch frame drops — those come from the browser painting/compositing. When the game feels
janky (e.g. "frame dropping with tons of magnetics"), here's the routine. You drive; I read the trace and
pinpoint the fix.

**First, always test the packed/prod build, not the dev server.** `npm run dev` runs unminified through Vite
with HMR *and* React **StrictMode**, which double-invokes every render and effect. The packed zip
(`npm run package:itch`, or `npm run build:web && npm run preview -w apps/web`) is dramatically smoother and
is what players actually run. Always confirm a "slow" report against the prod build before chasing it — it's
often partly the dev overhead.

**Chrome DevTools → Performance panel** (the main tool):
1. Open DevTools (F12) → **Performance**. Set CPU throttling to **4×** to amplify jank (or leave at none for a
   true read). Click record (●), do the janky thing (e.g. run a combat with a full Mech board, or drag a card
   around), stop.
2. Read the **Frames** track: red-cornered/long frames = dropped (>16.6ms). Click one.
3. In the flame chart, look at what dominates the long frame:
   - **Purple "Paint" / "Composite Layers"** = a paint-cost problem. Usually an animated paint property
     (`box-shadow`, `filter`, `drop-shadow`, `background`, `border-radius`). **Fix:** animate `transform`/
     `opacity` instead (compositor-only), or move the effect to a static layer.
   - **Green "Rendering" / "Recalculate Style" / "Layout"** = layout thrash, often a `getBoundingClientRect`
     read interleaved with style writes in a loop/per frame. **Fix:** cache the reads (see §4).
   - **Yellow "Scripting"** with React in the stack = excessive re-render/reconcile. **Fix:** memoize, narrow
     selectors, stabilize props.

**Paint flashing** (fastest way to spot the box-shadow class of bug): DevTools → ⋮ → More tools → **Rendering**
→ tick **Paint flashing**. Green rectangles flash on every repaint. If a *resting* card flashes green every
frame, something on it is animating a paint property — that's the bug. (After the glow→opacity fix, shielded
cards should NOT flash green at rest.)

**Layers panel** (DevTools → ⋮ → More tools → Layers): shows compositor layers. `will-change`/transform
animations should each be their own layer (cheap to move). Too many layers = memory; zero layers on something
that animates = it's repainting instead of compositing.

**FPS meter:** Rendering tab → **Frame Rendering Stats** — a live FPS overlay while you play.

When you hit jank: record a Performance trace of the exact interaction, tell me what you did, and I'll read
the long frames and point at the line. The more specific the repro ("dragging the 4th card", "wave 12 combat
with 5 shielded Mechs"), the faster the pinpoint.

---

## 3b. WebGL FX: shader compiles are the hidden per-frame cost

Everything in §3 is about CSS paint and React reconcile. The Pixi FX overlay has a completely separate — and
much sharper — failure mode, discovered 2026-07-30 and worth its own section because DevTools' flame chart
attributes it to a single unlabelled `getProgramParameter` call and nothing else.

### The defect: a 160 ms freeze on every combat collision

The data-driven FX runtime (`packages/ui/src/fx/`) fires a def per combat moment. Each def LAYER used to
build its own `Shader` in its primitive's constructor and free it in `destroy()` with
`shader.destroy(true)` — `destroyPrograms = true`, which reads as scrupulous cleanup. It was a full GLSL
recompile per fire. The chain:

1. `Shader.from({ gl })` resolves its program via `GlProgram.from(src)`, memoised by raw source in Pixi's
   module-global `programCache`. Fine on its own.
2. `shader.destroy(true)` calls `glProgram.destroy()`, which **nulls that `programCache` entry**. The next
   fire misses and constructs a fresh `GlProgram`.
3. Constructing one runs Pixi's preprocessor chain, and `setProgramName` injects
   `#define SHADER_NAME pixi-program-fragment-<N>` with a globally incrementing N — so the *preprocessed*
   source, and therefore `GlProgram._key`, differs every time.
4. `GlShaderSystem._programDataHash` is keyed by `_key`, so it misses too: `createProgram` +
   `compileShader` ×2 + `linkProgram`, then a **blocking `getProgramParameter(LINK_STATUS)`** while the
   driver compiles. Measured at **68.7 ms** for the posterized-cel particle fragment.
5. Nothing evicts the abandoned `_programDataHash` entries. It was observed growing by one per fire,
   unbounded, for the whole session — a GL program leak on top of the freeze.

A collision fires `strike-impact` + `damage-burst` + `impact-dust` + `self-buff-gold` together, spanning two
distinct shader sources, so it paid ~2 × 68 ms ≈ **160 ms — a ten-frame freeze, every single collision.**

| Measurement (worst frame of a collision) | Before | After |
|---|---|---|
| 4-def collision bundle, first frame | 158–171 ms | **0.3–1.7 ms** |
| One `impact-dust` (1 burst layer) | ~68 ms | < 1 ms |
| One `strike-impact` (4 burst + 1 shockwave) | ~160 ms | < 1 ms |
| GL programs compiled over 10 collisions | 20 | **0** (3 linked once, at load) |

### The rules

- **Never pass `true` to `Shader.destroy()` for an FX shader.** Every FX shader's GLSL is a module constant.
  There is exactly one GL program per source for the life of the page, and holding it is `programCache`'s
  entire job. Freeing it is not tidiness — it discards the most expensive artifact the effect owns.
- **Pool the GPU-backed objects, don't construct-and-destroy them per fire.**
  `particleLayerPool.ts` pools `(Shader, ParticleContainer)` PAIRS for burst/emitter/smoke (they must be
  pooled together — `ParticleContainer.destroy()` destroys the shader it was built with).
  `shaderPool.ts` pools just the shader for the two mesh primitives (ribbon/shockwave), whose geometry is
  genuinely per-fire.
- **Reset pooled state on ACQUIRE, never on release**, and reset it TOTALLY — every uniform and every piece
  of container render state, not a diff, including fields no current caller touches. An early return on the
  release path silently hands out a dirty object, and the resulting bug is intermittent and load-dependent.
  Both pools take the reset as a required argument so a caller cannot forget it, and
  `particleLayerPool.test.ts` / `poolDeterminism.test.ts` assert that a recycled instance wears none of the
  previous tenant's state and is byte-identical to a fresh one for the same seed (burst, emitter and smoke).
- **Make release idempotent, and refuse destroyed objects.** A double release files the same object into the
  pool twice, after which two live effects share it and overwrite each other every frame; at cap the second
  release *destroys* something already queued for reuse. Both pools guard with a `WeakSet` keyed on the
  pooled object itself — not a flag on the wrapper, since callers hand back a fresh object literal. "Only
  one caller calls this" is not a guarantee worth resting on when effects start and stop at arbitrary
  moments.
- **A teardown that kills instances must also stop the transport.** `FxPlayer.destroy()` used to be
  `killAllLive()` alone, leaving `playing === true` — so the next `update()` respawned the layer and
  acquired a pooled pair into an already-orphaned container that nothing would ever release. Pool starvation
  by way of a missing flag.
- **Module-global pools must be cleared when the renderer goes.** `pixiFx.detach()` destroys the stage with
  `{ children: true }`, so a live effect's container dies as a descendant; the pools outlive it. `detach()`
  clears them through the `fxRuntime.ts` registry — a registry rather than a direct import, because
  importing the pool from `pixiFx.ts` would drag the primitives' ~134 kB of GLSL out of its lazily-fetched
  chunk and into the entry chunk.
- **Pre-warm the link at load.** The compile is paid once per source per session either way; the only
  question is when. `ensureDefsReady()` schedules `prewarmFxMaterials()`, which builds one shader per source
  and forces the link with `renderer.shader.bind(shader, true)` (`skipSync` resolves only the program). Note
  it has to WAIT for `pixiFx.renderer` — the primitives' dynamic import usually resolves before the overlay
  finishes `init()`, and a straight-line call there silently no-ops.

### How to re-measure this (it needs a browser, but not DevTools)

`requestAnimationFrame` is unreliable in a background or hidden tab, so drive the ticker by hand and time
each frame synchronously. Paste into the console of a DEV build:

```js
await window.__fx.ready();
await new Promise(r => setTimeout(r, 1500));          // let the pre-warm land
const app = window.__pixiFx.app, A = { source:{x:300,y:300}, target:{x:500,y:300} };
const DEFS = ['strike-impact','damage-burst','impact-dust','self-buff-gold'];
app.ticker.stop();
let clock = performance.now();
const step = () => { clock += 16.67; const t = performance.now(); app.ticker.update(clock); return performance.now() - t; };
for (let i = 0; i < 8; i++) step();                    // settle
const out = [];
for (let c = 0; c < 10; c++) {
  DEFS.forEach(id => window.__fx.play(id, A));
  const f = []; for (let i = 0; i < 75; i++) f.push(step());
  out.push(+Math.max(...f).toFixed(2));                // worst frame of this collision
}
app.ticker.start();
console.log(out, 'programs:', Object.keys(app.renderer.shader._programDataHash).length);
```

Worst-frame values should be **≈ 1 ms** and the program count must **not grow** across the ten collisions.
`window.__fx.poolSize()` reports the particle-layer pool depth (DEV only).

To attribute a suspected freeze to shader compilation specifically, wrap the GL context before firing:

```js
const gl = window.__pixiFx.app.renderer.gl, orig = gl.getProgramParameter; let ms = 0, n = 0;
gl.getProgramParameter = function (...a) { const t = performance.now(); const r = orig.apply(gl, a); ms += performance.now() - t; n++; return r; };
// … fire an effect, tick a few frames …
console.log({ n, ms }); gl.getProgramParameter = orig;
```

---

## 3c. A full-viewport canvas is a compositing layer — create it lazily

The FX overlay is now up to THREE full-viewport WebGL canvases: `.pixifx` (over the cards), `.pixifx-under`
(the dormant shield-bubble canvas) and `.pixifx-below` (the `slot: 'under'` canvas, inside `.app`). Each one
is a GL context, a compositing layer the browser has to blend every frame, and a per-frame clear-and-present
even when it draws nothing.

Two rules came out of adding the third:

- **Create it lazily, and only if something will use it.** `.pixifx-below` is built on the first
  `slot: 'under'` mount, and the pre-warm brings it up early *only* when a committed def actually declares
  that slot. A page whose defs are all `over` never pays for a second context at all. (The same reasoning
  already had `shieldApp`'s ticker stopped: an idle canvas that clears and presents an empty stage at native
  fullscreen resolution, forever, is not free.)
- **Drive extra canvases off the MAIN ticker, not their own.** `.pixifx-below` renders from a listener on
  the main app's ticker and skips the render entirely while nothing is mounted on it. One clock means the
  over and under halves of the same effect can never tear apart by a frame, and an idle under canvas costs
  one array-length read per frame rather than a full clear + present.

## 3d. Shop-phase audit, 2026-08-01 (A/B-measured)

An idle-shop audit against the 240 Hz budget, in a live lobby shop (dev build — magnitudes shift in prod, the
mechanisms don't):

- **The main FX app's ticker presents an empty full-viewport WebGL frame ~240×/s through the whole shop.**
  A/B over identical 8 s windows: ticker running → worst frame 8.5 ms, 3 frames over the 8.33 ms long
  threshold; ticker stopped → worst 4.3 ms, ZERO over. That was the entire residual idle-shop jank on the
  measuring machine. **SHIPPED same day** (`pixiFx.enableAutoIdle()` + a central `wake()`, respecting the
  Skip-combat freeze, called from all 14 audited work-adding sites incl. under-slot mounts). Verified live:
  idle shop self-stops (worst 4.3 ms, zero dropped, unassisted); every channel wakes on fire; the def system
  idles again when a burst ends.
- **The End Turn click no longer runs the 200-sim odds probe** (owner call, same day): `faceOmen` stashes
  `CombatResult.oddsInput` and the UI computes `computeCombatOdds` in idle time after the combat mounts (also
  self-healing a mid-combat resume — the input serializes with the save). ~10 ms off the click; the headless
  full-run benchmark dropped 164 → 136 ms/op. Same `TAG.ODDS` streams → identical numbers.
- The median idle frame sits AT the 4.17 ms budget (4.2 ms) — there is no headroom; anything added per-frame
  drops frames immediately.
- The charge glyph runs two rAF loops (incl. a 980×980 2D motes canvas) for the final `CHARGE_SECONDS` (20 s)
  of every turn — round 1's timer is 21 s, so effectively the whole first turn. Measured harmless on a good
  GPU (the clean ticker-off window had it running); re-check on weak hardware after the ticker fix.
- Healthy and holding: engine 0.03 ms/dispatch; view-building memoized; autosave phase-boundary-only; the
  turn clock externalized; ~450 DOM nodes in shop.

## 4. Established anti-patterns (don't reintroduce these)

These are the rules the audits surfaced; the codebase already follows them — keep it that way.

- **Never animate `box-shadow`, `filter`, `drop-shadow`, `background`, or `border-radius` in a REPEATING /
  looping animation.** They repaint every frame, so a loop repaints forever. Animate `transform`/`opacity`
  only in loops (compositor-only). For a breathing glow, put a *static* box-shadow on a `::before` layer and
  animate its **opacity** (see `.card.compact.dscard::before` + `@keyframes kwglow` in `styles.css`). A
  **one-shot** transition or non-looping animation (a single fade/pop that runs once and stops) MAY animate a
  paint property when it reads better — profile it first to confirm the single repaint is cheap.
- **Don't read layout (`getBoundingClientRect`, `elementFromPoint`) per frame**, especially after a style
  write — that forces a synchronous reflow (layout thrash). Cache rects once per drag in a ref (see
  `targetRectsRef` / `insertRectsRef` in `Recruit.tsx`).
  The legitimate alternative for event-driven visuals is **one read at spawn, then never again**: FX anchors
  (`fx/playDef.ts`) and combat floats (`choreo/channels/float.ts`) each take a single `layoutRectOf` reading
  when they fire and hold it for their whole (sub-second) life. Measured cost of a burst's worth: 8 reads is
  0.00 ms median / 0.10 ms p95. Something that must genuinely *track* a moving unit wants an attached
  primitive, not a per-frame re-read.
- **Memoize list items rendered every beat/frame.** `Unit` is `React.memo`'d with a *value* comparator (the
  combat frame rebuilds fresh objects each beat, so reference compare misses). Keep props referentially stable
  so the memo can actually skip. Better still, keep short-lived transient DOM *out* of the memoized item
  entirely: combat floats used to be children of `Unit`, which forced a per-uid bucketing `Map` (rebuilt on
  every spawn AND expiry) purely so the comparator had a stable array to compare. Moving them to a
  board-level overlay deleted the Map and stopped units re-rendering for a number at all.
- **Don't put high-frequency state (a ticking clock) in a component that renders a large tree.** The recruit
  timer's `seconds` used to live in `useState` inside `Recruit`, so it re-rendered all ~17 cards once per
  second. It now lives in an external store (`turnClock.ts`); only the tiny ring/rope subscribe to live seconds,
  while the big tree subscribes to the derived `timeUp` boolean (changes once per turn). Pattern: isolate a
  frequently-changing value into its own store/subscriber so only what *displays* it re-renders.
- **Don't fight a stacking context with a bigger z-index — find out which context you are in.** Combat
  damage numbers spent a long time buried under the Pixi FX canvas because of TWO nested traps: `.unit` is
  its own stacking context in combat (`.attacking` z8 / `.struck` z12 / `.reborn` z14), so a child's z25 only
  ordered it against its own card; and `.app` is `position: relative; z-index: 1`, a *sibling* of `.pixifx`
  (z110) under `#root`, so nothing anywhere inside `.app` can outrank the canvas at any value. Anything that
  must sit above the FX overlay has to be **portalled to `<body>`** (see the float overlay + `Card`'s hover
  reveal). Verify it, don't reason about it: make both elements hit-testable and check
  `document.elementFromPoint` at the pixel — the browser's own answer *is* paint order.
- **Don't deep-clone large read-only state.** The reducer shares `lastCombat` (the whole event log) by
  reference instead of `structuredClone`-ing it every dispatch.
- **We do NOT gate on `prefers-reduced-motion`.** ASCENT's animations carry essential gameplay info (damage
  numbers, death pops, the Fodder swirl, buff flashes), so the old global near-instant rule made the game
  unreadable for anyone with that OS setting on. Perf for low-power machines comes from being compositor-only
  (transform/opacity, no paint-property loops), not from disabling motion. If reduced-motion is ever
  revisited, calm the *motion* (lunges, perpetual loops) without suppressing the informational floats.
- **Don't construct-and-destroy GPU-backed objects per effect fire, and never free a shader's compiled GL
  program** (`Shader.destroy(true)`). Pool the shader (and, for `ParticleContainer`, the container it was
  built with), reset it totally on acquire, and pre-warm the link at load. See §3b — this cost a 160 ms
  freeze on every combat collision.
- **Don't allocate a full-viewport `<canvas>` (or any full-screen compositing layer) before the beat that
  draws on it, and don't clear one that has nothing on it.** A fixed, full-viewport canvas is a compositor
  layer the moment it is in the document, and a per-frame `clearRect`/`fillRect` over it is a couple of
  million pixels of work whether or not anything was drawn. `plateGild` built both of its canvases in its
  first line and cleared them every frame, though the motes don't start until ~260ms in and the flourish
  until ~330ms — so all of that cost landed in the ~120ms window where the gild *opens*, which is exactly
  where the owner felt it hitch. Create the layer on first draw (`needFx()` / `needFl()`), and let the
  "clear" be conditional on having painted. Measured: mean frame in the first 120ms after the buy went from
  6.48ms to 5.82ms against a 3.85ms no-gild control — a 24% cut of the gild's share. **That is a mean, and
  a mean is not a verdict** (§0): the worst frame in that window was still ~16.7 ms, 4× the 240 Hz budget.
  The fix was real; the window is not closed.
- **Never write a fixed millisecond threshold for "a slow frame".** A ms constant silently encodes an
  assumed refresh rate — `LONG_FRAME_MS = 33` is "2 frames at 60 Hz" wearing a neutral costume, and on a
  360 Hz display it only fired after eight dropped frames, so the HUD read clean while the game stuttered.
  Express the threshold in **frame intervals** and derive the milliseconds from the measured refresh
  (`refreshRate.ts`). Same rule for anything else timed against "a frame": don't hardcode 16.7.
- **Hoist `getComputedStyle` out of a loop that clones the same element repeatedly, and append clones through
  one `DocumentFragment`.** `plateGild` resolved the *same* source card's computed style once per clone (3×
  `getComputedStyle` + 72 `getPropertyValue`) and appended the three clones one at a time. One read + one
  append: synchronous setup 1.7ms → 1.3–1.5ms (medians of 31).
- **`Math.random` is banned in `core`/`content`/`sim`** (determinism + replay). Tools (`perf.ts`) may use
  `performance.now()` for timing.

When in doubt: a property that changes the *pixels* of an element is expensive to animate; a property that
only *moves or fades* an already-painted layer is cheap.
