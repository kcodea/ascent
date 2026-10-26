# 2026-10-25 — iPhone: the Shop collapsed in real WebKit; phones now scale the PAGE (R-PHONE-PAGESCALE-01)

**Owner report (2026-10-25).** A real iPhone (15/16/17 Pro class, landscape, both in Safari and as the Home Screen app),
round 1 Shop: "Mobile looks like this". The Shop minions did not render (only their Attack / Health badges, stacked
in one spot near the top centre), the lobby rail was tiny, Tier / Freeze / the Refresh cost were huge, and the timer was
tiny. Every phone capture so far (#2287 / #2288) had been taken in Chromium device emulation, where all of it was right.

## Root cause

Since R-TOUCH-RUN-MEMORY-01 (2026-10-22) a phone shrank the stage with CSS `zoom` (menus always; hero select and the run
whenever the zoom-geometry probe passed, which current iOS does). WebKit lays a zoomed subtree out in two ways Chromium
does not, and Playwright's WebKit (`?phonediag=zoom`) reproduces the owner's screenshot exactly:

1. **Registered `@property` lengths are zoomed twice.** `--ch-base` / `--ch` / `--cw` / `--ccw` / `--u-base` / `--u` are
   registered as `<length-percentage>` (perf pass 2026-10-09). WebKit multiplies a registered length by the zoom when it
   is DECLARED inside the zoomed subtree and again where it is used, and the chain is re-declared per zone, so the error
   compounds. Minimal page, zoom 0.5: `--a: 100px` used as a width gives 50 px, a child's `--b: calc(var(--a))` 25 px
   (Chrome: 100 / 100). In the game `--ccw` came out 53.9 px instead of 146 and the Shop cards measured 19.8 px wide:
   the collapse. The rail sizes off the same chain.
2. **WebKit's minimum logical font size.** Under a zoom, any text specified at 9 px or more (or relative) that the zoom
   takes under 9 SCREEN px is raised to 9 screen px, before any transform: at the run's zoom of 0.368 every font under
   24.4 layout px became 24.4 (12 px under zoom 0.5 becomes 18). Text inside a scaled-up pill (Tier at `scale(1.936)` in
   a `1.24` wrap, Freeze, the Refresh cost) was then scaled up from there: about twice its size. No CSS turns it off.

The transform (the path before the zoom) renders correctly in WebKit, but WebKit pays every composited layer inside a
transformed stage at its full stage size times 3 x 3, and the owner's iPhone crashed at the hero pick on it (#2242's model:
a 442-651 MB peak against 227 with the zoom). So neither old path was acceptable.

## The fix: the browser scales the page (stage.ts `applyPageStage`)

A phone (`PHONE_GPU`) lays the page out at the stage's layout size and lets the browser scale it, the way it shows a
desktop site: the meta viewport is written as `width=<lw>, initial-scale = minimum-scale = maximum-scale = <s>` (the
fit's scale, snapped so the layout width is whole), and the stage itself is neither zoomed nor transformed. There is no
zoom, so no double-zoomed property and no font clamp; and the browser rasterises page-scaled layers at their ON-SCREEN
size (the same reason a zoomed-out desktop site does not cost 9x on a phone).

- **Coordinates are layout px.** `getBoundingClientRect`, pointers and `innerWidth` all come back in layout px, so the fit
  the game reads has `s === 1` (every `toStage` / `rectToStage` / FX scale is the identity, exactly a desktop window of
  that size). The SCREEN scale is `fit.vs` / `screenScale()` (the touch UI sizes off it) and `pageScale()`.
- **Everything measured in screen px stays screen px**: the tap slop (`tapSlopPx`), the 44 px hit slop, the text-field
  lift (`touchKeyboard.ts`), the hand pop's gaps (`popGeometry` `u`) and its safe area (`cssSafeInsets`).
- **Pixi renders at its on-screen size**: `phonePixiOptions` folds the page scale into every renderer's resolution, and
  `pixiFx.ts` folds it into `Filter.defaultOptions.resolution` (a full-screen filter in a fight took four 4096 x 2048 pool
  textures, 128 MB, before that).
- **The browser's own scaling is switched off**: `text-size-adjust: 100%` (iOS text autosizing and Chrome's font boosting
  inflate text on a page wider than the screen), `touch-action: pan-x pan-y` on `<html>` / `<body>` and iOS's
  `gesturestart` / `gesturechange` cancelled (iOS ignores `user-scalable=no`), so a pinch never zooms the page.
- **The safe area** is read off the probe in screen px; whether a browser reports `env()` divided by the page scale is
  learnt once against the scale-1 reading (Chrome does not divide).
- **Rotation** re-fits from `visualViewport.width * scale` (screen px whatever scale is applied); the rotate prompt, which
  sits outside the stage, takes the scale back out (`zoom: 1 / --stage-s`).
- The crash readout's layer estimate knows the page scale (`ps` on each step, layers at on-screen size), and so do
  `perf:phone-run` / `perf:phone-menus`.
- The diagnostics switches keep the old paths for bisecting: `zoom` (CSS zoom everywhere), `nozoom` (menus on the
  transform), `gamexf` (games on the transform). The zoom-geometry probe is gone.

Desktop never takes the path (`stageModeFor` is the transform off a phone).

## Verified

- **WebKit (Playwright, iPhone 15 Pro landscape, 852 x 393 @3, touch, safe area 59 / 59 / 21):** the Shop (round 1 and
  late), hand pop, combat, hero select and menus draw at the approved sizes; `--ccw` 146 px, Tier 11.6 px. New
  `npm run phone:webkit` (Home Screen app and Safari sizes, layout checks) passes. The thin text in Playwright WebKit
  captures is that port drawing Google's variable Outfit at its default instance (a bare test page shows it, main too);
  iOS's CoreText draws it bold, as in the owner's screenshot.
- **Chromium (iPhone + Pixel 8 emulation, seeded) vs main:** every proportion in the parity set matches to 0.0-0.4% of
  the screen (minions, board / shop rows, hero, hand, pop, rail, End Turn, corner buttons, Discover, Runeforge, menus,
  Settings, Compendium). Pixels differ at edges only (the page is rasterised at the page scale instead of zoomed); the
  Health plate's frame is a hair thinner (Chromium's zoom rounds that border up).
- **Desktop** 1920 x 1080 and 2560 x 1080, seeded, main vs branch (title, hero select, shop, Discover, Runeforge, late
  shop, combat end): identical.
- **Memory** (`perf:phone-run --interact`, the iOS layer model, headless Chrome as an iPhone; now page-scale aware):

  | step | main (CSS zoom, 2 runs) | page scale (final) |
  |---|---|---|
  | hero select | 138-139 | 139 |
  | picked +1 s | 165-166 | 166 |
  | Start Game +2.5 s | 144-145 | 145 |
  | first shop | 236-239 (layers 47) | 230 (layers 38) |
  | after a buy + play | 235-238 | 227 |
  | gate down | 233-237 | 239 |
  | first fight | 219 | 215 |
  | **peak** | 236-266 over 6 runs | 239 |

  The menus model (title, modes, Practice) matches main to the MB. Two regressions the model caught on the way, both
  fixed: Pixi filters default to resolution 1, so a full-screen filter in a fight allocated four 4096 x 2048 pool
  textures (+128 MB in 2 of 12 runs; a sweep playing all 470 FX defs now allocates nothing main does not), and the turn
  glyph's mote canvas was backed at layout size x DPR (+21 MB at the first shop). Both fold the page scale in now.
- **Perf** (prod bench build, 4x CPU throttle, 2 runs each, shop idle / a drag along the same in-game path / combat):
  the same as main on both phones (shop idle p99 4.3 ms, drag p50 8.4 / p95 12.6-16.6 ms, combat p95 4.3-8.4 ms; frames
  over 17 ms within run-to-run noise). The hand-press bench was too noisy to rank (another session held the CPU at
  100%; main itself ranged from 15 to 112 frames over 17 ms).

## Gotchas

- **Chromium device emulation is not WebKit.** Verify phone layout in WebKit too (`npm run phone:webkit`; once:
  `npx playwright-core install webkit`).
- In WebKit, never shrink a subtree that declares registered lengths or holds small text with CSS `zoom`.
- On the page scale a measured px is a LAYOUT px: anything meant as a physical distance (slop, hit target, a gap from
  the screen edge) must divide by `pageScale()`; any texture sized from layout px must fold the page scale into its
  resolution.
- Not verifiable here: real iOS layer memory, and whether a real iPhone honours a meta viewport rewritten on rotation in
  the Home Screen app. Both need the owner's phone (the LAN preview steps are in the PR).
