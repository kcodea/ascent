# 2026-09-15 — Perf live monitor: warm-up, FX attribution, top offenders, the verdict

**Owner ask:** *"our performance HUD and analytics are not functioning well. Take a deep pass at improving
them so there is a LIVE MONITORING screen. Performance always spikes when a game starts, which destroys the
graph — delay the capture slightly so the initial spike doesn't wreck it. We're seeing very poor performance
and are currently BLIND to what's causing it."*

## What was wrong (the audit)

- The HUD's sparkline was one bar per *second* (the bucket's worst) — no frame-resolution view, no rolling
  window, and the whole panel re-rendered through React each second for everything.
- No warm-up: the boot / shop-open / combat-start spike landed in the same buckets as play and owned `worst`
  in every verdict, so every finding was "the shop opening was slow".
- `packages/ui/src/fx/` had **zero** `perfMonitor` calls. `fx:<id>` timed only the spawn; the particle sim,
  the Pixi render pass, filter passes and each def's per-frame cost were invisible — which is exactly where the
  2026-09-11 captures put ~98% of combat frame cost (correlated with particle count, r≈0.84).
- Hotspots ranked by the single worst call; nested spans double-counted (no self time). There was no way to
  ask "who owned the frames that dropped".
- `render:recruit` covered combat too (same component). `PerfScreen` is modal, so it cannot be left open.
- `perfNames.test.ts` did not actually enforce label registration.

## What shipped (one PR, four commits + fixes)

1. **Warm-up** (`perfWarmup.ts`, `perfMonitor.beginWarmup`): after a phase start (monitor start, run start,
   shop open, combat start, Runeforge open) frames are diverted to a **startup record** until *both* 2 s and
   120 frames have passed (`setWarmup` persists a different rule). Startups keep their own worst/p95/long/jank
   and spans; the export, saved runs, the report and the analytics screen carry them. Buckets closed during a
   warm-up carry `warmup: n`.
2. **Attribution** — new labels, all registered (`perfNames.test.ts` now scans the source): `fx:tick` /
   `fx:sim` / `fx:render` as open-span brackets by ticker priority; `fx:def:<id>` per frame; `fx:particles` /
   `fx:layers` / `fx:filters` counters (the def runtime's ParticleContainers, which the old `particles` counter
   never saw); `choreo:step` + `choreo:frame`; `render:combat`; `unit renders`; `layout:flip:write` /
   `layout:flip:read`; `store:set`. The monitor now records **self time** per span (a wrapper is not charged
   for what it wraps) and charges every long frame to the labels that ran inside it (`bucket.longAttrib`).
   Off-path cost stays one branch; no closure is allocated on the FX per-frame paths (`begin`/`end`).
3. **The live monitor** (`PerfHud.tsx` + `perfLive.ts`): a 10 s frame-resolution graph from a 4096-frame ring
   (worst per pixel column, budget + long lines, dropped-frame ticks, warm-up shading, phase strip); window +
   capture `worst · p95 · long · jank`; **top offenders** by self time in dropped frames (share, ms per dropped
   frame, worst call) for the window or the capture; a counter strip; the details folded below. React renders
   1 Hz; numbers are `textContent` writes at 4 Hz; the canvas redraws at ≤ 30 Hz; canvas width via
   `ResizeObserver` (no layout reads in the loop).
4. **The verdict** (`perfDiagnose.whatIsSlow`): *"FX sim owned 71% of the 120 dropped frames — 3.2 ms per
   frame, worst call 9.8 ms; fx:particles peaked at 2,340 during combat; then beat cues 22% · 1.1 ms"* — on the
   HUD, in a new "What is slow" section on Perf Analytics (verdict + offenders table + phase-start spikes),
   and at the top of the markdown report.

## Lessons

- **A child's effects run before the parent's.** The HUD is a child of `Game`, whose effect starts the
  monitor; a `perfMonitor.isRunning` guard in the HUD's loop saw a stopped monitor at mount and froze the
  panel at "– fps". The loop is now unconditional while the panel is open.
- **A StrictMode start/stop/start produced a 0-frame "startup" record** at the top of every dev session;
  `closeWarmup` skips a warm-up that saw no frames.
- **The desktop preview pane throttles `requestAnimationFrame` to ~0 while hidden**, so the pipeline could be
  verified end to end there (labels, offenders, verdict, warm-ups all flowed through a Practice combat) but the
  millisecond numbers from that session are meaningless (1000 ms "frames"). The real top-offenders list has
  to come from the owner's display — see the PR.

## Follow-ups (found by the instrument, not fixed here — scope discipline)

- `layout:flip` — split now says which half; the 2026-09-11 number (7.3 ms mean, 98% during drags) still
  stands. Next: cache the `offsetLeft` sweep per drag, and skip `Flip.getState` for a row that cannot move.
- The FX layer's per-frame cost: with `fx:sim` / `fx:render` / `fx:def:<id>` and `fx:particles` now on the
  same graph, the next capture on the owner's 360 Hz panel should name the def(s) and whether the cost is the
  sim (CPU particle loop) or the render (filter passes). Cap / pool accordingly.
- The Discover controller's spans (`discover fx:…`) are registered as a family but not named individually.
