# Perf handoff — Shop-phase frame drops (2026-09-17)

Two captures from the in-game perf monitor (PR #1508, merged 2026-09-15), same session, 153 s and 238 s,
240 Hz display, 4.17 ms budget. This is what they say, what is proven vs suspected, and the three PRs that
follow from it. Read `docs/performance.md` §0 first — judge on the **worst frame**, never the mean.

## The numbers

| | 153 s capture | 238 s capture |
|---|---|---|
| median fps | 238 | 229 |
| worst frame | 100 ms (24×) | **133 ms (32×)** |
| frames > 8.3 ms / > 12.5 ms | 584 / 178 | 1761 / 631 |
| longest blocking task | 96 ms | **119 ms** |
| time attributed to instrumented code | 3% | 7% |
| DOM nodes, start → end | 100 → 959 | 100 → 1027 |
| `fx:particles` peak | 691 | 2673 (Discover) |

Warm-up worked: the 1.7 s load spike and the 92 ms run-start spike are quarantined and not in any figure above.

## Every catastrophic frame is in the Shop, during pointer movement

| at | frame | blocking task | pointermoves/s | recruit renders/s | what was measured |
|---|---|---|---|---|---|
| 446 s | 133 ms | 106 ms | 158 | 30 | `render:recruit` 15.8, `store:set` 6.9, `layout:flip` 6.4, `reduce:buy:dw_orin` 1.7 |
| 431 s | 121 ms | 119 ms | 178 | 0 | **nothing** |
| 219 s | 100 ms | 96 ms | 5 | 0 | **nothing** |
| 255 s | 96 ms | 83 ms | 48 | 2 | `render:recruit` 1.3 |
| 252 s | 67 ms | 61 ms | 67 | 30 | `render:recruit` 24, `store:set` 19, `layout:flip` 10.5, `reduce:buy:sp_gamble` 2.3 |
| 214 s | 58 ms | 51 ms | 165 | 12 | `store:set` 14, `render:recruit` 13.5, `layout:flip` 9.6 |
| 209 s | 62 ms | 59 ms | 140 | 0 | **nothing** |

Pointermoves average 138/s in janky seconds vs 36/s in clean ones (3.8×). Two distinct failure modes:

**Mode A — the measured chain (446, 252, 214).** One shop action → `store:set` (6–19 ms) → `render:recruit`
(13–24 ms) → `layout:flip` (6–10 ms), all synchronous in one frame. The reducer itself is ~2 ms; what runs
*after* the reducer is 25× more expensive. "recruit renders 30" in one second means the entire Recruit
screen re-rendered 30 times — hover/drag state is in the Zustand store and every pointermove re-renders
the shop.

**Mode B — the unlabelled task (431, 219, 209).** A 60–119 ms synchronous task with **no label open**: no
reducer, no store set, no React commit, no FLIP. It happens while pointermoves are high and recruit renders
are zero. With ~1,000 DOM nodes the likely shape is a hover/drag handler that **reads layout**
(`getBoundingClientRect` / `offsetLeft`) after something wrote style — a forced synchronous reflow of the
whole shop per pointer event. CLAUDE.md's `insertRectsRef` rule ("cache layout once per drag") exists for
exactly this; something bypasses it, or a hover class toggle invalidates layout and the next read pays.
*This is the strongest lead and it is unproven — PR 1 exists to prove it.*

## Secondary findings

- **`store:set` at 5–7 ms average, 19 ms worst** (192 calls). A Zustand set should be microseconds. Every
  subscriber is doing real work inside the set: suspects are the autosave/serialize path and Recruit's
  `shopView` map (the ~40-argument view object rebuilt for every offer on every render; `Recruit.tsx` ~3194).
- **`render:recruit` averages 2.9 ms** (928 calls, 2.7 s total) — over half the budget every time it fires,
  before anything else in the frame.
- **Discover FX is heavy enough to break the budget alone.** `fx:tick` worst 22 ms, `fx:render` worst 21 ms,
  particles peaked at 2,673, and "discover sprite pool runs 19× higher in janky seconds". Outside Discover the
  FX layer is 0.2 ms/frame and is NOT the problem — its 59–83% "share of dropped frames" is because it runs
  every frame, not because it costs anything.
- **DOM leak.** 100 → 1,027 nodes, growing with time not actions. Something transient mounts and never
  unmounts — number floats, hand-buff `react` layers, Discover portals, FX DOM wrappers.
- **FX outliving their defs.** `fx:def:dice-land` ticked 3,545 frames (~15 s) and `spell-sparks` 5,643
  against 900 ms defs. Cheap per frame, but the same "not cleaned up" smell as the DOM growth; likely a layer
  whose particle `life` outlives the def `duration` and the player keeps the def alive until the last particle dies.

## The three PRs

### PR 1 — instrument the pointer path and the blind spot (do first; cheap; makes PR 2 provable)
- Wrap `pointermove` / `pointerenter` / `pointerleave` / drag-move handlers in Recruit as `input:<event>`;
  wrap the hover-preview and hand-glide paths (`layout:handglide` already exists — good model).
- On every `longtask` PerformanceObserver entry, snapshot the **label stack**; if it is empty, record the
  **last DOM event type dispatched** (a 1-line `document.addEventListener(type, …, {capture:true})` ring for
  pointer/keyboard/wheel). An unlabelled spike then names its trigger in the report.
- Per-second DOM-node delta **by container** (`.shop`, `.hand`, `.board`, FX root, portals root) so the leak
  names itself.
- `React.Profiler` on the Recruit subtree so `render:recruit` breaks down by child (`Unit`, hand, shop row).
- Register every label in `perfNames.ts` (the names test scans source). Measurement only; the off path stays a
  single branch.
- Files: `packages/ui/src/perfMonitor.ts`, `perfNames.ts`, `perfReport.ts`/`perfDiagnose.ts` (report the
  event attribution), `Recruit.tsx` (wrap handlers).

### PR 2 — hover/drag state out of the store; no layout reads in move handlers (the bet)
- Transient pointer state (hovered card, drag position, insertion index) → refs + CSS class toggles, or a
  separate tiny store the individual card subscribes to. A pointermove must never re-render `Recruit`.
- Cache rects once per drag start (extend `insertRectsRef`); assert in dev that no `getBoundingClientRect`
  runs inside a move handler (a `perfMonitor` counter `layout:read-in-move` that must read 0).
- `store:set` back to microseconds: autosave/serialize off the frame (`requestIdleCallback` / debounced), and
  memoize `shopView` per offer by `(uid, version)` instead of rebuilding the Map every render.
- `layout:flip`: skip the read/write passes when no card changed position (the flip runs 426× in 238 s).
- Acceptance: re-record the same session; Mode A spikes gone (no frame > 12.5 ms on a buy), "recruit renders"
  per second ≤ actions per second, `store:set` worst < 1 ms. If Mode B spikes persist, PR 1's event
  attribution says which handler and the fix moves there.

### PR 3 — Discover FX budget, FX lifetime, DOM leak (independent; parallel)
- Cap particles per Discover play (2,673 → a budget derived from `fx:tick` staying < 2 ms) — tune the defs
  the Discover uses, do not change their look; the owner retunes in the workbench if the cap is visible.
- Kill a def's runtime at `duration` (or `duration + max particle life`, whichever the owner wants) — find why
  `dice-land` / `spell-sparks` tick for 6–15 s.
- Find and fix the DOM leak using PR 1's per-container delta (or a MutationObserver locally): floats, hand-buff
  `react` layers, portals, FX wrappers. Acceptance: node count flat across a 4-minute run.

## Not yet done (needs a human at the machine)
One Chrome DevTools performance profile of a Mode B spike (docs/performance.md §3). Look for a long purple
*Recalculate Style* / *Layout* bar inside the 119 ms task — if it is there, it is layout thrash from the pointer
path, not JS, and PR 2's "no layout reads in move handlers" is the whole fix.

## Session log
- 2026-09-15: perf monitor + warm-up + attribution + live screen shipped (#1508).
- 2026-09-16/17: two captures analysed (this doc). No code changed for the findings yet.
- 2026-09-17: **PR 1 built** (`perf/instrument-pointer`) — `input:<event>` spans on the drag / aim / grab /
  hover paths, long-task attribution (labels inside it, or the last input event via a capture-phase ring —
  `PerfBucket.longTasks`), DOM nodes by container (`nodesBy`, `PERF_DOM_CONTAINERS`), `render:recruit` by
  child (`PerfProfiler`, dev only), and the `layout:read-in-move` counter (`layoutRead.ts`). Report gains
  "Unlabelled long tasks" + "DOM nodes by container". See `docs/devlog/2026-09-17-perf-pointer-instrumentation.md`.
- 2026-09-17 (PR 3, `perf/fx-lifetime`): Discover scene cap `maxParticlesDiscover: 2000` (would have
  trimmed the 2,673 peak to ≤ 2,000, oldest plays first; measured ≈ 0.66 µs per live particle per tick);
  play lifetime ceiling = the def's honest end (`fx/playLifetime.ts`) instead of a flat 15 s — the
  `dice-land` 3,545 / `spell-sparks` 5,643 figures were `PerfSpan.n` summed over ~25–30 plays each, not one
  play living 15 s; the DOM "leak" did NOT reproduce across two 4-minute scripted shop sessions (rest-state
  node count flat 384 → 388) — 100 → 1,027 reads as title screen → populated shop, not a leak. Details in
  `docs/devlog/2026-09-17-perf-fx-lifetime-dom-leak.md`.
