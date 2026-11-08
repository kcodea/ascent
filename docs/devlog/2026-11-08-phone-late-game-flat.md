# 2026-11-08 — Late-game slowdown, part 3: the phone path, early vs late (nothing grows)

Follows `2026-10-29-perf-degradation-hunt.md` and `-2.md`. Owner, top priority: "Performance degrades over the course
of a game ... massively by end game ... and it degrades even faster on mobile." Parts 1-2 were desktop only. This pass
measures the **phone path** round over round.

## How it was measured

New `perf:gauntlet --phone` flag (docs/performance.md §2b): the page is an iPhone in landscape (852 x 393 CSS px at
DPR 3, iOS UA, touch + coarse pointer + no hover, standalone). The iOS UA switches `LITE_ART` on by itself (the art
keep reported `reason: "ios"`), so the real phone code runs: downscaled art, the 48 MB decoded-art LRU, the phone
layout, phone audio. Taps and drags are real touch events. Probes also record `shownMB`, the decoded size of the
distinct pictures on screen.

Setup for every run: prod `VITE_PERF_BENCH` build, Playwright's `chrome-headless-shell` (software GL), 5x CPU
throttle, network blocked, a typical bot Practice-style lobby game (`--board none --bot --apm 40 --no-topup`), seed
424242, rounds 1-14. Each round: a probe after a full GC, then the fixed `--action-bench` inputs (hover sweep, then
3x roll / buy / play / sell, with the run snapshotted and put back). Three runs:
- **A:** `--img-census --layers` (image requests, compositor decodes, the art keep, layers).
- **B:** `--profile-re "^act-(roll|buy)#r"` (CPU profile of the same input every round).
- **C:** probes only, for `shownMB`.

Headless frame intervals are not real. The numbers below are main-thread work (CDP), in-page input latency and
counts. At 5x throttle, the ms are about 5x what this machine's CPU would take.

## Early vs late (one run each; r3 = early, r12-14 = late)

| | r3 | r4 | r12 | r13 | r14 |
|---|---|---|---|---|---|
| roll, dispatch -> next frame (ms, median of 3) (B) | 185 | 136 | 174 | 150 | 181 |
| buy, dispatch -> next frame (ms) (B) | 225 | 183 | 247 | 196 | 191 |
| sell (ms) (B) | - | - | 106 | 98 | 89 |
| idle shop, main-thread ms / frame (B) | 43.6 | 43.4 | 14.4 | 10.1 | 9.0 |
| hover sweep, ms / frame (B) | 55.5 | 75.0 | 12.7 | 10.9 | 10.3 |
| combat, ms / frame (B) | 159.8 | 78.6 | 47.4 | 34.9 | 40.4 |
| combat long animation frames / blocking ms (B) | 108 / 8,850 | 89 / 5,610 | 35 / 845 | 20 / 417 | 33 / 700 |
| image requests that missed the memory cache, per round (A) | 13 | 54 | 65 | 68 | 64 |
| compositor image decode tasks, per round (count / ms) (A) | 1,877 / 75 | 2,541 / 158 | 5,239 / 168 | 5,514 / 176 | 4,556 / 153 |
| Blink image decodes, per round (count / ms) (A) | 13 / 47 | 39 / 114 | 53 / 108 | 55 / 104 | 51 / 97 |
| art keep (LRU): held / MB / evictions so far (A) | 44 / 47 / 68 | same | same | same | same |
| distinct pictures on screen / decoded MB (C) | 43 / 20.7 | 46 / 21.9 | 73 / 29.7 | 68 / 28.1 | 71 / 28.8 |
| JS heap after GC, MB (A) | 42.8 | 43.9 | 50.0 | 50.9 | 51.4 |
| DOM nodes (A) | 1,184 | 1,342 | 1,876 | 1,880 | 1,878 |
| compositor layers / drawing Mpx (A) | 70 / 17.0 | 67 / 17.0 | 89 / 18.5 | 90 / 18.5 | 90 / 18.5 |
| canvases | 5 | 4 | 4 | 4 | 4 |

Rounds 11-14 hold the same full hand and board (nodes ~1,880, 206-207 `<img>`s), so they are the cleanest "same
screen, later round" comparison: every row is flat across them.

## What this says

**Nothing accumulates on the emulated phone.** The same input costs the same late as early, and the late rounds are
CHEAPER than rounds 1-5. Per hypothesis from part 2:

1. **The decoded-art LRU does not thrash. It never runs during play at all.** It holds 44 images (47 MB) and its
   eviction count stops at 68 before the first shop. Card, frame and board art reach a phone through the fetch-only
   background lanes, which mark a URL ready without decoding it. After that, `useArtReady` never asks the pipe to
   decode, and the on-screen `<img>` decodes the picture itself. Blink decodes stay at ~50 a round (~100 ms of
   decode-thread time at 5x) from round 9, tracking the cards on screen. The ~65 image requests a round are the lite
   path's memory cache reloading card art from the HTTP cache, by design (`imageCensusVerdict` allows 150), and flat.
2. **Render passes and layers scale with card count, then plateau.** Layers 70 -> 90 and drawing area 17 -> 18.5 Mpx
   follow the board and hand filling (Runeforge rounds briefly reach ~155 / 33 Mpx, as on desktop). Compositor decode
   tasks follow the pictures on screen (shown 43 -> 71); their time is flat (150-190 ms a round). Four canvases, three
   of them full-viewport Pixi canvases with a 1278 x 589 backing store, from round 4 on.
3. **`deriveState` grows ~4-5 KB a round** (9 KB at r3, 63 KB at r14), linear, and is only serialized by the
   idle-time autosave at phase boundaries. Not a hitch.

**Why early rounds cost more:** idle shop work is ~43 ms/frame in rounds 1-5 and ~10-15 from round 8, with no input at
all. On a phone the background art stream (fetch-only lanes) and the on-demand SFX clips are still landing through
the first rounds, at 5x throttle. This is most likely that stream; it was not profiled separately.

**What does cost on a phone:** the biggest self time in a roll or buy is `getBoundingClientRect` (forced layout):
128 -> 213 ms of a 369 -> 512 ms roll profile at r8 vs r14. It grows with DOM size (1,619 -> 1,871 nodes), not with
the round. It is a lead for a phone input-latency pass, not a degradation.

The run-A roll and buy numbers drifted up r8 -> r14 (roll 136 -> 223 ms). Run B, on the same game, did not (158 -> 181
ms, buy 208 -> 191). Read run A's drift as one-run noise.

## The guard: R-PERF-LATE-FLAT-01

Nothing grew, so there is no root cause to fix. Two cheap CI guards were added for the accumulation classes the hunts
have found or worried about:

- `packages/ui/src/lateGameAccumulation.test.ts` (jsdom, ~2 s once the store is imported). It plays one real
  14-round lobby game through the real store with the default bot: reducer, lobby, observers and replay capture are
  real, and only the uploads are mocked. Per store slice that grows with history (`deriveState`, `telemetryLog`,
  `replayActions`, `replayFrames`, `capturedBoards`), it measures JSON bytes per round. It fails if:
  - rounds 10-14 add more than 1.5x per round what rounds 5-10 added, plus 1 KB (a slice that ACCELERATES), or
  - a slice passes its absolute per-round ceiling, or
  - `run` passes 120 KB.

  Checked by mutation: making `observeAction` copy the offers list into `triggers` every turn (a per-round copy of the
  history) fails it (17.3 KB/round late vs 10.3 KB early). A milder copy (the per-round board snapshots, ~300 B
  each) still passed. It catches strong acceleration, not every slow drift.
- `imageKeep.test.ts`: the same fixed working set requested every round costs a FLAT eviction count. It is zero when
  the set fits (25 and 150 phone card copies fit 48 MB) and the same every round when it does not. The hold never
  passes its budget.

## Still needs a real iPhone

Chromium is not WebKit, and SwiftShader is not an Apple GPU. Three things can only be read on the device:
- Whether WebKit's memory-pressure handler purges on-screen decoded images late. The decoded working set here is
  ~29 MB on screen + 47 MB in the keep. The keep is title / menu / hero-select art held through the whole run, since
  the LRU never sees an in-run entry to evict it for. A purge would show as re-decode hitches with no growth in any
  count above.
- GPU cost of the three full-viewport Pixi canvases and ~90 layers on an Apple GPU.
- Thermal throttling: a phone that slows down over 15 minutes of play will feel "worse late" with no change in the work
  done per round.

Next step as before: a Safari Web Inspector timeline on an iPhone, the same roll + buy at round 3 and round 13. The
`?phonebench=1` report gives frame numbers per scene from a real device.

## Files

- `scripts/perf-gauntlet.mjs`: `--phone`, touch click / drag, `shownMB` in the probe.
- `docs/performance.md` §2b: the flag.
- `packages/ui/src/lateGameAccumulation.test.ts` (new), `packages/ui/src/imageKeep.test.ts`.
