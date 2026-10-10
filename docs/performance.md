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

Every measured span records its **self time** — the span minus the spans it nested — so a wrapper is never
charged for what it wraps (`store:set` nests `reduce:<action>`; `fx:tick` nests `fx:sim` and `fx:render`).
`perfMonitor.begin(label)` / `end()` open a span across two callbacks (the Pixi ticker brackets); `measure()`
is the same thing with a callback. Off, every one of them is a single `running` branch. Every frame over the
long line is charged to the labels that ran inside it (`bucket.longAttrib`) — that is what the live monitor's
top-offenders list is built from.

### What is measured (2026-09-15 — the labels, and where they live)

| label | what | where |
|---|---|---|
| `reduce:<action>` / `reduce:<action>:<cardId>` | one run-logic dispatch, per card where one is named | `store.ts` |
| `store:set` | the Zustand update + every synchronous subscriber (nests the reduce) | `store.ts` |
| `autosave` | the run serialized to localStorage at a phase boundary — on idle time since 2026-09-17 (`idleWork.ts`), never inside the dispatch | `store.ts` |
| `commit:actionRing` / `commit:telemetry` / `commit:derive` / `commit:replayFrame` | the per-action commit steps inside `store:set` (the ring's hash itself runs on idle time) — `store:set`'s self time is what is left | `store.ts` |
| `view:shop` | building the tavern's card views (memoized per offer by signature — `shopViewCache.ts`) | `Recruit.tsx` |
| `render:recruit` / `render:combat` | React render + commit of the shop / combat screen (phase-aware) | `Recruit.tsx` |
| `view:board` / `view:hand` | building the card views | `Recruit.tsx` |
| `layout:flip` → `layout:flip:write` + `layout:flip:read` | the FLIP effect (`RowFlip`, in the commit where a row moves): the capture half (the offsetLeft sweep, read FIRST outside a drag; Flip.getState after the write during one) and the animation half (Flip.from / manual tweens) | `Recruit.tsx` |
| `drag:flushMove`, `layout:handglide`, `odds:deferred`, `recruit:moment cues` | drag / hand / odds / cue paths | `Recruit.tsx` |
| `input:pointermove` / `input:pointerdown` / `input:pointerup` | the raw drag, grab and aim handlers (perf PR 1, 2026-09-17) | `Recruit.tsx` |
| `input:aim-flush` / `input:target-flush` | the hero-power / battlecry aim's rAF-coalesced work | `Recruit.tsx` |
| `input:pointerenter` / `input:pointerleave` / `input:hover-preview` | the card hover-in / hover-out / referenced-card popup placement | `Card.tsx` |
| `layout:handglide:seed` | the hand make-room glide's seeding pass (the offsetLeft read + the delta writes) | `Recruit.tsx` |
| `render:recruit:hud` / `:shop` / `:board` / `:hand` / `:overlays` | `render:recruit` BY CHILD — `React.Profiler` regions, DEV only, recorded with self = 0 (a breakdown, never charged twice) | `perfProfiler.tsx`, `Recruit.tsx` |
| `fx:tick` | the whole Pixi ticker pass of the board FX layer (HIGH → UTILITY priority) | `pixiFx.ts` |
| `fx:sim` | the particle / tendril / aura / shield sim and every def player (`update`) | `pixiFx.ts` |
| `fx:render` | the Pixi render pass — batching, filter passes, the GL submit (LOW+1 → UTILITY) | `pixiFx.ts` |
| `fx:<defId>` | a def's SPAWN cost (shader link, texture upload, allocation) | `fx/playDef.ts` |
| `fx:def:<defId>` | a def's PER-FRAME cost while alive | `fx/playDef.ts` |
| `fx:weldBatch` | the weld batch | `Recruit.tsx` |
| `choreo:step` / `choreo:frame` | the five per-beat cue effects / the event-log fold into the beat's board | `useCombatReplay.ts` |
| `discover fx:…` | the Discover overlay's own controller, same brackets | `pixiFx.ts` |

Counters (levels, peak-sampled at 20 Hz): `fx:particles` (the WHOLE population — the def runtime's
ParticleContainers plus the sprite particles; the older `particles` counter is the sprite pool alone),
`fx:layers` (acquired def layers), `fx:filters` (filters applied across live `FilterStack`s), `fx:culled`
(plays the FX budget has trimmed since load — see below), `sprite pool`, `weld rings`, `spell arrows`.
Rates (per second): `unit renders`, `recruit renders`, `pointermoves`, `fx:culled` (also tallied per bucket).

**Long-task attribution and the input-event ring (perf PR 1, 2026-09-17).** Every `longtask` entry is
intersected against a ring of recently closed spans; the labels that overlapped it are recorded on the bucket
(`longTasks[].labels`). When NONE did — the 2026-09-17 "Mode B" blind spot — the bucket records the **last
DOM input event** dispatched before it (`longTasks[].lastEvent`: type, a selector-ish target such as
`div.card.shop[data-uid=…]`, and how many ms before the task it fired), from a capture-phase, passive
listener ring that costs one store per event and no clock read. The report's *Unlabelled long tasks* table
and the `long-task` verdict print it. **`layout:read-in-move`** is a per-bucket counter of layout reads
(`getBoundingClientRect` / `offsetLeft` / `elementFromPoint`, routed through `layoutRead.ts`) made while an
`input:` span or `drag:flushMove` is open — a read there is the forced-reflow-per-pointer-event pattern; it
must read 0. **`nodesBy`** is the DOM node count per container (`perfDomContainers.ts`: shop, hand, board,
FX roots, body portals, other), once a second, so the *DOM nodes by container* table can say where a leak is. (Since the responsive stage, `#root` sits inside `#stage`: the `portals` selector counts `#stage > :not(#root)`
plus body children outside both; until 2026-09-30 it matched `#stage` and counted the whole game.)

**The FX budget** (`fx/fxBudget.ts`, caps in `fx/fxBudgetConfig.ts`; added 2026-09-16 after a 2002 s capture
peaked at 5,778 live particles / 80 filters with `fx:tick` at 20.2 ms): `playDef` enforces a global
live-particle cap, a per-def concurrent-play cap and a global filter cap at SPAWN time, retiring the OLDEST
play of the same def first (then the oldest of any def) — never the one being spawned, and never a looping /
following / `onDone` play. The defaults sit above any legitimate single moment (a 7-wide fan of the heaviest
def), so under normal play `fx:culled` stays at 0; a non-zero value in a capture says a pile-up was trimmed,
and WHERE it climbed says which second. In DEV, `window.__fx.budget.set('maxParticles', n)` lowers a cap live
to watch it bite.

**The Discover scene cap** (2026-09-17): while the Discover overlay is open (`setFxScene('discover')`, wired in
`Game.tsx` off `run.discover`) the live-particle ceiling is the LOWER of `maxParticles` and
`maxParticlesDiscover` (2,000) — same oldest-first trim, same protections, so the (Both) loops on Discover cards
are never touched. Sized from a manual-ticker measurement (death-dissolve fans at 4.17 ms steps): the def sim +
render costs ≈ 0.66 µs per live particle (0.27 ms at 794 · 0.93 at 1,588 · 1.87 at 2,779 · 2.64 at 3,970,
means), so 2,000 keeps `fx:tick` near 1.3 ms and still clears the largest legitimate Discover moment
(≈ 1,860). Against the 2,673-particle Discover peak in the 2026-09-17 capture it would have retired the oldest
plays down to ≤ 2,000 — never the burst landing now. `window.__fx.budget.scene()` reads the scene in force.

**Pending load, thinning, the shop cap and the sprite cap** (2026-09-30, `docs/devlog/2026-09-30-perf-report.md`):
the owner's 33-minute capture peaked at 8,661 live particles in a SHOP second, because admission read the pool's
REAL live count, which lags a play fired this frame (nothing emitted yet), so a same-frame fan of seven plays all
passed (9,317 live from a 4,000 cap, `fx:culled` 0). Now: a play still ramping (`rampMsOf`) counts at its expected
load and is never a victim; when trimming cannot make room the incoming play is THINNED (`thinDef`: burst `count` /
emitter `rate` only, floor `MIN_PARTICLE_SCALE` 0.35, `fx:thinned` counter), never a loop or follow; the shop has
its own ceiling (`maxParticlesShop` 1,500, scene `'shop'` while `phase === 'recruit'`); and the hand-written sprite
particles are capped at `MAX_SPRITE_PARTICLES` (1,200 per controller, oldest first).

**Shared filter groups** (2026-09-30): a def layer's filters are per layer container, and every particle container
carries a huge `boundsArea`, so **every filter pass is full-screen**. A persistent effect that many units wear at
once must not carry per-play filters: pass `shareFilters` to `playDef` (`fx/sharedFilters.ts`) so all plays of the
def draw through one filter stack. The milestone badges (14 loops, 112 passes, 16-24 ms/frame) went to 4 filters
and ~2.7 ms. Only time-invariant filters can share (flat curves, same params on every layer).

**A play's lifetime ceiling** (2026-09-17): a `playDef` play used to have one backstop against a layer that
never completes — 15 s of wall clock. It is now `playLifetimeMs(def) / speed` (`fx/playLifetime.ts`): the def's
own honest end, i.e. `duration + the longest particle life`, or a layer's authored tail if longer (an emitter
emits for its own `life` window and drains for another — `cia-hp`, `spell-target`, `ruby-target` are authored to
run past their durations and are NOT cut), plus a 500 ms grace, never above the old 15 s. Note that the perf
HUD's `fx:def:<id>` **`n` is the per-frame label's call count summed over every play of that def** — the
handoff's "`dice-land` ticked 3,545 frames" was ≈25 plays × ~145 frames, not one play living 15 s.

**Every static label must be registered in `perfNames.ts`** (`CODE_NAMES`, or a family prefix in
`LABEL_FAMILIES`) — `perfNames.test.ts` scans the source and fails on an unregistered one, because the HUD
speaks in-game names and an address is what the owner asked it to stop showing.

### Warm-up: phase-start spikes are recorded apart, never in the graph

Owner report 2026-09-15: *"Performance always spikes when a game starts, which destroys the graph."* After
any **phase start** — monitor start, run start, shop open, combat start, Runeforge open (`perfWarmup.ts`,
wired in `Game.tsx`) — frames are diverted to a **startup record** until BOTH limits pass: at least 2 s of
wall clock AND at least 120 presented frames (`DEFAULT_WARMUP`; `perfMonitor.setWarmup({ ms, frames })`
persists a different rule in `ascent.perf.warmup`). Two limits, because a frame count alone ends early on a
fast panel and a time limit alone expires in a throttled tab with nothing presented.

The spike is not lost: `perfMonitor.startups()` keeps each one's worst / p95 / long / jank and the spans that
landed inside it (the shader link, the first `layout:flip`); the export, the saved recording, the report and
the analytics screen ("Phase-start spikes") all carry them. Buckets closed during a warm-up carry
`warmup: <frames diverted>`. The HUD header shows `WARM-UP · combat 1.2s` while it runs and the graph shades
the stretch. What the warm-up buys: a capture answers "how does the game PLAY", and `worst` no longer belongs
to the shop opening in every single verdict.

**If the frame is slow but no hotspot is:** the time is not in instrumented JS. Check `task` — a long frame
with `task: 0` means the main thread never blocked, so it went to style/layout/paint/decode/GC, which the
Long Tasks API does not attribute. That combination showed up at phase transitions in the 2026-07-19
captures, alongside the DOM node count roughly doubling as the shop opens.

From the console: `__perf.summary()`, `__perf.exportLog()`, `__perfHud(true)`.

Add a mark anywhere with `perfMonitor.mark('label')` — it's a no-op when the monitor is off, so call sites
don't need a guard.


## The live monitor (reading it while you play — 2026-09-15)

The HUD is a **live monitoring panel** meant to stay open through a game (dev menu 📊, `?perf=1`). Top to
bottom, and how to read each part:

- **The rolling graph** — the last 10 s at *frame* resolution. One pixel column = one time slice, drawn as the
  **worst** frame in it (§0: a dropped frame is never averaged away). The dashed white line is the per-frame
  budget (4.17 ms at 240 Hz), the dotted orange line the long-frame line; a **red tick along the top** is a
  dropped frame in that column; a **shaded** stretch is a warm-up (recorded apart, see above); the strip
  along the bottom is the phase (blue shop, red combat, purple Runeforge). The vertical scale tracks the
  worst frame in view but is clamped at 8× the jank line — a 300 ms stall is clipped and drawn with a white
  cap rather than flattening ten seconds of 6 ms frames into a floor.
- **`10 s · worst · p95 · long · jank`** and **`capture Ns`** — the same four numbers for the rolling window
  and for everything recorded (warm-ups excluded). Read them in that order.
- **Top offenders · self time in dropped frames** — THE list. Labels ranked by their self time inside the
  frames that went over the long line, with their **share** of those frames, **ms per dropped frame**, and
  their single **worst call**. `10 s` / `capture` switches the window. A label with a high share and a
  per-frame cost near the budget is a steady per-frame drain (fix the loop); a label with a low share and a
  big worst call is a stall (fix the one call). "frames dropped, but nothing instrumented ran in them" means
  the cost is render / paint / GC — go to §3.
- **The verdict** — `whatIsSlow` in one sentence: *"FX sim owned 71% of the 120 dropped frames — 3.2 ms per
  frame, worst call 9.8 ms; fx:particles peaked at 2,340 during combat; then beat cues 22% · 1.1 ms"*.
- **Scene** — the live counters (`particles · layers · filters · sprites · welds`), render rates, and the
  last startup spike.
- **Details** — calibration, longest task, the whole-session rule-based finding, heap, DOM, context, marks.

**What the HUD costs:** React renders once a second; the header numbers, the stat rows and the counters are
`textContent` writes at 4 Hz; the graph is a canvas redrawn at ≤ 30 Hz from the monitor's frame ring (4096
frames, three typed-array stores per frame, read in place); the canvas width comes from a `ResizeObserver`,
so nothing in the loop reads layout. To confirm on your machine: note `capture worst / long` over a minute
with the HUD open, close it (✕ — recording continues), play the same minute, and compare in Perf Analytics.

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
| **What is slow** | The `whatIsSlow` verdict and the top-offenders table for the whole recording (self time inside dropped frames), then the phase-start spikes the warm-up kept apart. This is the answer; the findings below are its context. |
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

### It records itself — in every build

The sampler runs **unconditionally, in dev and in the shipped production build alike** (since 2026-08-31;
`Game.tsx`). It started life dev-only, which is why the Shared tab stayed empty: the desktop exe is a
production build, so the client the two devs actually play never sampled anything. The cost is a one-second
tick and a passive pointermove counter — that IS the telemetry, and a sampler that only runs when someone
remembers to open a dev panel is not telemetry.

What the `ascent.perf` toggle (dev menu, the HUD's ✕, `?perf=1` / `?perf=0`) governs is exactly one thing:
whether the **HUD overlay is drawn**. It defaults on in dev clients and off in prod, and an explicit choice is
remembered across reloads. Recording and auto-share do not read it.

### Sharing a recording between machines

Any signed-in client **uploads one row per GAME**, automatically, when a real game ends and at least 45
seconds were recorded — so a row holds one game's whole timeline and can be compared against another game.
The row carries the mode, the hero, the build (`version+sha`), an outcome note and the full per-second
timeline.

**What counts as a real game** (`packages/ui/src/perfCaptureScope.ts`, `isRealPlayRun`):

| Run | Captured? | Why |
|---|---|---|
| **Play** — the title-screen button, an eight-seat **lobby** run | **yes** | the primary player mode; what the analytics are for |
| legacy **ascent** (the pre-lobby scored climb; also what an older save with no mode resolves to) | yes | a full scored game with the same phase mix, and still the `RunState.mode` default |
| **practice** | no | 3× shop timer and unlimited health — not the phase mix players see |
| **tutorial** | no | scripted and short |
| **rift** | no | its own ruleset |
| **Scene Builder sandbox** (a flag on top of any mode) | no | designed to hold pathological boards still; its spikes would dominate every ranking |
| no run — idling on the title | no | menu frames are not a game |
| **an abandoned game** | no | the publish fires only on the transition into `gameover` / `victory`; there is no tab-hide or unmount fallback (owner ask 2026-08-30: completed games only) |

Until 2026-09-11 the predicate admitted only `ascent`, so every Play game was recorded and then dropped at
the end — `perfCaptureScope.test.ts` now pins lobby and every exclusion.

There is also a **Share** button on the analytics screen for doing it on demand; that button and the HUD are
NOT gated by the rule above (deliberately profiling the Scene Builder is a real thing to want). All of it
lands in the **Shared** tab, which every signed-in dev can read. An upload that cannot happen — signed out is
the common case, since the insert-own policy needs a user id — is reported on the console as
`[perf] this game was recorded but NOT shared: …` rather than failing silently.

That cross-machine half is the thing a local tool structurally cannot do: Mike's refresh rate, GPU and
hardware are not Kevin's, and a spike that only reproduces on one of them is exactly the kind that survives
for months.

#### Setting it up (Supabase — one time, owner runs it)

**Until this is done nothing breaks.** Recording, the HUD and the whole local analytics screen work exactly as
they do now; the Shared tab says *"Not set up yet"* instead of erroring.

1. Open the Supabase dashboard → **SQL Editor** → **New query**.
2. Paste the `perf_runs` block from the bottom of [`schema.sql`](../schema.sql) (table + indexes + the three
   RLS policies) and **Run**.
3. Verify from a terminal — this should stop being `404`:
   ```bash
   curl -s -o /dev/null -w "%{http_code}
"      "$VITE_SUPABASE_URL/rest/v1/perf_runs?select=id&limit=1"      -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
   ```
   `404` = the table is still missing. `200` or `401` = it exists (the policies are `to authenticated`, so an
   anon key legitimately sees nothing).
4. In-game: dev menu → 📈 → **Shared**. Press **Share** on a recording and it should appear.

No Edge Function is involved, unlike `bug_reports` — a perf log is our own telemetry from our own dev
clients, so an insert-own / read-all policy pair is the right size and there is nothing to deploy.

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

**Driving a PROD bundle into a measured scene:** every FX / store console handle is DEV-only, so build with
`VITE_PERF_BENCH=1 npm run build:web` and serve with `npx vite preview --port <yours>`: `window.__bench` then holds
the store, the FX overlay and `playDef` (`packages/ui/src/perfBench.ts`; player builds never set the variable). The
2026-09-30 before/after numbers were taken this way, with `origin/main` + `perfBench.ts` as the baseline build.

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

### The crate opening's canvas (2026-09-28)

The Collection's crate theatre (`packages/ui/src/progression/crateFx/`) follows both rules: its own Application
exists only while the theatre is open (created on open, `destroy({ removeView, releaseGlobalResources })` on
close), its ticker runs only while the scene has work and stops the frame it settles, sprites are pooled
(cap 260), and the renderer resolution folds in `stageScale()`. The DEV tuner's practice crates are stripped
from production, so to profile the opening on a PROD bundle, build with `VITE_CRATE_PREVIEW=1` (it bakes the
practice-crate listener in; player builds never set it), serve with `vite preview`, and fire
`window.dispatchEvent(new CustomEvent('ascent:cratefx-play', { detail: { mode: 'legendary' } }))`.

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

## 3e. Art delivery: never show undecoded art, preload the run's set (2026-09-29)

Owner report: *"seeing a lot of pop in when i watch my friends play when they roll into a fresh shop"*. Remote
players see it worst, but it also happens on localhost (a few blank frames per session: art the old warm-up never
covered, and `no-cache` revalidation of new `<img>` elements). **Measure both**: the prod build throttled
(a bandwidth-capped, latency-adding server with Netlify's default headers; a cold fresh-profile run and a warm
second visit) AND unthrottled on `vite preview` / the dev server. The numbers and the harness are in
`docs/devlog/2026-09-29-art-pop-in.md`.

The rules:

- **Order the pipe; never fire everything at once.** A connection is one pipe. Every art URL (and the SFX bank)
  goes through ONE queue, `assetQueue.ts`, 6 in flight, in lanes: `now` (on screen) → `chrome` (title, board,
  card frames, shop buttons) → `early` (the live set's tier 1-2 cards, heroes) → `set` (the run's pinned pool,
  `poolOf(run)`) → `audio` → `idle` (cards and runes only an unplayable set owns; since 2026-09-30 decoded and
  held like the rest, behind the boot gate below). The old
  warm-up fired ~650 images plus ~430 audio fetches together in alphabetical order, so the card in the shop
  waited behind the whole bundle (6.9 s at 10 Mbps).
- **Never show an undecoded image.** A card's art, frame and hand plate use `useArtFade` (`artPreload.ts`), and
  its small chrome images, portraits and tiles use `FadeImg`: not ready = invisible over a static dark stand-in,
  then a one-shot 180 ms opacity fade. Ready art gets no class and renders exactly as before. "Ready" is checked
  twice: the URL (decoded by the pipe) AND the element (`img.complete` at commit, before paint), because a NEW
  `<img>` for an already-loaded URL can still load asynchronously: on a `no-cache` server (the Vite dev server,
  `vite preview`, Netlify before `_headers`) it revalidates first. That is the local pop-in Mike and Kevin saw
  with no network in play. A new art surface uses `FadeImg` (or `useArtFade`), not a bare `<img>`.
- **A new art family must enter the plan.** New bundled art = a glob in `art.ts` + a lane in
  `preloadPlan.ts`. New public-folder art is picked up automatically (`__PUBLIC_ART__`, derived at build time
  from the files the UI source names, `apps/web/publicArt.ts`); a first-shop public image also needs its
  pattern in `PUBLIC_CHROME_ORDER`.
- **Cache headers are part of the fix.** `apps/web/public/_headers` makes `/assets/*` (hashed)
  `immutable` for a year and `index.html` `no-cache`. Without it Netlify sends `max-age=0, must-revalidate`, so a
  returning player's browser re-asks the server about every image (722 revalidations in one measured warm
  visit) before it may use its own copy. `npm run release:web` refuses a build without it.
- **The boot splash is a LOADING GATE (2026-09-30).** Owner: *"i think id rather load everything. i dont want
  blurry images, i wanna stop pop in."* `Boot` holds the splash until everything a session on the live set can
  show is fetched AND decoded (`preloadBootArt` returns the list, `whenArtReady` waits on it), and the splash bar
  is real progress (`scaleX` on the fill, written at most once a frame, plus a count). While it is up the pipe runs
  16 wide (nothing on screen to protect); it drops back to 6 when the menu opens. Every lane now decodes and holds
  its Image (the `idle` lane used to fetch only, to save ~250 MB): the owner chose zero pop-in over that memory,
  and the cost is measured in `docs/devlog/2026-09-30-art-loading-gate.md`. A new art family MUST join
  `preloadBootArt`'s gate, or it can pop in (only the placeholder safety net stands between it and a blank frame).

## 3f. Menus and Social: lists of real cards, list reads, caches (2026-10-09)

Owner report: *"our social tab takes forever to load and is also laggy"*. Numbers and the measuring rig are in
`docs/devlog/2026-10-09-menus-social-perf.md`. The rules that came out of it:

- **Never read a fact out of a replay jsonb in a LIST read.** `replay->v2->frames->-1->>tMs` over 90 rows made Postgres
  decompress and parse every replay whole (0.6-5 s, statement timeouts). List reads select the stored generated `tp_*`
  columns (`supabase/migrations/2026-10-09-replay-facts.sql`); a new fact a list needs gets a new `tp_*` column, not a
  new JSON path. The full replay is fetched by id, one row, only on Watch.
- **A best-effort read never blocks a page's paint.** The Career paints from `run_history` and joins the telemetry
  probe behind it (`fetchMyRuns({ onHistory })`). Anything that only adds buttons or a chart line streams in.
- **Menu pages are stale-while-revalidate.** A reopen or sidebar hop paints the last answer at once
  (`socialCache.ts`, the Career's `careerLoad.ts`); one request per key in flight; an empty answer never blanks a list;
  the title prefetches on idle. Never `setRows(null)` on open.
- **A list of real `Card`s is lazy and pauses offscreen.** Each card carries looping keyword FX; 25 banners of 7 cards
  was 752 running animations and a 24 ms idle frame. Use `lazyRows.tsx` (`LazyRowsProvider` + `LazyRow`): rows mount
  near the view, one per frame, and far rows get `.is-far` (animations paused). Do NOT use `content-visibility` for
  far rows that come back: un-skipping a row of cards measured a ~290 ms frame.
- **No `getComputedStyle` on a freshly mounted page.** It forces the whole recalc the next frame would have done
  (25-46 ms on the Career open). Read after the first paint (rAF then a timeout), when styles are clean.
- **Memo list rows with stable callbacks and a memoised context value.** A context provider value built inline
  re-renders every consumer through `memo`.

## 3f. Gameplay pass, 2026-10-09/10: the GPU compositor, the style engine and three hidden full restyles

Measured on PROD bench builds (`VITE_PERF_BENCH=1`) in headful Chrome on the 240 Hz panel, driven over CDP. The full
numbers and the method are in `docs/devlog/2026-10-10-gameplay-perf-recruit.md`. What it taught:

- **Count render passes, not just main-thread time.** An idle shop can sit at 240 fps on the main thread and still
  have the GPU process 85% busy. The trace's `SkiaOutputSurfaceImplOnGpu::FinishPaintRenderPass` per frame and
  `Display::DrawAndSwap` duration are the numbers: a heavy board drew **48 render passes per frame** at idle (113 with
  every keyword on screen, which dropped the idle shop to 148 fps). Hide classes one at a time
  (`.x { display: none !important }`) and watch the pass count to find the owner.
- **A `filter`, `mask` or `mix-blend-mode` on a COMPOSITED, ANIMATING element runs on the GPU every frame.** The
  compositor re-applies it as a render pass per frame for the life of the animation. Put the static paint (gradient,
  mask, blur, opacity) on a plain, non-composited CHILD and keep only the motion on the animated element: the paint
  is rasterised once into the layer's texture and the compositor just moves it. CSS applies an element's filter,
  mask and opacity in its local space before its transform, so the picture is identical (Flurry rings, Execute
  arcs/blobs/shards and Rise wisps: 2x crops match to within 15/255). A blend mode has to stay on the moving layer.
- **Pixi's EventSystem forces a layout on every mouse move.** Every `Application` hooks a capture `pointermove` on
  `document` that reads the canvas rect, plus a ticker that dispatches a synthetic `pointermove` while the mouse is
  still. Our canvases are not interactive, so each one is detached right after `init` (`pixiNoDomEvents.ts`). A new
  Pixi Application must do the same.
- **Long `calc()` chains in plain custom properties are re-parsed per element.** `var(--ccw)` substituted the whole
  nested text (`calc(calc(calc(calc(384px * 0.75 * 1) * .75) * .752) * .85)`) into every declaration on every
  element, ~1,700 times per shop restyle. Registering the size chain with `@property` (a `<length-percentage>`
  computes once where declared and inherits as `138.07px`) took a full restyle from 20.7 to 13.5 ms. Do not register
  a variable that can hold a non-length, or that something transitions with `transition: all`.
- **Style cost per element is the recruit ceiling.** Even after that, a full restyle is ~13 ms for ~1,100 elements,
  and a play or sell restyles 300-400 of them (~25-30 us each). Deleting only the ~280 matched rules that use `var()`
  takes the full restyle to ~2 ms, so the cost is `var()` substitution in the card's own rules. The structural fix
  (card-internal geometry on container-query units instead of `var(--ccw)` maths) is a proposal, not shipped.
- **Three hidden whole-document restyles, now gone.** (1) A universal, inherited rule on a body class
  (`body.dragging * { cursor }`) restyles everything when the class flips: the cursor is now a veil element
  (`dragCursorVeil.ts`). (2) GSAP `Flip.from` writes `width` / `overflow-y` onto `<body>` and removes them again on
  every call when the body is as wide as the window (always, full screen): `withoutFlipBodyLock` (`stageFlip.ts`).
  (3) A layout read right after toggling a body class forces that restyle inside the handler: read first, toggle
  after.
- **`Flip.from` takes its expensive path on a 0.03 px difference.** Any recorded-vs-current size difference sends a
  card through `getGlobalMatrix` (temp elements + forced layouts); `snapSubpixelSizes` treats sub-half-pixel
  differences as the same box.
- **Filters link their programs on first use too.** `fx/filterPrewarm.ts` pre-links every filter kind the committed
  defs switch on, alongside the primitive warm-up (a Bloom's first play was a 97-132 ms freeze).
- **Tried and reverted:** holding the hover glow (`.cglow`) on its own layer permanently. It halved the hover
  re-raster but added ~10 render passes per frame at idle (a filtered layer costs a pass even at opacity 0).

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
- **Don't render the whole shop screen from one component's return.** `Recruit` subscribes to the whole
  `run` and holds ~40 pieces of local state; until 2026-09-16 every one of them changing (a drag decision,
  an aim target, a loss-tally tick, an overlay toggle) reconciled the ENTIRE screen — measured at
  `render:recruit` 106 ms worst in the owner's 240 Hz capture. The rows (`TavernRow` / `WarbandRow` /
  `HandRow`), the controls (`ShopControls`) and each overlay are now `React.memo` components at the bottom
  of `Recruit.tsx`, fed only the slices they render from. Keep it that way: a NEW piece of JSX in `Recruit`
  goes into the subtree it belongs to (or a new memo'd one), its handlers are `useCallback`s (or a stable
  wrapper over a ref for closures that must see the latest render — see `endTurnStable`), and a prop that
  is an object or array is memoized or derived from the view caches. Before/after in
  `docs/devlog/2026-09-16-perf-recruit-split.md`.
- **Don't put the pointer's state in the component that renders the screen.** The live drag, its drop-gap
  decision, the aim target and the zone glows lived as `Recruit` `useState` until 2026-09-17, so every slot
  crossing reconciled the shop (28 `recruit renders` per 100-move drag). They live in `dragStore.ts` now — an
  external store the rows, `DragOverlay` and `RowFlip` subscribe to by SLICE (`useDragSlice`), while `Recruit`
  subscribes to none of it. A new piece of pointer-driven state goes there, and the component that draws it
  subscribes; the drag session (`startDragSession`) publishes decisions, never `setState`. `dragSession.test.ts`
  is the source contract: the move flush reads no layout and calls no React setter.
- **Pass `simple: true` to `Flip.from` / `Flip.to`, not only to `Flip.getState`.** The animation call builds its
  own "to" state; without the flag GSAP resolves a global matrix per element by appending a temp node and
  reading it — a forced layout per card, ~9 ms per slot crossing on a 13-card shop. Only the Choose One
  coalesce (`absolute: true`, cross-container) keeps the full path.
- **Read before you write inside a layout effect, and skip the write when nothing moved.** The FLIP's
  offsetLeft sweep used to follow the tween seeds (a third forced layout per drop); read on the flush React's
  commit already dirtied, then write, and a commit that moved no card (a roll) touches no style at all.
- **Don't read layout in a no-deps `useLayoutEffect`.** An effect with no dependency array runs on EVERY
  commit, and an `offsetLeft` / `getBoundingClientRect` read after that commit's style writes is a forced
  layout every time — the `layout:handglide` cache was 39.8 ms in one of the owner's worst frames for a
  value that only changes when the hand's order/count, the grant previews or compact mode change. Key such
  a read on the thing that can move the elements (plus `resize` when the viewport can), never on "every
  render".
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
- **Never render art before it is decoded, and never warm art all at once.** A card that paints before its image
  is decoded shows a blank (or white) window and then snaps: that is the pop-in friends saw on the Netlify build.
  Route art through the asset queue (`requestArt` / `preloadPlan.ts`), render it with `useArtFade` / `FadeImg`,
  and keep `_headers` shipping. See §3e.
- **Never hit-test with `elementFromPoint` inside a pointer handler.** A hit test is a layout read. Measure the
  candidates once per gesture and hit-test numbers (`targetRectsRef` / `insertRectsRef` for drags, `aimRectCache.ts`
  for aims, which re-measures on a timer and on resize, outside any `input:` span). `layout:read-in-move` must read 0.
- **Don't give a many-instance persistent effect per-play filters.** Each filter is a full-screen render-to-texture
  pass per play per draining loop cycle (see the shared filter groups in the FX budget section).
- **A frame that spans a hidden tab is not a frame.** rAF stops in the background, so the first interval back is the
  whole absence; the warm-up reports it as `hiddenMs` rather than `worst`. Read a startup's `hiddenMs` before
  chasing a multi-second "phase-start spike".
- **`Math.random` is banned in `core`/`content`/`sim`** (determinism + replay). Tools (`perf.ts`) may use
  `performance.now()` for timing.

- **Never put a `filter` / `mask` on an element that animates a transform or opacity, or on its composited
  parent.** It becomes a GPU render pass every frame. Static paint goes on a non-composited child (§3f).
- **Never toggle a universal or inherited rule on `<body>` / `:root` in a hot path** (`body.x * {…}`, a body cursor,
  a root custom property). Each flip restyles the whole document (~13 ms). Scope the rule to the elements it
  styles, or carry it on a dedicated element (the drag cursor veil).
- **Detach Pixi's DOM events on every new `Application`** (`detachPixiDomEvents`), and wrap new `Flip.from` /
  `Flip.to` calls in `withoutFlipBodyLock`.

When in doubt: a property that changes the *pixels* of an element is expensive to animate; a property that
only *moves or fades* an already-painted layer is cheap.
