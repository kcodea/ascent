# 2026-10-22: iPhone crash starting a game, round four (stage layers in hero select and the run)

Owner, 2026-10-22, after #2151, #2158, #2160, #2163 and #2166: "I still can't even play it because of the crashing".
The page dies at Play / hero pick (iOS kills the WebContent process, no error, no Web Inspector). Rule:
R-TOUCH-RUN-MEMORY-01.

## Measured

New `npm run perf:phone-run` (`scripts/phone-run-memory.mjs`): a production build in headless Chrome as an iPhone in
landscape (852 x 393 @3x, iOS UA, touch, coarse pointer, standalone), real taps, walking title, Play, the Play tile,
the tutorial nudge, Yes, the gate's crystal, hero select, a hero pick, Start Game, the first shop, then (`--interact`)
a touch-drag buy and play, End Turn, the gate and the first fight. Every request off 127.0.0.1 is blocked, so the
opponent pool never loads: the script takes "Play anyway" (bot seats) and the launch curtain sits on "Finding
opponents" for a few seconds first (`start +2.5s`). At each step it records:

- the iOS LAYER model (as `perf:phone-menus`): every composited non-canvas layer at its own size x 3 x 3 x 4 bytes,
  clipped to the screen. WebKit pays a layer inside a transformed stage at its full stage size; one full-screen layer
  is about 87 MB.
- live WebGL contexts and their drawing buffers, plus every texture uploaded into them (texImage2D / texStorage2D,
  minus deleteTexture)
- decoded images: every <img>, every CSS background / border image on a rendered element and its pseudo-elements, and
  every Image the page `decode()`d that is still alive (the preloader's hold), w x h x 4, de-duped by URL
- decoded AudioBuffers, 2D canvases, ImageBitmaps, the JS heap, and the OS memory of the Chrome processes

"iOS est" = layers + WebGL buffers + textures + decoded images + audio + 2D canvases. Same run, main 348d94192 vs this
branch (MB):

| step | main: iOS est (layers / GL buffers / images / audio) | branch, games kept on the transform (`gamexf`) | branch (default) |
|---|---|---|---|
| title | 71 (24 / 0 / 47 / 0) | 71 | 71 (24 / 0 / 47 / 0) |
| Play pressed | 110 (26 / 0 / 47 / 37) | 110 | 110 (26 / 0 / 47 / 37) |
| tutorial nudge skipped | 130 (39 / 0 / 54 / 37) | 130 | 130 (39 / 0 / 54 / 37) |
| Yes: the ranked gate | **442** (344 / 12 / 62 / 24) | 442 | 143 (44 / 12 / 62 / 24) |
| gate crystal tapped | 377 (279 / 12 / 62 / 24) | 377 | 134 (36 / 12 / 62 / 24) |
| hero select | 272 (185 / 6 / 56 / 24) | 272 | 110 (23 / 6 / 56 / 24) |
| hero picked +1 s (ceremony) | 455 (362 / 12 / 56 / 24) | 414 | 134 (41 / 12 / 56 / 24) |
| hero picked +4 s | 478 (385 / 12 / 56 / 24) | 435 | 143 (50 / 12 / 56 / 24) |
| Start Game +0.7 s (launch curtain) | 568 (475 / 12 / 56 / 24) | 281 | 116 (24 / 12 / 56 / 24) |
| Start Game +2.5 s (waiting on the pool) | **651** (559 / 12 / 56 / 24) | 278 | 116 (23 / 12 / 56 / 24) |
| first shop | 553 (395 / 29 / 98 / 28) | 446 | 198 (38 / 29 / 97 / 28) |
| after a buy + play | 559 (400 / 29 / 98 / 27) | | 198 (40 / 29 / 97 / 28) |
| End Turn, gate down | 543 (385 / 29 / 99 / 27) | | 204 (48 / 29 / 97 / 28) |
| first fight | 525 (367 / 29 / 99 / 28) | | 227 (62 / 29 / 97 / 29) |
| **peak** | **651** | 442 | **227** |

The JS heap (55-83 MB), decoded images (47-99 MB), decoded audio (at most 37 MB, the #2163 phone bank), WebGL buffers
(6 live contexts, 29 MB at 1278 x 590 each, #2166) and textures (1-10 MB) barely move between builds and are not what
spikes. The layers are. At the worst moment on main five full-stage layers were up at once: `#stage` itself, the hero
select, the ceremony scrim, the launch curtain and the pool-wait panel (plus the ceremony glow 42 MB, flash 21 MB, the
two remaining hero cards 14 MB each). The shop then held the PARKED falling gate (87 MB) and its poster (26 MB) through
every shop and every fight.

The layer list is Chrome's standing in for WebKit's, and Chrome squashes overlapping layers: a full-stage squash layer
that it names after its first element (`.version`, `.rulesbtn`) shows up in some runs and not others, so a
transform-mode row moves by about one 87 MB layer between identical runs (the `gamexf` shop read 446 and 544 in two
runs). In WebKit those elements would be separate small layers. Compare columns, not single digits.

## Fix (phone path only: `PHONE_GPU` = `LITE_ART`, and `html[data-touch-ui][data-phone-gpu]` in CSS)

1. **The stage zooms in hero select, the gate and the run too** (stage.ts `zoomedStage` / `zoomGeometryIsStandard`).
   #2166 zoomed only the menus because the game measures the screen with getBoundingClientRect, and older WebKit
   reported zoomed elements unzoomed (WebKit bugs 77998 / 185034). Safari Technology Preview 232 changed that to the
   standard (zoomed) values. So a phone now measures once: a hidden 100 px box at left 100 px inside a zoom-0.5 host
   must report 50 / 50. If it does, the games zoom; if not, they keep the transform exactly as before. Settings > Phone
   diagnostics gets "Old stage in games" (`gamexf`) to force the transform; the existing `zoom` switch still forces the
   zoom.
2. **The parked falling gate hides** (`.wipecurtain:not(.full):not(.gone)` and `.gone.parked`, `visibility: hidden`).
   It shows the moment it starts to fall (visibility is not transitioned), while it is still above the screen.
3. **The hero ceremony entrances let go of their layer**: scrim, glow, ring, flash, name plate, Start Game are filled
   `backwards` with their end state as the element's own style (two explicit-start keyframe twins in heroCeremony.css,
   unused on desktop). Same frames.
4. **The hero select stops painting under the opaque launch curtain** (`data-launch-covered`, set by
   HeroLaunchCurtain once the cover is opaque, cleared before every reveal and on unmount), and the curtain drops its
   finished, filling WAAPI fade (the inline opacity already holds the end state).

2-4 apply whether the stage zooms or not (the `gamexf` column).

## Checked

- Under the zoom, in Chrome: a touch drag buys a Shop card and a second drag plays it (hand 0 to 1 to 0, board 0 to
  1), End Turn drops the gate and the first fight runs. Hero select, the ceremony and the shop screenshots match the
  transform build's layout (different random heroes per run). One cosmetic difference: the thin gold lines beside the
  Start Game studs (a 2 px line inside the button's own `zoom`) round away under the stage zoom; the studs stay.
- Desktop (1920 x 1080 @1x, mouse, seeded Math.random / crypto, animations frozen): main vs branch screenshots of the
  title, hero select and the first shop, see the PR. No desktop code path changes: every change is behind `PHONE_GPU`
  or the `data-phone-gpu` attribute, and `zoomedStage` is false off a phone whatever else it is given.

## Not confirmed / follow-ups

- Chrome stands in for WebKit and cannot reproduce jetsam. The layer model is what moved the crash from the mode home
  (#2166) to hero pick, so it is the best lead, but it is a model.
- **Whether the owner's Safari passes the zoom probe is unknown.** If it does not, his phone keeps the transform and
  gets only fixes 2-4 (peak 651 to about 440 in the model, still over the old mode-home level). The crash log already
  records "stage zoom" on each step, so the next crash log says which path ran.
- Not done: the hero select's own layer (`.heroselect`, 87 MB under the transform, composited for overlap; not its
  blur), the armed gate crystal's six looping layers (about 60 MB under the transform), the 9 MB hero-portrait ring
  PNG (`hero-select/heroportrait.png`, 1524 x 1572, no phone copy because it is not under `art/`), and the falling
  gate's 2455 x 1381 art (13 MB decoded; a stylesheet names it, so it gets no phone copy). With the zoom none of them
  is large.
