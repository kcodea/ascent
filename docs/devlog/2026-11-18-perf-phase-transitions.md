# 2026-11-18 — Phase transitions: the pictures that were decoded again every round

Owner bar (2026-11-18, top priority): over 240 fps (frames of 4.17 ms or less) at all times, with no hitching,
especially around the recruit phase. The morning's measurement pass (`.claude/perf-scope-2026-11-18/E1-measurements.md`,
cause 3) found a per-round constant at every phase change: large pictures decoded again with the main thread blocked
behind them. It did not say WHICH pictures. Branch `perf/phase-decode`. Rule: R-PERF-PHASE-ART-HELD-01.

## Which pictures were being decoded again

Found with a DevTools trace of the prod build (categories `devtools.timeline` +
`disabled-by-default-devtools.timeline`): each `Decode LazyPixelRef` event is matched to the `PaintImage` event that
names its URL, and `performance.mark()` calls put the End Turn press, the phase flips and the end of the replay on the
same clock.

| when | picture | size | decode | how often |
|---|---|---|---|---|
| **Fight end** (the replay finishes) | `vista-sky.webp`, `vista-far.webp`, `vista-mid.webp`, `vista-shop.webp`, `vista-fore.webp` | 2560 x 1440 each (14.1 MB decoded each) | 25 to 73 ms EACH, all five in the same frame | every fight, every round |
| **End Turn** (the scene swaps under the gate) | `playingboard-combat.webp` | 3840 x 2143 (31.4 MB) | 45 to 111 ms | some rounds (3 of 8 traced) |
| | `playingboard-combat-shadow.webp` | 1920 x 1072 | 8 to 18 ms | with the board |
| | `transition-gate.webp` | 2455 x 1381 | 15 ms | some rounds (the morning's run) |
| | `frames/end_button_gem_cracked.webp` | 1196 x 1312, drawn 74 x 80 | 18 ms | some rounds |
| **Shop open** | the new Shop's card art (5 to 7 pictures) | 512 x 512 | 3 to 5 ms each | every round (first time each card is drawn: not a re-decode) |
| Not a phase change (seen in the same traces) | `frames/taunt-*.webp`, `frames/oval-*.webp` (card frames) | 1086 x 1448, drawn about 152 x 202 | 11 to 54 ms each | whenever one falls out of the cache, mid turn or mid fight |

**Why.** The compositor draws from its own decode cache, which has a budget. The game's full-screen pictures are a lot
to hold in it (backdrop 31.6 MB, two boards 31.4 MB each, shadows, gate 12.9 MB, five vista layers 70.5 MB), and
whichever set is not on screen is what it drops: the vista during the Shop and the fight, the combat
board during a long turn. Holding the `HTMLImageElement` (the old preload) does not help, because `img.decode()` fills
the same cache. The fight-end "warm-up" (2026-10-25) then made it a certainty: it played the whole return trip
invisibly the moment the replay ended, which decoded all five layers in one frame while the fight's last hits were
still on screen. The main thread waited on the commit for the longest of them.

## What changed

1. **The return trip's five layers are held canvases** (`heldArt.ts`, `Recruit.tsx` `VISTA_HELD`, `.wipevista-layer.canvased`).
   Each picture is decoded once off the main thread (`createImageBitmap`), drawn into a canvas on an idle slot, and the
   canvas is kept for the session (a new run re-parents the same canvases). A canvas owns its pixels: the compositor
   shows it as a texture, with nothing to decode or raster however long it was hidden. Desktop only: a phone keeps its
   one flattened 1280 px CSS picture and its warm-up.
2. **The fight-end warm-up no longer plays on desktop.** There is nothing left to decode, and the invisible play was
   itself the hitch. The door's two small CSS pictures are asked for off the main thread instead (`decodeAhead.ts`
   `warmVistaDoorArt`).
3. **The door's three pieces keep what they drew through the dive** (`will-change: opacity, transform` on
   `.wipevista-doorfill`, `-doordark`, `-doorglow`). The stage zooms 18x; without the hint the compositor re-rastered
   them at the zoomed size in the dive's first frames.
4. **End Turn asks for the gate and the combat board early** (`decodeAhead.ts` `warmEndTurnArt`): on hover of the End
   Turn button, on the press, and as the gate starts to fall. `img.decode()` runs the decode on a worker without
   holding a frame; the swap under the gate is at least 0.5 s later.

5. **The combat z-ladder switches under the gate, not at the press** (`.app.combat.staged`, and the hero bar's two
   `body:has(.app.combat.staged)` rules). `.app.combat { z-index: auto }` dissolved the app's stacking context the moment
   the phase flipped, while the Shop was still on screen behind the falling gate. That repaints and re-rasters every
   layer of the Shop, in the frame the press lands, for a scene replaced half a second later. Units only exist while
   the scene is staged (`combatUnitsShown = inCombat && combatBgShown`), so the ladder is only needed there, and it now
   lands with the swap itself. During the gate's 0.5 s fall the Shop keeps its own layering, exactly as it looked a
   moment earlier.

Nothing looks different. One judgement call: change 3 means the doorway's interior and glow are scaled from what was
drawn at 1x during the dive instead of being redrawn at up to 8x. The pictures are 201 and 413 px wide, the interior
is under a 78% dark veil and fades out within 0.3 s, so there is no detail to lose; flag it if the dive reads softer.

## How it was measured

Production bench bundles (`VITE_PERF_BENCH=1`) of `origin/main` at `8e23550c9` and of the branch, served from disk on
127.0.0.1:5253, driven in the installed Chrome (headless, its own throwaway profile, hardware GL: ANGLE on the RTX 4080
SUPER, 240 Hz frame clock, 1920 x 1080, every request off 127.0.0.1 blocked) by a copy of the morning's harness
(`scripts/perf-scope-e1.mjs` in the `perf-scope-e1` worktree) with: `performance.mark()` on the End Turn press, every
phase flip and the end of the replay; one continuous trace per measured round; a 1.5 s wait between the end of the
replay and the End Combat press (a real player does not press within 60 ms, and without it the fight-end and shop-open
windows overlap); and a retry when headless Chrome fails to start.

The game is the morning's "strong" one: a lobby (bot table, the pool is offline), Nadja, the Ale engine board, 60 shop
actions a turn with Gold topped up, Ancient of Bonds at round 4, rounds 2 to 14 measured.

Three windows per round, from the page's own `requestAnimationFrame` timestamps:

- **End Turn**: 0.25 s before the press to 1.75 s after it (the press, the gate's fall, the swap under the gate).
- **Fight end**: 0.25 s before the replay finishes to 1.25 s after (where the old warm-up played).
- **Shop open**: 0.1 s before the End Combat press to 1.75 s after the phase flips back (the vista's arrival, the Shop
  mounting under its hold, the dive).

**Noise.** Other builders were working on this machine the whole time. Two sets of runs were taken. Set A ran with
the machine busy but not saturated (74% CPU when sampled); set B ran with it pinned at 100% (sampled every 30 s: their
test suites and builds, and for part of set B my own lint and test run). So compare within a set, never across. One game per run: a single worst frame is
noise, the medians and per-round means over 13 rounds are what carry the claim, and the trace numbers (decodes, GPU
raster sums) do not depend on a quiet machine.

## Decodes and GPU raster (traces)

Image decodes inside each window, and the GPU main thread's raster time in it.

| | main | branch |
|---|---|---|
| Fight end, round 3 | 7 decodes, 221 ms: `vista-fore` 48, `vista-mid` 53, `vista-sky` 25, `vista-far` 53, `vista-shop` 38 | 2 decodes, 3 ms (the door's two small pictures) |
| Fight end, round 8 | the five layers again, 297 ms: `vista-far` 73, `vista-mid` 68, `vista-fore` 67, `vista-shop` 54, `vista-sky` 36 | 2 decodes, 3 ms |
| Fight end, round 13 | 7 decodes, 237 ms: `vista-fore` 51, `vista-mid` 59, `vista-sky` 26, `vista-far` 56, `vista-shop` 39 | 0 decodes |
| End Turn, rounds where the combat board had been dropped | `playingboard-combat` 45 to 92 ms + its shadow 8 to 16 ms (the morning's two traces and two of mine), at the swap under the gate, with the frame waiting on them | the same decodes (70 to 111 ms + 10 to 18 ms) start on HOVER of End Turn and are done before the press; the swap frame keeps the upload (11 to 16 ms) and the raster |
| Shop open, rounds 3 / 8 / 13 | 5 to 7 decodes of 3 to 5 ms (the new Shop's card art); GPU raster worst task 55 to 63 ms (the dive starting) | the same 5 to 7 card decodes; GPU raster worst task 14 to 26 ms |
| GPU raster in the 250 ms after the phase flips to combat | 39 to 85 ms, worst task 11 to 29 ms (main, and the branch before change 5) | 19 to 26 ms, worst task 4 to 11 ms (with change 5) |

The return trip's five layers are not decoded at all on the branch, in any round of any run.

## Frames

Each cell of the first table: longest frame in the window; then the count of frames over 16.7 / 33 / 50 ms.

### Set A (machine busy, not saturated). The branch here has changes 1 to 4 (not the z-ladder change)

| transition | round | main, run 1 | main, run 2 | branch (changes 1-4) |
|---|---|---|---|---|
| End Turn | 3 | 33 ms; 2 / 1 / 0 | 88 ms; 5 / 3 / 1 | 50 ms; 4 / 2 / 0 |
| End Turn | 8 | 50 ms; 4 / 2 / 0 | 58 ms; 6 / 1 / 1 | 46 ms; 2 / 1 / 0 |
| End Turn | 13 | 75 ms; 5 / 4 / 2 | 83 ms; 6 / 4 / 2 | 96 ms; 4 / 4 / 2 |
| Fight end | 3 | 58 ms; 5 / 2 / 1 | 33 ms; 3 / 1 / 0 | 17 ms; 1 / 0 / 0 |
| Fight end | 8 | 108 ms; 8 / 3 / 2 | 50 ms; 4 / 2 / 0 | 17 ms; 0 / 0 / 0 |
| Fight end | 13 | 58 ms; 5 / 3 / 2 | 33 ms; 4 / 1 / 0 | 21 ms; 3 / 0 / 0 |
| Shop open | 3 | 96 ms; 5 / 3 / 1 | 100 ms; 5 / 3 / 2 | 50 ms; 5 / 3 / 0 |
| Shop open | 8 | 146 ms; 13 / 9 / 6 | 79 ms; 7 / 4 / 3 | 54 ms; 6 / 3 / 2 |
| Shop open | 13 | 100 ms; 6 / 5 / 3 | 88 ms; 5 / 4 / 3 | 75 ms; 7 / 4 / 2 |

| transition (rounds 2-14 pooled) | main, run 1 | main, run 2 | branch (changes 1-4) |
|---|---|---|---|
| End Turn: longest frame, median of rounds (worst round) | 75 ms (175) | 71 ms (208) | 67 ms (96) |
| End Turn: frames over 16.7 / 33 / 50 ms, mean per round | 5.0 / 3.3 / 1.23 | 5.5 / 3.4 / 1.54 | 4.3 / 2.7 / 0.92 |
| End Turn: frames over 6.25 ms, mean per round | 21.3 | 26.7 | 18.9 |
| Fight end: longest frame, median of rounds (worst round) | 58 ms (108) | 50 ms (83) | 17 ms (21) |
| Fight end: frames over 16.7 / 33 / 50 ms, mean per round | 6.0 / 2.0 / 0.77 | 4.3 / 1.6 / 0.85 | 0.7 / 0.0 / 0.00 |
| Fight end: frames over 6.25 ms, mean per round | 33.2 | 25.5 | 13.5 |
| Shop open: longest frame, median of rounds (worst round) | 100 ms (146) | 88 ms (100) | 58 ms (83) |
| Shop open: frames over 16.7 / 33 / 50 ms, mean per round | 8.9 / 5.1 / 2.77 | 6.3 / 3.8 / 2.69 | 5.1 / 2.8 / 1.15 |
| Shop open: frames over 6.25 ms, mean per round | 26.2 | 19.0 | 16.7 |

End Turn press to the first frame after the phase flip (median, rounds with no End-of-Turn beats): main 78 and 95 ms,
branch 73 ms.

### Set B (machine at 100% CPU). The branch here has changes 1 to 5

| transition | round | main, run 3 | branch, run 1 | branch, run 2 |
|---|---|---|---|---|
| End Turn | 3 | 117 ms; 6 / 2 / 1 | 71 ms; 4 / 4 / 1 | 75 ms; 4 / 1 / 1 |
| End Turn | 8 | 71 ms; 9 / 3 / 1 | 75 ms; 7 / 3 / 1 | 25 ms; 5 / 0 / 0 |
| End Turn | 13 | 123 ms; 6 / 4 / 2 | 79 ms; 5 / 3 / 2 | 54 ms; 6 / 4 / 1 |
| Fight end | 3 | 33 ms; 6 / 1 / 0 | 21 ms; 1 / 0 / 0 | 33 ms; 3 / 1 / 0 |
| Fight end | 8 | 38 ms; 3 / 1 / 0 | 17 ms; 1 / 0 / 0 | 21 ms; 1 / 0 / 0 |
| Fight end | 13 | 229 ms; 9 / 2 / 1 | 25 ms; 1 / 0 / 0 | 33 ms; 5 / 1 / 0 |
| Shop open | 3 | 125 ms; 10 / 5 / 4 | 92 ms; 7 / 4 / 2 | 54 ms; 6 / 4 / 1 |
| Shop open | 8 | 88 ms; 8 / 3 / 3 | 108 ms; 7 / 4 / 2 | 63 ms; 6 / 5 / 3 |
| Shop open | 13 | 90 ms; 10 / 5 / 4 | 83 ms; 4 / 4 / 2 | 83 ms; 7 / 6 / 1 |

| transition (rounds 2-14 pooled) | main, run 3 | branch, run 1 | branch, run 2 |
|---|---|---|---|
| End Turn: longest frame, median of rounds (worst round) | 79 ms (150) | 75 ms (175) | 46 ms (83) |
| End Turn: frames over 16.7 / 33 / 50 ms, mean per round | 7.0 / 3.7 / 1.85 | 6.8 / 3.2 / 1.54 | 5.0 / 2.0 / 0.38 |
| End Turn: frames over 6.25 ms, mean per round | 29.9 | 28.7 | 28.2 |
| Fight end: longest frame, median of rounds (worst round) | 50 ms (429) | 21 ms (92) | 25 ms (279) |
| Fight end: frames over 16.7 / 33 / 50 ms, mean per round | 4.8 / 1.5 / 0.77 | 2.2 / 0.4 / 0.15 | 1.8 / 0.2 / 0.08 |
| Fight end: frames over 6.25 ms, mean per round | 26.9 | 25.1 | 26.2 |
| Shop open: longest frame, median of rounds (worst round) | 104 ms (125) | 83 ms (125) | 75 ms (88) |
| Shop open: frames over 16.7 / 33 / 50 ms, mean per round | 8.1 / 4.6 / 3.38 | 7.1 / 4.2 / 2.31 | 6.8 / 4.2 / 1.77 |
| Shop open: frames over 6.25 ms, mean per round | 30.0 | 27.1 | 28.5 |

End Turn press to the first frame after the phase flip (median, rounds with no End-of-Turn beats): main 88 ms, branch
103 and 85 ms.

### The same windows split into their separate hitches (longest frame, median of rounds 2 to 14)

| hitch | main (set A, 2 runs) | branch 1-4 (set A) | main (set B) | branch 1-5 (set B, 2 runs) |
|---|---|---|---|---|
| End Turn: the frame the phase flips (the press, or the end of the End-of-Turn beats) | 50 / 54 ms | 46 ms | 62 ms | 29 / 29 ms |
| End Turn: the swap under the fallen gate | 75 / 63 ms | 67 ms | 67 ms | 75 / 46 ms |
| Shop open: the End Combat press and the vista arriving | 17 / 17 ms | 13 ms | 17 ms | 13 / 13 ms |
| Shop open: the Shop mounting under the vista's hold | 75 / 71 ms | 58 ms | 75 ms | 83 / 75 ms |
| Shop open: the dive starting | 96 / 88 ms | 33 ms | 100 ms | 38 / 37 ms |

Reading it:

- **Fight end is fixed.** Longest frame 50 to 58 ms down to 17 to 25 ms (median of rounds); frames over 33 ms from
  1.5 to 2.0 a round down to 0.0 to 0.4; no round of set A's branch run has a fight-end frame over 21 ms. What is left
  in that window is the fight's own last frames.
- **The dive no longer stalls as it starts**: 88 to 100 ms down to 33 to 38 ms. That was the five layers and the door
  being drawn again at the zoomed size.
- **The frame the phase flips to combat**: 50 to 62 ms down to 29 ms, from the z-ladder change alone (set B; set A's
  branch did not have it and sits at 46).
- **Not fixed: the two scene swaps.** The combat scene mounting under the gate (about 45 to 75 ms) and the Shop
  mounting under the vista's hold (about 60 to 80 ms) are the same on both builds. See below.
- **End Turn latency** (press to the first frame after the flip, rounds with no End-of-Turn beats): 73 to 103 ms on
  both builds, inside the noise. About 30 to 50 ms of that is the harness's own gap between pointer down and up. The
  press handler itself is 12 to 40 ms: about 5 ms of engine at round 3 (the reducer and `simulate`), the rest the
  React commit.

## Memory held

The five canvases are sized to the drawn picture, never bigger than the file: 5 x 1920 x 1080 x 4 = **41.5 MB** of GPU
memory in a 1920 x 1080 window, **70.3 MB** (the files' own 2560 x 1440) in a 2560 x 1440 or larger one, held for the
session. In exchange the compositor's own cache no longer holds those five (the same 70 MB whenever they were decoded),
so this is close to neutral while they are in use and a real hold while they are not. `heldArtStats()` reports it.
Phones are unchanged: no canvases, their one 1280 px picture, their bounded picture cache.

## What is left, measured

1. **The two scene swaps are still 45 to 80 ms frames.** Each is a few hundred fresh elements. At the gate: a style
   recalc of 10 to 18 ms over 520 to 910 elements, the commit, then 18 to 35 ms of GPU raster. At the Shop: one task
   of 40 to 50 ms (a forced style recalc of about 600 elements for the warband's Cards, 5 ms of reducer, the commit, a
   second forced recalc of about 300 for the new Shop) and 13 to 19 ms of raster. Both sit under a full-screen cover
   whose own motion runs on the compositor, so they are the least visible hitches of the three, but they are over
   budget. Cutting them is the Card mount cost and the per-element style cost, which the `perf/combat-render` and
   `perf/card-raster` branches are working on. Not attempted here: splitting the Shop's mount across frames. The two
   commits are already separate; putting a frame between them is a small timer in the `coveredOut` effect, but it only
   halves one frame and it touches the resolve path.
2. **The combat board is still a 31.4 MB CSS picture.** When it has been dropped, the swap under the gate still pays
   its upload and raster (a 58 to 71 ms frame instead of 33 to 50). The durable fix is to stop drawing it at all: the
   combat board differs from the Shop board in one 1276 x 280 px region (the tray, top right) and its shadow in one of
   276 x 188 px, so the combat layer could paint only that patch over the Shop board that is already on screen. That
   is an art-export change (`npm run board:export`), not done here. Keeping the hidden layer alive with `opacity: 0`
   instead of `display: none` was tried and does not hold: the compositor drops a non-drawn layer's tiles too.
3. **The dive's first frames still raster about 10 ms each for about 100 ms** (33 to 38 ms worst frame). Most likely
   the sky title's text being redrawn as it scales. Giving it `will-change: transform` would soften the letters, so it
   was left alone.
4. **The press frame's React commit** (10 to 22 ms) and the reducer inside the press (about 5 ms) were not moved. The
   replay frame clone and the round's IndexedDB write are small next to the commit, and deferring the clone is unsafe
   as written: the reducer keeps mutating the same `lastCombat` object.

## Leads for other work (seen in these traces, not fixed here)

- **Card frames are 1086 x 1448 files drawn about 152 x 202** (`frames/taunt-*.webp`, `frames/oval-*.webp`, about 40 files
  of about 6 MB decoded each). Whenever one falls out of the compositor's cache it costs an 11 to 54 ms decode mid turn
  or mid fight (`taunt-beast` 54 ms during a round-8 fight). Right-sized copies would cut that 4 to 8 times.
- **Hovering a hand card dissolves `.app`'s stacking context too** (`body:not(.dragging) .app:has(.row.hand
  .card:hover) { z-index: auto }`, and `body.modalup .app`). The same switch at End Turn cost 20 to 30 ms of GPU raster
  and a 50 ms frame. Not measured for the hover, but it is the same mechanism, in the recruit phase.
- **Raising Chrome's discardable GPU memory limit does not stop the drops.** With
  `--force-gpu-mem-discardable-limit-mb=1024` on the main build the vista was still decoded again at fight end and the
  combat board at the swap. So an Electron switch is not a shortcut here, and which of the compositor's budgets drops
  these pictures is not established: what is measured is that they are dropped.

## Verification

`heldArt.test.ts` (canvas sizing, the vista's five held layers, the desktop warm-up skip, the door's hint, the End
Turn decode-ahead set and its three call sites, no layout read on the mount path) and `combatZOrder.test.ts` (the
ladder switches with `.staged`, never at the press). The transitions were also captured as screenshots on both builds
(the gate's fall and hold, the vista's arrival, hold and dive) and compared by eye.

One late addition is NOT in the measured builds: the pressed End Turn gem (`frames/end_button_gem_cracked.webp`,
1196 x 1312 drawn about 74 px wide, an 18 to 21 ms decode in the press frame in two of the traced rounds) was added to
the End Turn decode-ahead set after the last measured build.
