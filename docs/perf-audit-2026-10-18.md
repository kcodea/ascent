# Performance audit, 2026-10-18

Owner ask: "do a performance audit. i'd like to improve game performance in every way we can." This is an audit:
measured, found, ranked and proposed. Nothing here is shipped. The owner picks what gets built.

The bar: every frame at or under 6.25 ms (160 fps), ideally 4.17 ms (240 fps). Recruit first, and flat from round 1
to the end of a game.

## How it was measured

- **Build:** PROD bench bundle (`VITE_PERF_BENCH=1`, `origin/main` 203d1bd00), served by a static server with the
  Netlify cache headers. Never the dev server.
- **Browser:** Chrome 150, headless (new), real GPU (ANGLE D3D11 on the RTX 4080 SUPER), 1920x1080 at DPR 1.
- **Uncapped frames:** `--disable-gpu-vsync --disable-frame-rate-limit`. The rAF interval is then the real cost of a
  frame (main thread, compositor and GPU), not a vsync slot. So "frames over 6.25 ms" below are frames that would
  miss 160 Hz however fast the panel is. Idle frames run at 0.2-0.5 ms (2,000-5,000 fps).
- **Traces:** CDP tracing at 60 Hz for attribution (Layerize, style, raster, GPU), Long Animation Frames for script
  attribution, the in-game `perfMonitor` spans for JS labels.
- **Backend blocked:** every `supabase.co` request was blocked in every script. No accounts were created and no
  boards were uploaded. Opponents came from the bundled pool. This also means Career, Social, Hall and Versus could
  not be measured (no data).
- **Load:** checked before every batch. Games 1-3 ran at 10-35% machine load (another agent's headless browser came
  and went, 7-25% of the machine). The three games were the same seed and hero and produced identical DOM counts,
  so they are true repeats. A/B runs interleave variants inside one browser so load hits all variants alike.
- **Scripts** (kept outside the repo): `game.mjs` (full game driver: real mouse hovers, drags and clicks plus store
  dispatches), `ab.mjs` (A/B harness on a heavy God Mode shop: 7-card board, 6-card hand, 776 DOM nodes),
  `boot.mjs`, `menus.mjs`, plus trace analyzers.

The full-game script: Practice, Unlimited health, 1x timer, Warden, seed 424242. Each round: idle 1.5 s, hover every
card, upgrade on even rounds, one real drag-buy, store buys, sell the weakest when full, one real drag-play then store
plays, a real Refresh click, a board reorder drag, Freeze on/off, End Turn, watch combat, the post-combat hold, then
click back to the shop. 15 rounds per game (the lobby ended at round 15 each time).

## Baseline (3 games, median, range across games in brackets)

Frames over budget are per action (one hover sweep, one drag, one roll...). Frame times are uncapped.

| Action | mean ms | p95 | p99 | worst | frames > 6.25 | frames > 4.17 |
|---|---|---|---|---|---|---|
| idle shop (1.5 s) | 0.48 (0.46-0.48) | 0.8 | 1.0 | 29 (14-33) | 1.7 | 3.7 |
| hover sweep (all cards) | 0.85 | 1.8 | 3.7 | 34 (33-34) | 47 (37-49) | 103 |
| drag-buy (shop to hand) | 0.74 | 1.6 | 2.9 | 50 (20-51) | 11 | 24 |
| drag-play (hand to board) | 0.84 | 1.8 | 3.8 | 52 (51-55) | 18 | 33 |
| board reorder drag | 0.79 | 1.5 | 3.2 | 40 (35-45) | 14 | 35 |
| buy (store) | 1.72 | 7.0 | 16 | 64 (56-116) | 20 | 32 |
| play (store) | 0.56 | 1.2 | 1.7 | 14 | 2 | 2 |
| sell | 0.84 | 2.1 | 2.6 | 17 (12-32) | 4.3 | 8 |
| roll (real click) | 0.53 | 0.8 | 1.7 | 28 (26-32) | 3.2 | 7.5 |
| freeze on+off | 0.71 | 1.6 | 2.2 | 30 | 4.7 | 12 |
| upgrade | 0.85 | 1.2 | 2.1 | 15 | 3.2 | 3.6 |
| Runeforge (open, buy) | 0.93 | 3.8 | 10.7 | 71 (30-87) | 24 | 50 |
| combat (whole replay) | 0.95 | 2.5 | 4.2 | 113 (74-130) | 136 (119-161) | 301 |
| post-combat hold (1.5 s) | 0.46 | 1.4 | 2.3 | 39 | 5.3 | 12 |
| back to shop (first 1.3 s) | 0.73 | 1.7 | 2.6 | 51 (48-52) | 17 | 27 |

### The curve is not flat

| Rounds | recruit-script frames > 6.25 per round (g1/g2/g3) | hover sweep > 6.25 | combat > 6.25 | DOM nodes |
|---|---|---|---|---|
| 1-4 | 5-50 (median 14) | 7 | 44 | 478-558 |
| 5-9 | 34-268 (median 63) | 28 | 103 | 623-945 |
| 10-12 | 53-306 (median 85) | 43 | 225 | 1,036-1,185 |
| 13-15 | 69-309 (median 168) | 109 (74-143) | 245 | 1,240-1,305 |

Late-game recruit costs roughly 10x the frames of round 1, and combat 5x. The JS side does not explain it
(`render:recruit` stays 2-3.5 ms average, `store:set` 0.3 ms). The growth is in the browser's render pipeline: GPU
raster of card layers, re-layerize, and restyles that scale with the DOM.

### Other baselines

- **Engine** (`npm run perf`, 3 runs at 22-50% load): simulate 7v7 0.15-0.16 ms, keyword-heavy 0.21-0.22 ms, a
  dispatch 0.054-0.056 ms, full greedy-bot run 198-237 ms. Healthy. (`perf:odds`: worst single sim 7.4 ms at wave 12,
  worst 10-sim slice 6.8 ms. See finding 8.)
- **Boot** (cold cache, localhost, 3 runs): loading gate opens at 5.32-5.41 s. Main thread busy 6.3 s. JS: parse on a
  background thread 142-152 ms, main-thread compile 52 ms, module evaluate 61 ms. Images: 1,608 decode tasks on the
  raster workers (5.9 s CPU) plus 181 on the decoder (1.27 s). After boot: renderer 312 MB, GPU process 560 MB
  private memory.
- **Bundle:** entry chunk 6.92 MB minified / 1.86 MB gzip, CSS 902 kB / 166 kB gzip.
- **Memory over a game:** JS heap 44-50 MB at round 1 to 57-81 MB at round 15, DOM 478 to 1,305, listeners ~700 to
  ~1,200 (tracks the board and hand filling). GL programs flat at 19. Pixi textures 40 to 98 (grows, worth watching).
  No leak trend inside a game. Across several games in one session was not measured.
- **Menus** (backend blocked): title idle 0 frames over. Title first 3 s: 22-24 frames over, worst 110-150 ms.
  Compendium open worst 76 ms, scroll 33 frames over per 20 wheel ticks, close worst 74 ms. Patch Notes open worst
  69 ms (its 373 kB chunk). Settings, Rules and hero select: 0-5 frames over.

## Ranked findings

Each: measured cost, root cause, fix, expected gain, difficulty, visible change, risk.

### Safe, no visual change, do now

**1. `body.aiming *` restyles the whole document twice per aim.**
- Cost (A/B, 10 toggles x 2 reps): 11.1 ms restyle of 756 elements per toggle, 14-15 frames over 6.25. Late game the
  DOM is ~1,300 nodes, so ~19 ms. Every hero-power aim, targeted Battlecry and spell drag pays it at start and end.
- Cause: `styles.css:5401` `body.aiming, body.aiming * { cursor: none !important; }`, toggled at `Recruit.tsx:9558`.
  The same pattern `body.dragging *` was removed on 2026-10-10 for the same reason.
- Fix: carry the hidden cursor on a veil element, as `dragCursorVeil.ts` does for drags.
- Gain: 11-19 ms off each aim start and end (0.2 ms after, 0 frames over). Easy. No visible change. Low risk.

**2. The title's first seconds absorb the GL warm-up.**
- Cost: title first 3 s, 22-24 frames over 6.25 (3 runs), worst 110-150 ms. Boot trace: six tasks of 64-236 ms
  right after the gate opens, each blocked on the GPU (`CommandBufferProxyImpl::WaitForGetOffset`).
- Cause: the FX program pre-warm steps (`fx/playDef.ts:436`, one link per `setTimeout`, 64-145 ms each) and the
  first Pixi `Application.init` loading Pixi's lazy `browserAll` chunk (105 ms, `pixi.js/lib/environment-browser`).
  The same lazy import costs 60 ms again at game over on every game (a later `Application`).
- Fix: run the pre-warm and the first `Application.init` while the boot splash is still up (the gate already waits
  on art), and import Pixi's browser extensions at entry so no later `init` loads them.
- Gain: title smooth from its first frame; one 60 ms game-over hitch gone. The splash stays up about 0.5-0.7 s
  longer. Easy-medium. No visual change. Low risk.

**3. Combat entry does a whole-document restyle every combat.**
- Cost: 12-16 ms restyle of 900-1,100 elements at combat start (rounds 10 and 13 traces), plus two compositor waits
  of 35-70 ms (`LayerTreeHost::WaitForCommitCompletion`, the new combat layer tree being committed and rastered).
  Combat's worst frame is 74-130 ms in every game.
- Cause (restyle): almost certainly the 23 `body:has(...)` rules (e.g. `:where(body:has(.app.combat))` at
  `styles.css:3682`) re-matching when `.app` gains `.combat`. Needs one invalidation trace to name the selector.
- Fix: scope those rules to the element that changes (a class on `.app`, not `body:has`). The commit waits are
  item C2.
- Gain: ~12-16 ms off one frame per combat. Medium (find + rewrite selectors). No visual change. Low risk.

**4. Every recruit commit forces a ~300-element restyle inside the dispatch.**
- Cost: 5-6 ms forced style + layout inside each buy, sell, play and roll (invalidation trace, heavy shop).
- Cause: the tavern rect sweep, a `useLayoutEffect` that calls `getBoundingClientRect` on every tavern card when
  `flipKey` changes (`Recruit.tsx:9188-9200`). The other forced reads are the `:has()` re-checks on `.app` and
  `body` (`StyleRecalc: Affected by :has()` on every commit).
- Fix: read the rects lazily, only when a consume/slide actually needs them, or after paint. Same for the drop's
  `getBoundingClientRect` sweep in `onUp` (`Recruit.tsx:4613`).
- Gain: the commit's long task shrinks by ~5 ms. The restyle still happens once, in the frame's own style pass, so
  the frame gain depends on whether a later effect re-dirtied style (likely, not proven). Medium. No visual change.
  Low-medium risk (FLIP and consume animations read these rects).

**5. Ship less JavaScript in the entry chunk.**
- Cost: 6.92 MB minified, 1.86 MB gzip. On localhost only ~120 ms of main-thread compile + evaluate (parsing is on
  a background thread), so this is a download and memory problem for remote players, not a frame problem.
- Cause: all hero-attack scenes are static imports from `Recruit.tsx:102` and friends (948 kB, 113 files), and all
  473 FX defs are an eager glob (`fx/fxDefs.ts:47`, 950 kB of object literals).
- Fix: dynamic import of each hero attack, prefetched at run start for the 8 seats' heroes (no first-use delay);
  `json: { stringify: true }` in the Vite config for the defs (JSON.parse is faster than object literals) or lazy
  per-def loads.
- Gain: ~1.9 MB minified (~0.5 MB gzip) off the entry. Medium. No visual change. Low risk if the prefetch covers
  every seat.

**6. Google Fonts block the first paint.** `apps/web/index.html` loads a render-blocking stylesheet for six
families from `fonts.googleapis.com`. Measured 90-113 ms on a fast line; on a slow or blocked network it holds the
splash. Self-host the same font files (identical glyphs) or load the sheet without blocking. Easy. No visual change.

**7. Compendium open and close stall.** Open: a 62 ms click task with 35 ms of forced style + layout, worst frame
76 ms. Close: worst 74 ms, 72 frames over. Medium (profile the mount; likely a layout read in a mount effect and the
unmount of many real cards). No visual change.

**8. The odds probe can still block a frame for 7 ms.** `oddsStepper.ts` sizes steps at ~2 ms with a floor of one
sim, but one sim measured up to 7.4 ms (`perf:odds`, wave 12). Moving the probe into a Web Worker removes it from
the main thread entirely (the engine is pure TS; there are no workers in the game today). Medium. No visual change.
The same worker could build lobby seat drivers (`store.ts:1556`, ~100 ms per generated seat by its own comment; not
measured here because the bundled pool served snapshots).

### Needs owner visual sign-off (or an asset pipeline OK)

**9. Card frame filters are half of all GPU raster. Pre-bake them. (Biggest lever for the late-game curve.)**
- Cost (A/B, heavy shop, 8 store actions): GPU raster 2.43-2.49 s with filters, 1.20 s with only the frame filter
  removed, 1.26 s with all card filters removed. Hover sweep: 410-494 ms raster down to 168 ms, frames over 6.25 per
  sweep 14-16 down to 5. Every new, moved or hovered card re-rasters through these filters, and late game has twice
  the cards.
- Cause: every `.cframe` / `.tframe` carries `filter: var(--frame-tone) drop-shadow(0 4px 6px ...)`
  (`styles.css:4431`, also 1854-2160), where `--frame-tone` is `grayscale(0.92) brightness(1.2) contrast(0.9)` on
  silver frames (`styles.css:4579`). The blurred grounding copy (`.cshadow`, 7%) and the hover glow (`.cglow`) add
  more.
- Fix: bake the tone and the drop shadow into the frame images offline (one silver and one gilded file per frame,
  rendered from the same CSS filter so pixels match), then drop the runtime filters. Same idea for `.cshadow` and
  `.cglow`.
- Gain: ~50% of shop and combat GPU raster. Medium-hard (asset script, padding/offset for the shadow, a pixel diff).
  Intended to look identical, but it changes how frames are delivered, so the owner should see before/after crops.
- **Smaller card art does not help here.** The phone copies (frames 380 px, art 256 px, `?art=lite`) raster the same
  or slightly more (2.66-2.72 s vs 2.43-2.47 s, 2 runs each). The pending "card-size art for desktop" proposal would
  not fix raster. It is the filters, not the pixel count.

**10. Hover preview triple drop-shadow.**
- Cost (A/B, 4 reps): with the shadow, mean frame 0.54-0.73 ms, Layerize on 14% of frames, 14-42 frames over 6.25
  per sweep; without, 0.45 ms, Layerize ~0, 11-16 frames over.
- Cause: `.cardref` `filter: drop-shadow x3` (`styles.css:3281`). Moving the bob onto the filtered element and
  removing the bob both changed nothing, so it is the filter itself.
- Fix options: one lighter shadow, or a pre-baked glow image behind the card. Small visual change. Easy.

**11. The drag tilt re-layerizes every frame.**
- Cost (A/B, 3 reps each, 12 variants): Layerize on 100% of drag frames, 0.40 ms each; main thread per frame 0.74 ms
  vs 0.32 ms without the tilt (uncapped frame rate doubles). Only removing the 3D tilt on `.dragtilt` fixes it.
  Fixed transform-origin, no zoom, no perspective, no filter, flat transform-style, backface-visibility, isolation,
  translateZ, a 2D move on the inner element and the tilt moved to the outer element all still layerize.
- Cause: the per-frame transform on the nested `.dragtilt` (`Recruit.tsx:9471-9529`); Chrome does not take its
  direct composited-transform path for it. This closes the open item in `docs/performance.md` 3i.
- Desktop impact is small (drag p99 1.3 ms uncapped). Phones paid ~5 ms a frame at 4x throttle (mobile pass).
- Proposal: keep the tilt on desktop, drop it on phones (`isPhone`). Visual change on phones only.

**12. The boot gate decodes everything (5.3 s on localhost).** ~1,790 image decodes before the menu, 560 MB GPU
process. Option: gate on the live set and chrome, decode other sets' art (Compendium-only) after the menu appears.
Owner's own load-everything rule, so owner call. Risk: Compendium pop-in on a fast first open.

### Big / structural

**C1. Combat re-layerizes on ~80% of frames.** Rounds 10 and 13 traces: `PaintArtifactCompositor::Update` on
3,268-3,785 of 4,023-4,516 frames, 0.59-0.70 ms each (2.2-2.3 s per late combat), about 40% of combat main-thread
frame time. Not attributed yet; likely the same mechanism as finding 11 (per-frame transforms on nested composited
layers: lunges, floats, keyword loops). Next step: a replay A/B that disables one animation family at a time (my
replay harness did not start the sandbox replay; needs a fix). Medium-hard.

**C2. Combat entry commit waits.** 35-70 ms x2 per combat (compositor commit + raster of the new combat board).
Pre-build and pre-raster the combat board under the End Turn wipe. Hard.

**C3. The late-game curve.** Fix 9 (raster) and C1 (layerize) are the two biggest levers. Also the idle shop's mean
frame grows 0.31 ms (round 1) to 0.75 ms (round 13+) with more keyword loops on screen.

**C4. Per-element style cost.** 7,810 `var()` references in ~8,000 rules. A roll or play restyles ~300 elements at
~15-20 us each (5-6 ms). Known from 3h; still the restyle ceiling. Structural CSS rewrite.

**C5. Workers.** Odds probe (8) and lobby seat drivers off the main thread.

## Known open items re-checked

| Item | Status 2026-10-18 |
|---|---|
| narrow `body.dragging *` | gone (veil). 22 `body.dragging X` rules remain; toggling them per drag showed no per-frame cost (A/B `noBodyDragging`). But `body.aiming *` is the same bug (finding 1). |
| hover-preview layout effect | `input:hover-preview` 0.1 ms average, 3.1 ms worst. Fine. |
| roll/sell React commit 12-18 ms | `render:recruit` now 2-3.4 ms average, 24 ms worst; roll 3 frames over. The remaining sell/play cost is restyle and raster (4, 9). |
| per-element style cost | still true (C4). |
| card-size (~512 px) art | shipped art is already 512 px; frames are 1059x1427. A/B says size is not the raster cost (9). |
| hover-preview shadow | measured (10). |
| combat style per beat | small: combat restyles average 0.12-0.16 ms per frame. The combat cost is layerize (C1) and raster. |
| late-game rounds 10-12 82-124 frames over | still ~53-306 recruit frames over per round in rounds 10-15 (different script, not a paired comparison). |
| drag Layerize per frame (3i) | root cause found: the 3D tilt (11). |

## What needs the owner's machine or a real device

Headless numbers are uncapped and real-GPU, but they are not the 240 Hz panel, and phones need a real device.

1. **Confirm the curve on the 240 Hz display.** Play a Practice game to round 13+ on the prod build with `?perf=1`.
   At rounds 3, 9 and 13: hover every card, roll twice, drag a card across the board. Save the recording from the
   HUD (label it with the round) and share it. The `capture worst / long` numbers per round tell us whether the
   10x growth shows on your hardware.
2. **Combat on the panel.** Same session, note `10 s worst` during a round 12+ combat and the first second of it.
3. **Phone drag (iPhone, Safari Web Inspector, Timeline with the GPU lane):** drag a card around for 3 s; check
   whether Layerize/compositing shows on every frame (finding 11).
4. **Remote load:** open the Netlify build on a throttled or remote connection and time splash-to-menu (findings 5,
   6, 12).

## Not measured here

Career, Recent Games, Social, Hall, Versus rooms and spectating (backend blocked, no data). Memory across several
games in one session. GC pauses beyond the traced rounds (major GCs were 3.5-4.6 ms each, 8-17 per traced combat).
