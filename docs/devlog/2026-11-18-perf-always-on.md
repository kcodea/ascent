# 2026-11-18 — Perf: the crystal fuse stops re-evaluating its mask, and shop actions stop re-rendering the rail

Part of the 2026-11-18 perf pass (owner bar: 240 fps constant, recruit phase first). This PR is the always-on and
hot-path work with no intended visual change. Its sibling is `2026-11-18-perf-shared-reverb-static-shadows.md`.

## What changed

**The crystal fuse (R-PERF-FUSE-BURN-01).** The Gold Fuse shows for the last 21 s of every turn from the round it
first lights (round 8 for Bronze, Silver, unrated and Practice).

- The burn was a `mask` gradient on `.fuse-body` whose stops read `--burn`, written every display frame, so the whole
  fuse (a tiled background and two masked caps) repainted on every frame. It is now two transforms: `.fuse-burn`, a
  box the size of the fuse with the same gradient as a STATIC mask, slides right by `--burn` of its width, and the art
  inside slides back by the same amount.
- One walk over the particles per frame (it was three), and the debris canvas clears only the rectangle the last
  frame drew in. Each canvas gets the same blits in the same order, so the debris is unchanged.
- The burn, the sim and both canvas passes still run on EVERY display frame on desktop (phones keep about 30 a second).

### Revised 2026-11-19 (owner: "keep animations looking exactly as authored and as smooth as the display")

The first version of this PR also capped the fuse at 60 steps a second and promoted both boxes to their own layers
(`will-change: transform`). Re-measured at 240 Hz, both are gone:

- The 60/s cap bought nothing measurable in frames, and on a 240 Hz display it showed a quarter of the motion.
- The layer promotion took paint to zero but rastered the crystal at a different sub-pixel origin (up to 99 of 255 on
  its texture). Snapping the box to whole pixels did not fix it; a static art layer under a moving mask did not
  either (up to 69). Only removing `will-change` from both boxes did: the art then matches the old render to within
  2 of 255 on 0.02% of the crop. The burn then repaints a little (13 ms a second) instead of nothing.

**Shop actions and the rail (R-PERF-LOBBY-STABLE-01).** The reducer clones the run on every dispatch, so every prop
taken straight off it is a new object after every buy, sell, roll and reorder.

- `LobbyPanel` now gets the previous lobby object while a signature of everything the reducer writes in it holds
  (`stableLobby.ts`), and its `run.tribes` selector is shallow. Its memo holds across shop actions, so the eight seat
  rows stop rebuilding. A Versus display lobby is passed through as given.
- `AncientMeter`, `AncientSplit` and `AncientPill` compare the four things they read (`sameAncientRun`).
- `stabilizeRefMap` hands back the cached map when nothing changed; `tripleReadyUids` and `handPreviewViews` keep
  their identity when their contents are equal, so the shop and hand rows keep their memo.

**Small.** `discoverEntrance/entrance.ts` `cueLog` (a test hook) no longer grows in a shipped build.

## Measured

Prod bench build, Playwright driving its own HEADED Chrome (isolated profile, hardware GL on the RTX 4080, the 240 Hz
display), network blocked, 1920 x 1080. Round 10, Practice, clock at 1x, a plain seven-minion board so the fuse is
what is measured. Two 2.5 s windows idle in the burn, a 2 s trace, and 5 s of shop actions in the burn (a hover
sweep over the shop and hand, three refreshes). Frames over 4.17 ms counted with 20% vsync slack (5 ms). Each
variant ran twice, interleaved; the second round ran while two other builders loaded the machine and is noisier for
EVERY variant (base included), so the table is the first round, with the second in brackets.

| | main thread idle (ms/s) | paint (ms/s) | raster (ms/s) | idle frames over 4.17 ms | actions: frames over 4.17 ms |
|---|---|---|---|---|---|
| old (main) | 390-400 (529-566) | 52.7 (54.4) | 12.1 (48.5) | 0-0.33% (16%) | 7.7% (17.3%) |
| first version (60/s cap, layers) | 296-329 (347-418) | 0.7 (0.4) | 0.8 (0.1) | 0.33-2.1% (1.2-4.6%) | 8.5% (16.0%) |
| every frame, layers | 421-433 (568-596) | 0.3 (0.7) | 0.1 (1.1) | 0-0.17% (4.0-4.3%) | 6.4% (12.1%) |
| **shipped: every frame, no layers (art matches)** | 423-474 (616-617) | 12.7 (15.9) | 8.3 (14.9) | 0.33-0.5% (16.8-18%) | 6.9% (37%) |

Read with care: frame-drop percentages move by several points between two runs of the same build on this machine,
so none of the four is separable from old on frames. What is clear is paint: the mask re-evaluation was 53 ms a
second, and the shipped version is 13. The 60/s cap saved main-thread script (the sim stepped a quarter as often)
but did not show up in frames, and it is not worth a quarter of the motion.

The one-pass particle loop was not measured on its own (it is part of every new variant).

## Not in this PR

- **The perf monitor's frame loop, Pixi's system ticker and a slow clock for looping effects** were built and then
  parked (branch `perf/parked-frame-loops`, not for merge). The coordinator's 240 Hz measurement found stopping the
  sampler changed nothing measurable, and my own probe agrees for a keyword board: with every JS frame loop parked,
  an idle board of Rise / Execute / Flurry minions still ran a full main frame (style, pre-paint, layerize, commit)
  per display frame, 335 to 600 ms of main thread a second, and pausing the CSS animations took it to 2 ms. All 208
  running animations report as composited (`compositeFailed = 0`), yet single groups alone drive 26 to 46 main
  frames a second (`hpbcallring`, `exshard*`, `tiersevenpulse`, `rebornwisp`, `flspin`, `wardbreathe`) while others
  drive none (`exspin`, `rfbsheen`, `flbreathe`). That belongs to the keyword-loops builder. One real find from that work, for whoever picks it up: Pixi's own `Ticker.system` holds a
  `requestAnimationFrame` loop for the whole session (every renderer's scheduler adds to it), a third always-on
  loop nobody had listed.
- **The hand-hover `.app:has(...)` stacking toggle** (S4 F6) is not done. Making `.app` permanently `z-index: auto`
  lets every positioned descendant of `.app` sort against the HUD all the time, not only while a hand card is
  hovered. Proving "no visual change" needs an audit of every z-index inside `.app` against the root-level HUD
  (statusbar 40, buttons 41, top-right 60), and the combat ladder (`combatZOrder.test.ts`) sits on the same rules.
  I did not want to guess. It needs its own PR with screenshots of each overlap.
- `StatusBar` and `QuestBadges` still re-render whole on a dispatch (S1 B3). Splitting them is a larger mechanical
  change next to the combat builder's per-beat bridges.

## Verification

`npm run typecheck`, `npm run lint`, targeted Vitest (`fuseRender`, `fuseBurnCss`, `phoneFxRecovery`, `stableLobby`,
`cardViewEqual`, `ancients/AncientMeter`, the rules package), `npm run build:web`; CI `verify` runs the full suite.
