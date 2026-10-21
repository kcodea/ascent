# 2026-10-21: Desktop jank pass, whole-page restyles, boot warm-up, read-then-write

Owner report (2026-10-18, relayed): a ranked game on the 240 Hz desktop "felt terribly laggy/janky". Standing bar:
over 160 fps (6.25 ms frames) at all times, ideally 240 (4.17 ms). Branch `perf/desktop-jank`. Nothing looks
different: every change is speed only. Look-changing ideas are listed at the end, not shipped.

## What shipped

1. **Aiming no longer restyles the page (R-PERF-AIM-CURSOR-01).** `body.aiming, body.aiming * { cursor: none }` restyled
   every element when an aim started and again when it ended (11-19 ms each on a heavy shop). `aimCursorHide.ts` puts
   an inline `cursor: none` on the element under the pointer only (and on each element it enters while aiming).
   `body.aiming` stays as a plain flag for `touchInput.ts`.
2. **The frosted plate rule no longer restyles the whole document (R-PERF-HAS-SUBJECT-01).** From #2173,
   `.cardref:has(.plate-frosted) .cardref-inner > :not(.card)` had a featureless subject, so every `:has()` change on
   `.app` or `<body>` (nearly every commit: buy, sell, play, roll, hover, combat entry) restyled 700-1,000 elements
   (5-21 ms). It now names `.kwdefs`, the only non-card child a reveal has. `featureSubjects.test.ts` fails on any
   `:has()` rule with a featureless subject.
3. **Touch-only `:has()` rules live in a touch media query (R-PERF-TOUCH-HAS-01).** `html[data-touch-ui] #stage:has(...)`
   is matched right to left, so a mouse device still evaluated the `:has()` half. Inside
   `@media (hover: none) and (pointer: coarse)` (exactly `isTouchDevice()`, which `data-touch-ui` requires) desktop
   never sees them; phones match exactly as before.
4. **Board FLIP reads every card, then writes (R-PERF-FLIP-BATCH-01).** One GSAP tween over the array of moved cards
   instead of a tween per card (GSAP reads a target's computed transform when a tween initialises, so per-card tweens
   interleaved a read after each write). Same values, ease, duration and clearProps.
5. **Desktop boot warm-up (R-PERF-BOOT-WARM-01, R-PERF-PIXI-KEEPALIVE-01).** On desktop the boot splash now waits
   (capped at 4 s) for the board FX shader links, the Discover / screen-wipe / ranked-gate Pixi layers and the
   board-strength reference chunk, so none of them land on the title or mid-game. The ranked gate layer is kept for
   the session on desktop (one WebGL context, idle with its ticker stopped) so neither gate of a game builds one.
   Phones and iPads (`LITE_ART` / `PHONE_GPU`) keep #2166's lazy path: short gate, layers built on demand, gate layer
   freed after each gate. The splash also only ends on its OWN opacity transition (a child's `transitionend` used to
   cut it).
6. **Lobby rail floats and knockouts measure every row first (R-PERF-LOBBY-FLOAT-01).** One read pass, then one write
   pass, instead of read, append, read (63 ms in one frame of a shop open in a CPU profile).
7. **Labels:** `run:start` (building the lobby run on hero pick) and `lobby:warm-seat` (one seat's driver on idle)
   now show by name in the perf monitor instead of as anonymous long tasks.

## Measured (prod bench build, headless Chrome, uncapped frames, 1920x1080)

Before = origin/main fc21ffcbc, after = this branch on top of it. Five full 15-round games per build, interleaved.
The machine was shared with other sessions (test suites, other headless browsers): mean CPU per game was ~33% for
pair 2, 56-76% for pairs 1 and 3, and 97-100% for pairs 4 and 5. Each pair ran back to back, so it saw similar load.

**Whole game, frames over budget (sum of the per-round medians of 5 games):**

| | main | branch | change |
|---|---|---|---|
| Recruit, frames over 6.25 ms | 2,285 | 1,400 | -39% |
| Recruit, frames over 4.17 ms | 3,878 | 2,728 | -30% |
| Combat, frames over 6.25 ms | 2,568 | 2,111 | -18% |
| Combat, frames over 4.17 ms | 5,130 | 4,738 | -8% |
| Shop open, frames over 6.25 ms | 316 | 274 | -13% |

Per game, recruit frames over 6.25 ms (main / branch, pair by pair): 2115/1806, 1189/874, 1657/1097, 3301/1534,
2982/2577: the branch is lower in all five pairs. Combat: 2331/2017, 1199/1119, 2178/1991, 3246/2249, 2990/2741: lower
in all five. Shop open: 295/252, 192/145, 275/258, 419/305, 394/435 (four of five).

The lightly loaded pair alone (pair 2, ~33% CPU): recruit 1,189 -> 874, combat 1,199 -> 1,119, shop open 192 -> 145.
Median per-action p95 / p99 sit at 1-3 ms on both builds (the budget is lost to spikes, not to the typical frame).

**Per round (median of 5 games, main / branch):**

| round | recruit >6.25 | recruit >4.17 | combat >6.25 | combat >4.17 | shop open >6.25 | recruit worst ms | combat worst ms |
|---|---|---|---|---|---|---|---|
| 1 | 22 / 29 | 39 / 39 | 17 / 26 | 34 / 45 | 9 / 12 | 17.2 / 26.6 | 51.1 / 75.7 |
| 2 | 8 / 9 | 17 / 20 | 13 / 17 | 34 / 45 | 7 / 8 | 13.3 / 13.7 | 16.9 / 20.2 |
| 3 | 22 / 27 | 51 / 39 | 23 / 48 | 57 / 94 | 8 / 10 | 17.4 / 21.9 | 17.7 / 21.5 |
| 4 | 14 / 13 | 29 / 23 | 26 / 57 | 68 / 98 | 8 / 8 | 17.7 / 19.5 | 16.7 / 17.7 |
| 5 | 59 / 42 | 102 / 78 | 80 / 60 | 154 / 104 | 16 / 15 | 33.8 / 51 | 19.7 / 20.1 |
| 6 | 174 / 116 | 227 / 235 | 226 / 194 | 406 / 372 | 24 / 21 | 77.1 / 92.4 | 23.3 / 36.8 |
| 7 | 135 / 71 | 173 / 132 | 240 / 233 | 468 / 532 | 23 / 18 | 35.1 / 31.1 | 35.4 / 29.5 |
| 8 | 114 / 56 | 151 / 109 | 180 / 127 | 349 / 187 | 27 / 22 | 34.3 / 28.9 | 35.6 / 48.1 |
| 9 | 237 / 86 | 381 / 154 | 186 / 136 | 401 / 300 | 23 / 17 | 55.5 / 31.5 | 36.2 / 28.2 |
| 10 | 287 / 178 | 612 / 435 | 300 / 239 | 594 / 487 | 30 / 24 | 68.9 / 47.6 | 39.7 / 29.8 |
| 11 | 273 / 144 | 508 / 293 | 247 / 148 | 458 / 327 | 29 / 26 | 70 / 52.6 | 37.6 / 41.6 |
| 12 | 211 / 146 | 339 / 268 | 345 / 313 | 663 / 625 | 33 / 29 | 69.2 / 53.2 | 42 / 87 |
| 13 | 271 / 219 | 525 / 398 | 222 / 160 | 461 / 455 | 28 / 18 | 66.7 / 52.8 | 48.3 / 35 |
| 14 | 243 / 129 | 389 / 257 | 273 / 204 | 517 / 554 | 30 / 23 | 76 / 47.2 | 49.8 / 36.7 |
| 15 | 215 / 135 | 335 / 248 | 190 / 149 | 466 / 513 | 21 / 23 | 69.6 / 36.3 | 51.4 / 89 |

Rounds 1-4 combat read worse on the branch only in the three heaviest-loaded pairs; in pairs 1 and 2 the branch is
equal or lower (round 1 combat over 6.25 ms: 15/12 and 17/11). Single worst frames swing with the load and are not a
reliable before/after here.

**Targeted scenarios (3 reps each, median [range], heavy God-mode shop unless noted):**

| scenario | main >6.25 | branch >6.25 | main worst | branch worst |
|---|---|---|---|---|
| Aim: 10 hero-power arm / disarm | 108 [64-129] | 44 [40-46] | 35.7 ms | 16.4 ms |
| Buy, sell, play, roll x2 | 54 [30-82] | 20 [20-21] | 32.4 ms | 25.8 ms |
| Combat entry (3 s from End Turn) | 3 [3-5] | 1 [1-1] | 24.8 ms | 13.8 ms |
| Back to shop (2.5 s) | 16 [15-16] | 11 [10-12] | 51.0 ms | 45.9 ms |
| Hover sweep | 25 [23-34] | 19 [13-25] | 21.5 ms | 17.7 ms |
| Title, first 3 s after the splash fades | 13 [12-20] | 0 [0-0] | 83.1 ms | 5.8 ms |
| Hero pick, next 6 s | 9 | 10 | 34.2 ms | 30.8 ms |

The title's warm-up now happens behind the opaque splash (10 frames over 6.25 ms there, worst 110 ms, invisible),
and the splash fades about 0.9 s later (median nav-to-fade 5.8 s vs 4.8 s).

## Investigated, not changed

- **The round-9 shop-open trace.** Its 76-110 ms `EvaluateScript` task was the measuring harness itself: a DevTools
  `Runtime.evaluate` (the trace parent is a `blink.mojom.DevToolsSession` message) computing the previous window's
  stats inside the shop-open window. With the harness fixed, the real shop-open costs are the React commit of the
  remounted shop (about 35 ms of script plus one forced style and layout, below) and compositor commit waits.
- **React commit at shop start (42-72 ms late game).** About 35 ms of script and a 12 ms forced layout in the
  tavern rect sweep (`Recruit.tsx`, the layout effect after the remount). The read only moves the first layout of the
  freshly mounted shop earlier; it does not add one. Making the commit smaller means splitting the mount, which is a
  bigger change than this pass. Left as a lead.
- **Game-over task (133 ms).** Most of it was the end-of-game gate building its WebGL context; that is gone on desktop
  (item 5). Not re-measured in a ranked game end in this pass (Practice games never close a gate).
- **Round-1 long tasks over `.hcslot` / the ranked gate.** In the branch's round-1 trace the only main-thread task
  over 15 ms is one 20.7 ms commit; the remaining round-1 combat spikes are `LayerTreeHost::WaitForCommitCompletion`
  (GPU raster/upload), not script.
- **Runeforge pick (round 6): 90-230 ms on both builds.** The biggest single remaining recruit-phase stall in the
  scripted game. It is real app work (reducer + commit), next to look at.

## Look-changing proposals (NOT in this PR)

Measured on the branch build as a CSS override (3 reps each), with before/after crops in the session scratchpad
(`out/crops/*-before.png` / `*-after.png`). Each needs an owner look before anything ships.

1. **Hover preview without its filter / shadow.** The inspect popup's drop-shadow filters. Hover sweep: frames over
   6.25 ms 25/17/25 -> 20/16/17, worst 24.7 -> 9.7 ms. The biggest of the three. A static baked shadow image behind
   the popup could keep most of the look.
2. **Card frame shadow baked into the frame art.** Removing the runtime frame drop-shadow did not measurably help
   buy/sell/play/roll (19/25/0 -> 30/16/0, worst 21.5 -> 46 ms; noise). Not worth an art change on this evidence.
3. **Drag without the 3D tilt.** No difference (0-1 frames over budget either way, worst ~6 ms). Drop it.

## Method notes

- The harness (scratchpad, not in the repo) drives a Practice game, Unlimited health, seed 424242, hero Warden, 15
  rounds: hover sweep, drag buy, dispatch buys, sell, drag play, roll, board reorder drag, freeze, End Turn, the full
  combat, back to the shop. Frames are rAF intervals with vsync off, so "frames over 6.25 ms" counts every frame that
  would miss a 160 Hz deadline.
- **A CDP `Runtime.evaluate` shows in a trace as `EvaluateScript`** with no URL and no Long Animation Frame script
  attribution. Check the parent task (`Receive mojo message`, `blink.mojom.DevToolsSession`) before blaming the page.
- The machine was shared with other sessions running test suites and their own headless browsers, so most runs saw
  heavy CPU load. Builds were interleaved (main, branch, main, ...) so each pair saw similar load; the load is
  reported per run.
