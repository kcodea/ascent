# 2026-09-17 — Perf PR 1: instrument the pointer path and the blind spot

Measurement only. Nothing visible changes and the monitor-off path stays a single branch. This is
[`docs/perf-handoff-2026-09-17.md`](../perf-handoff-2026-09-17.md)'s **PR 1**: the two shop captures had
60–119 ms blocking tasks with **no label open** ("Mode B") and a DOM leak with a total but no address. Both
were unprovable with the monitor as it stood; this PR makes them provable so PR 2 (hover/drag state out of
the store, no layout reads in move handlers) can be judged on the same instrument.

## What the monitor records now

- **`input:<event>` spans.** Recruit's drag `pointermove` / `pointerup`, the card `pointerdown` grab, the
  hero-power aim (`move` / `up` + its rAF flush as `input:aim-flush`), the battlecry target aim (`move` /
  `pointerdown` + `input:target-flush`), and the card hover preview (`input:pointerenter` /
  `input:pointerleave` / `input:hover-preview` in `Card.tsx`) are all timed. The drag's rAF-coalesced work
  stays `drag:flushMove`. The hand make-room glide's seeding pass is `layout:handglide:seed` (next to the
  existing `layout:handglide` read). All wraps are `perfMonitor.measure(...)` around the existing body — no
  behaviour change.
- **Long-task attribution** (`PerfBucket.longTasks`). A `longtask` entry is delivered after the task ends,
  when the span stack is already empty — so "snapshot the stack" became **a ring of recently closed spans**
  (`SpanRing`, label + start + end, three stores per close) intersected against the task window. When
  nothing overlapped, the task was unlabelled, and the **input-event ring** names its trigger: one
  capture-phase, passive listener per pointer / wheel / key type writes `(type, target, event.timeStamp)` — no
  clock read, no string built; the target is described lazily (`div.card.shop[data-uid=…]`) only when a task
  asks. The report line is *"119 ms — no label open; last event: pointermove on div.card.shop[data-uid=u_42]
  3.0 ms earlier"*. Worst three tasks kept per bucket.
- **DOM nodes by container** (`PerfBucket.nodesBy`). Once a second: the shop row, the hand, the warband, the
  FX roots (`.pixifx` / `.pixifx-below`) and **everything portaled to `<body>` outside `#root`**, plus
  `other` (the remainder). Selectors live in `perfDomContainers.ts` (`PERF_DOM_CONTAINERS`) and are disjoint
  on purpose; `containerGrowth()` ranks them first→last. The `dom-growth` verdict now says *"mostly in
  shop — shop +412 (61→473), portals +305 (0→305)"*.
- **`render:recruit` by child.** `PerfProfiler` (`perfProfiler.tsx`) wraps five regions of Recruit's tree —
  `render:recruit:hud` (HudBar + ShopControls), `:shop`, `:board`, `:hand`, `:overlays`. Dev-only by
  construction (prod React compiles `Profiler` to a passthrough). Recorded with `self = 0`, so they show in
  `timings` as a breakdown and are never charged a second time in the dropped-frame attribution that
  `render:recruit` already owns.
- **`layout:read-in-move` counter.** `layoutRead.ts` wraps `getBoundingClientRect` / `offsetLeft` /
  `elementFromPoint`; each wrapper calls `perfMonitor.noteLayoutRead()`, which counts only while an `input:`
  span (or `drag:flushMove`) is open. The reads Recruit can reach from a move path are routed through it: the
  three `*IndexAt` fallbacks, `boardUidAt` / `shopUidAt`, and both aims' `minionAt`. **PR 2's acceptance is
  that this reads 0** across a shop session; the HUD row turns amber when it does not.

## Where it surfaces

- HUD → Details: `long task` (the worst this second, attributed), `layout reads in move`, `dom by container`.
- Report (📋): every worst-moment spike lists its long tasks; new sections **Unlabelled long tasks** (table:
  at / task / last event / where) and **DOM nodes by container** (+ the move-path layout-read total).
- Diagnosis: the `long-task` verdict carries the labels inside it or the triggering event; a new
  `unlabelled-long-tasks` verdict lists the blind ones and names the commonest trigger type.
- Every new label is in `perfNames.ts` (`CODE_NAMES` + `SHORT_NAMES`; `input:` and `render:recruit:` are
  also families). `perfNames.test.ts` now scans `<PerfProfiler id="…">` as well as `measure/record/begin`.

## Verified

`npm run typecheck`, `npm run lint` (0 errors), `npm run build:web` green; `npm run perf` unchanged (nothing
in core/sim touched). New tests: `perfEventRing.test.ts` (ring order, capacity, target description, the
labelled-vs-unlabelled decision), `perfDomContainers.test.ts` (growth ranking, old-recording tolerance),
`perfPointerInstrumentation.test.ts` (the verdicts and the markdown sections, end to end on synthetic
buckets). The full `npm test` run showed two import-heavy FX files hitting their 5 s timeout under load
(different files on each of two runs; both pass in isolation in 2.6 s) — machine load, not this change.

## Follow-ups (PR 2 / PR 3)

- PR 2 asserts `layout:read-in-move` = 0 and moves hover/drag state out of the store; if Mode B spikes
  persist, the `Unlabelled long tasks` table now says which handler.
- PR 3 uses the `dom by container` row to find the leak (the `portals` count is the first place to look —
  it is the only container that starts at 0).
