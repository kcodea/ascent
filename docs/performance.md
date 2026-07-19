# ASCENT — performance (the north star)

**Performance is ASCENT's north star. The game must feel snappy at all times** — instant shop response, a
60fps combat replay, drag that tracks the cursor with no stutter. Snappiness is fundamental to the feel of
play; a hitch at the wrong moment reads as a bug even when the logic is correct. Treat a frame drop as a
defect, not a polish item. When a change *could* cost performance, measure it (below) before shipping.

This doc is how we keep it honest — half of it I can automate, half we do together.

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
| `med / p95 / worst` | frame times. **`worst` is the number that finds hitches** — a 500ms stall inside an otherwise smooth second is invisible in an average. |
| `long` / `jank` | frames over 33ms (dropped one) / over 50ms (a visible hitch). |
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
- **Memoize list items rendered every beat/frame.** `Unit` is `React.memo`'d with a *value* comparator (the
  combat frame rebuilds fresh objects each beat, so reference compare misses). Keep props referentially stable
  (e.g. the shared `EMPTY_FLOATS`) so the memo can actually skip.
- **Don't put high-frequency state (a ticking clock) in a component that renders a large tree.** The recruit
  timer's `seconds` used to live in `useState` inside `Recruit`, so it re-rendered all ~17 cards once per
  second. It now lives in an external store (`turnClock.ts`); only the tiny ring/rope subscribe to live seconds,
  while the big tree subscribes to the derived `timeUp` boolean (changes once per turn). Pattern: isolate a
  frequently-changing value into its own store/subscriber so only what *displays* it re-renders.
- **Don't deep-clone large read-only state.** The reducer shares `lastCombat` (the whole event log) by
  reference instead of `structuredClone`-ing it every dispatch.
- **We do NOT gate on `prefers-reduced-motion`.** ASCENT's animations carry essential gameplay info (damage
  numbers, death pops, the Fodder swirl, buff flashes), so the old global near-instant rule made the game
  unreadable for anyone with that OS setting on. Perf for low-power machines comes from being compositor-only
  (transform/opacity, no paint-property loops), not from disabling motion. If reduced-motion is ever
  revisited, calm the *motion* (lunges, perpetual loops) without suppressing the informational floats.
- **`Math.random` is banned in `core`/`content`/`sim`** (determinism + replay). Tools (`perf.ts`) may use
  `performance.now()` for timing.

When in doubt: a property that changes the *pixels* of an element is expensive to animate; a property that
only *moves or fades* an already-painted layer is cheap.
