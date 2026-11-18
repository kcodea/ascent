# 2026-11-18 — Perf: the crystal fuse stops repainting, and shop actions stop re-rendering the rail

Part of the 2026-11-18 perf pass (owner bar: 240 fps constant, recruit phase first). This PR is the always-on and
hot-path work with no intended visual change. Its sibling is `2026-11-18-perf-shared-reverb-static-shadows.md`.

## What changed

**The crystal fuse (R-PERF-FUSE-BURN-01).** The Gold Fuse shows for the last 21 s of every turn from the round it
first lights (round 8 for Bronze, Silver, unrated and Practice).

- The burn was a `mask` gradient on `.fuse-body` whose stops read `--burn`, written every display frame, so the whole
  fuse (a tiled background and two masked caps) repainted on every frame. It is now two transforms: `.fuse-burn`, a
  box the size of the fuse with the same gradient as a STATIC mask, slides right by `--burn` of its width, and the art
  inside slides back by the same amount. A burn write repaints nothing.
- The burn write, the debris sim and both canvas passes step 60 times a second on desktop whatever the display runs
  at (phones keep about 30). `cappedRaf.ts` sleeps on a timer through the display frames it skips, so they do not
  each force a main frame.
- One walk over the particles per step (it was three), and the debris canvas clears only the rectangle the last step
  drew in.

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

Prod bench build, Playwright driving its own Chrome with a throwaway profile (headless, hardware GL on the RTX 4080),
network blocked, 1920 x 1080. Round 10, Practice with the clock at 1x. The machine was shared with other measuring
agents, so treat single numbers as plus or minus 15% and read the ratios.

Fuse, burn window, frames unthrottled (stands in for a fast display):

| | before | after |
|---|---|---|
| fuse loop | 474 calls/s, 225 ms/s | 60 steps/s (82 wake-ups), 38 ms/s |
| Paint events | 696 /s, 87.5 ms/s | 2 /s, 0.6 ms/s |
| Raster tasks | 102 ms/s | 9 ms/s |
| GPU tasks | 467 ms/s | 91 ms/s |
| main thread | 865 to 880 ms/s | 614 to 625 ms/s |

What is left of the main thread in that window is not the fuse: it is the board's CSS loops running a main frame per
display frame (see "Not in this PR").

Per step the loop costs about what it did: 0.47 to 0.59 ms before, 0.46 to 0.63 ms after, at roughly 350 live
particles. That is NOT the "well under 0.5 ms" the brief asked for. The step is bound by one `drawImage` per particle
on a 2D canvas; typed arrays for the sim would not move it (the sim is the small part), so I left the sim's objects
alone. Getting the step itself down means drawing the debris in WebGL (one draw call), which is a bigger change.

I have no clean per-action number for the memo fixes: my refresh loop was rejected by the shop half the time in both
builds. The tests pin the identities (a deep clone of the lobby keeps its signature; every reducer write moves it).

## Look check

Three burn positions, canvases hidden, every CSS animation frozen at the same time in both builds:

- The burn front, the soft edge and the burnt / unburnt split land in the same place.
- The crystal art is NOT pixel-identical: it differs by a sub-pixel resample (max channel difference 80 to 98 of 255
  on the crystal's texture, mean 0.5 to 2.2 over the crop). The art now lives on its own layer and is rastered at a
  slightly different sub-pixel origin. It is static: the unburnt art is bit-identical between burn positions in the
  new build, so nothing shimmers as the fuse burns. Side-by-side crops look the same to my eye; the owner should
  glance at it once.

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

`npm run typecheck`, `npm run lint`, targeted Vitest (`cappedRaf`, `fuseRender`, `fuseBurnCss`, `stableLobby`,
`cardViewEqual`, `ancients/AncientMeter`, the rules package), `npm run build:web`; CI `verify` runs the full suite.
