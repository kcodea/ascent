# ASCENT — performance (the north star)

**Performance is ASCENT's north star. The game must feel snappy at all times** — instant shop response, a
60fps combat replay, drag that tracks the cursor with no stutter. Snappiness is fundamental to the feel of
play; a hitch at the wrong moment reads as a bug even when the logic is correct. Treat a frame drop as a
defect, not a polish item. When a change *could* cost performance, measure it (below) before shipping.

This doc is how we keep it honest — half of it I can automate, half we do together.

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

## 4. Established anti-patterns (don't reintroduce these)

These are the rules the audits surfaced; the codebase already follows them — keep it that way.

- **Never animate `box-shadow`, `filter`, `drop-shadow`, `background`, or `border-radius` in a loop.** They
  repaint every frame. Animate `transform`/`opacity` only (compositor-only). For a breathing glow, put a
  *static* box-shadow on a `::before` layer and animate its **opacity** (see `.card.compact.dscard::before` +
  `@keyframes kwglow` in `styles.css`).
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
- **Respect `prefers-reduced-motion`.** The global rule in `styles.css` near-instants every animation; new
  looping animations are covered automatically, but don't `!important` your way around it.
- **`Math.random` is banned in `core`/`content`/`sim`** (determinism + replay). Tools (`perf.ts`) may use
  `performance.now()` for timing.

When in doubt: a property that changes the *pixels* of an element is expensive to animate; a property that
only *moves or fades* an already-painted layer is cheap.
