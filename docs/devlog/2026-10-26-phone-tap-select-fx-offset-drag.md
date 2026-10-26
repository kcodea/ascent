# 2026-10-26 — Phones: a tap picks a choice again, effects land on their cards, a lighter drag (R-TOUCH-TAPSELECT-01, R-PHONE-FXSIZE-01, R-PHONE-DRAG-01)

**Owner reports (2026-10-26, Netlify build a9afafa5a on his iPhone).**
1. "in a discover select, you can't select an option because tapping a minion inspects. tapping in a discover/etc
   should select. the tap to inspect should only work on board/shop etc"
2. "lemon is saying that some pixi effects dont seem to be firing and that animations also seem to be offset up and to
   the left"
3. "iphone is running okay, but the drag seems to be low fps/not as smooth or something for some reason. can you clean
   that up?"

## 1. A tap picks a choice option (R-TOUCH-TAPSELECT-01)

#2312 (R-TOUCH-TAPINSPECT-01) made a tap on ANY card open Inspect, with a Pick button on the enlarged view. In a
Discover that is two taps per pick and reads as "can't select". `touchInput.ts isSelectOption` names the choice
options: a clickable card outside the play zones (the cards `inspectActionFor` gives Pick: Discover, Choose One, hero
power offers) and a Runeforge rune. For those, `tapInspectAllowed` is false (the card's own click picks) and the
long-press fires again (`holdFiresOn`), so a hold opens the Inspect the right-click opens (Card.tsx `onContextMenu`,
with Pick) or, for a rune, RuneInspect (RuneCard.tsx `onContextMenu`, touch only). The release of that hold is eaten,
so holding never picks.

Final mapping (touch):

| surface | tap | hold |
|---|---|---|
| Shop card | Inspect + Buy | nothing (hold + move = drag to buy) |
| your board | Inspect | nothing (drag to sell / reorder) |
| your hand | Inspect (the press pops it) | nothing (drag up to play) |
| combat, either side | Inspect | nothing |
| scout card, Compendium, end screen boards | Inspect | nothing |
| Discover / Choose One / hero power offer option | **picks it** | **Inspect + Pick** |
| Runeforge rune | **buys it** (if affordable) | **RuneInspect + Pick** (an unaffordable rune can be held and read) |
| Ancient offer (a button) | picks it | nothing (unchanged) |
| hero select card | picks it | hover face (unchanged) |
| quest offer | picks it | hover face (unchanged) |
| your portrait / spectator / lobby seat | as before | emotes / mute / pin (unchanged) |

The touch help ("How do I look at a card up close?", "Can I play on a touchscreen?") says so. Mouse play is unchanged.

## 2. Effects drawn up and to the left (R-PHONE-FXSIZE-01)

**Root cause.** Every screen-space Pixi canvas (`.pixi-screen`: the board FX overlay and its under / above slots, the
turn wipe, the ranked gate) has its CSS box pinned to the stage's layout viewport (`--lvw` x `--lvh`) and draws DOM
rects 1:1 into a renderer that Pixi sizes with `resizeTo: window`, which only re-reads `innerWidth` on a window
`resize` event. On the page scale (R-PHONE-PAGESCALE-01) the layout size changes when stage.ts rewrites the meta
viewport: the menus, hero select and the run each fit their own scale. **WebKit fires no `resize` for a meta viewport
change** (Chromium does). So the renderer made at hero select kept hero select's size in the run, and the canvas box
scaled its drawing to the run's: every effect was drawn at `run / hero-select` of its coordinates, pulled toward the
top-left corner, and its resolution kept the old page scale.

Measured (prod bench build, Playwright WebKit as an iPhone 15 Pro, 852 x 393 @3, first Shop):

| | main | branch |
|---|---|---|
| main FX renderer screen | 2341 x 1079 | 2212 x 1020 |
| its canvas box (`--lvw` x `--lvh`) | 2212 x 1020 | 2212 x 1020 |
| drawn position / intended | **0.945** | 1.000 |
| a first-slot Shop card's centre (838, 352) drawn at | (792, 333): 46 px left, 19 up (layout px) | (838, 352) |
| renderer resolution (should be 1.5 x page scale 0.3852 = 0.578) | 0.546 | 0.578 |

Chromium (Pixel 8 emulation) resized, so its positions were right (factor 1.000 on both), but its resolution was
stale too (0.572 instead of 0.606: softer effects). The offset grows toward the bottom right, so an effect near the
right of the board or the hand landed visibly off its card, and a small one could land on empty board ("not firing").
On a real phone the menu and run scales can differ more than in this emulation (and a rotation or a browser bar is
another such change), so the offset can be larger. Desktop never takes the page scale: no change.

**Fix.** `pixiStageFollow.ts followStage(app)` (phones only; a no-op on desktop) replaces the app's `resize`: a window
renderer is sized from the FIT (`lw * s` x `lh * s`, the box its canvas is drawn in) instead of `innerWidth`, the
resolution re-folds the current page scale, and it runs on every stage change (`onStageChange`) as well as on Pixi's
own window resize. A host-sized renderer (`resizeTo: host`: hero ceremony, hero attack preview, crate) re-measures
its host one frame after a stage change. Every `new Application()` in the UI calls it (a test counts them).

**Gotcha found on the way.** A page-scale change moves the layout size and the resolution in exact inverse
proportion, so the renderer's BACKING size is often identical (2341 x 0.546 = 2212 x 0.578 = 1278 px). Pixi's
`TextureSource.resize` returns early when the pixel size is unchanged, without emitting `resize`, so the texture frame
and `renderer.screen` kept the OLD logical size even though the call carried the new one. `followStage` resizes in two
steps (size at the current resolution, then the new resolution) so the frame always updates.

Other coordinate paths checked: the FX anchors (`combatAnchors`, `boardAnchors`, `playDef`, `spellCastFx`,
`runeCastFlourish`, `statMilestone`), the hero attack formation, the Duos pass lob and the aim line all read
`getBoundingClientRect` / `clientX` / `innerWidth`, which on the page scale are all layout px (`toStage` is the
identity there), so they were right; only the renderer behind them was the wrong size.

## 3. A lighter drag on a phone (R-PHONE-DRAG-01)

- **The hand press no longer loads full-resolution art for a drag.** #2312 loaded the popped hand card's originals
  (~16 MB decoded: plate 800 x 1244, frame 1059 x 1427, desc 683 x 1230, art 512) the instant a finger touched it, and
  every hand drag starts as a press, so each one fetched, decoded and swapped them in while the card was flying. The
  upgrade now waits `POP_UPGRADE_DELAY_MS` (160 ms) of rest, and a press that moves past the slop drops it (and gives
  back any already swapped in).
- **The drag rAF writes only what changed.** `zoom`, `perspective` and `transform-origin` were re-set every frame; they
  hold still for the drag (the origin once the recentre has settled), and re-setting them can cost a restyle and layer
  update (a `zoom` write may be handled as a layout change).
  The moving transform and the tilt are still written each frame they change. No visual change.
- **No drop-shadow filter on the floating card on a phone** (`html[data-touch-ui][data-phone-gpu] .dragcard { filter: none }`). The
  filter sits over a child that tilts in 3D every frame, so it is a filter over changing content, re-rendered every
  frame by the compositor (on iOS, a Core Animation shadow is an offscreen pass per frame). The card keeps its own
  lifted frame shadow (`.cshadow`, static inside the tilt). Desktop keeps both. A small look change on phones only: an
  owner veto is a one-line revert.

**Measured (Chromium, Pixel 8 emulation, prod bench build, real CDP touch drags, 4x CPU throttle; three drags per
round: a Shop card wandered then bought, a hand card wandered then played, a board minion along the row, into the sell
zone and back):**

| frames during drags (headless rAF runs at 240 Hz, 4.2 ms) | main | branch |
|---|---|---|
| 4x, 3 interleaved rounds: p95 (ms) | 4.3 / 4.3 / 8.3 | 4.3 / 8.3 / 12.5 |
| 4x: p99 (ms) | 20.8 / 16.7 / 16.7 | 20.7 / 21.0 / 33.5 |
| 4x: worst (ms) | 96 / 150 / 108 | 154 / 142 / 146 |
| 4x: frames over 16.7 ms (of ~2,800) | 33 / 23 / 28 | 29 / 39 / 48 |
| 1x, 2 rounds: p95 / p99 (ms) | 4.3 / 4.3 both | 4.3 / 4.3-4.4 |
| 1x: frames over 16.7 ms (of ~3,000) | 4 / 3 | 3 / 7 |

No difference outside the noise in Chromium, in either direction (the third branch round at 4x ran with fewer frames
overall, n = 2,250 against ~2,800, i.e. a busier machine). The 1x target (no frame over 16.7 ms) is not met on either
build: the few over-budget frames are the pickup and drop commits, not the moving drag.

Read with care: the machine was shared (other sessions, a game launcher), and run-to-run noise on the same build was
larger than the main-vs-branch difference (one main run measured p95 83 ms, the next 17 ms). In Chromium the steady
drag frame is cheap on both builds (~1 ms of main-thread work per frame at 1x); its long frames are at the pickup and
drop (React commits, the GSAP Flip reads, the first reverb-convolver build of a drop sound) and at gap changes, none of
which this pass changed. A CPU profile of the drag pointed at none of the per-frame paths as hot.

**WebKit could not measure it.** Playwright's WebKit on Windows composites in software: moving one 20 px div costs
~330 ms a frame there, the same as a drag, so headless WebKit frame times say nothing about iOS. The two iOS-side
changes (the drag shadow, the pop upgrade) are reasoned from how WebKit composites, not measured; the owner's iPhone is
the check. If the drag still feels slow there, a Safari Web Inspector timeline (Layers + Rendering Frames) during a
drag is the next step.

## Verified

- Tap mapping, real engines (prod bench build, Playwright WebKit iPhone 15 Pro and Chromium Pixel 8): Shop card tap ->
  Inspect; Discover option hold -> Inspect, Discover still open; Discover option tap -> picked (hand +1); rune hold ->
  RuneInspect, not bought; rune tap -> bought. Main fails the Discover and rune checks (tap inspects), as reported.
- FX: captures before / after in the scratchpad (`phone/fx-offset/`), renderer vs box numbers above.
- `npm run phone:webkit`: all checks pass (Home Screen 0.3852, Safari 0.3229).
- Desktop (1920 x 1080 Chromium, seeded, prod bench builds, main vs branch: Shop and an open Discover): 0 differing pixels.
- Full gate: typecheck, lint (0 errors), build:web green; `npm test` 20,748 passed with the known load flakes failing in the full run (audioDefaultMix, audio/master: 5 s timeouts, pass with a longer timeout; perfCounterNames, fx/prodPlayback, fx/primitives/prewarm, runEndStrength pass alone).
