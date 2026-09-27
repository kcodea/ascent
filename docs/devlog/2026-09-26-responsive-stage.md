# 2026-09-26: The scaled stage (phones held sideways, small windows) and touch

Owner ask: *"when the screen shrinks our art pieces fly all over the place, and the mobile experience is really
bad. can we branch off and try and take a HUGE pass at firming up that aspect of the game?"* Targets: phone
landscape (844x390, 932x430, 667x375) and small desktop windows (1024x640, 1280x720, 1366x768). Approach (owner's
pick): scale the whole stage uniformly. Plus touch: tap-to-inspect, finger drags, no hover-only information.
Portrait phones get a rotate screen.

## What already existed (built on, not replaced)

- The 16:9 stage box (`--gw` / `--gh`, letterboxed with `--bar-x` / `--bar-y`, pinned at 2560x1440) and the
  uniform `--scale` = gh / 1440 that every authored size and offset multiplies (2026-07 "uniform stage scaling").
- The board backdrop that extends into off-16:9 margins, with the ultrawide side blend (2026-08-18), and the hero
  panel anchored to the art (2026-08-20).
- The July mobile passes: `dvh`, safe areas, viewport lock, `touch-action: none` on `.app`,
  `overscroll-behavior: none`, the iOS callout fix, the PWA manifest, a touch drag that sticks to the finger, and a
  `.rotate-prompt` on portrait touch devices.
- A phone-only reflow (stage under 600px tall): cards x1.36, board art x1.3, re-tuned row drops, tighter gaps, a
  1.3x inspect popup, bigger HUD chrome.

## Why the art still drifted

`--scale` only reached CSS written in `--scale` / `--u` / `--ch`. Everything authored in raw px (borders, gaps,
paddings, font sizes, badge rings, `clamp()` floors), viewport `vw` / `vh` units and viewport `@media` queries kept
their desktop size while the board shrank, so the smaller the window, the further they pulled apart from the art.
The phone-only reflow then switched on at a 600px-tall stage (a 1024x640 window already qualifies), moving rows and
zooming the board art in one jump. The July devlog named the root cause: "a full stylesheet sweep for remaining
raw-px in-game rules is the systematic follow-up". The before screenshots show it: at 844x390 the stat badges are
the size of the cards and overlap, the hand covers the warband, the Esc panel and Patch Notes render at desktop px.

## The stage model (new)

`packages/ui/src/stage.ts`. The game never lays out smaller than the 1920x1080 design size (the owner's 1080p
desktop look). `fitStage(w, h)` gives `s = min(1, w / 1920, h / 1080)` and a LAYOUT viewport `w / s` x `h / s`
(never smaller than the design size). `#stage`, a wrapper `installStage()` puts around React's `#root` before the
first render, is sized to the layout viewport and carries ONE `transform: scale(s)` from the window's top-left.
Everything inside keeps the existing var engine unchanged: it simply sees a >= 1920x1080 viewport, so `--gh` is
>= 1080, `--scale` >= 0.75, and the 1080p look shrinks as one piece. Consequences:

- **At or above 1920x1080 nothing changes.** `s === 1`: no transform, `#stage` is `display: contents`, every
  helper is the identity. Desktop, 1440p, 21:9 and 32:9 run the exact pre-stage code path (the existing ultrawide
  behaviour, wipe geometry and `wipeGeometry` / `ceremonyScale` tests are untouched).
- **No bars.** The layout viewport covers the whole window; the 16:9 box sits inside it with the same `--bar-x/y`
  margins the ultrawide path uses, so the board art and its edge blend fill the extra width or height on a phone.
- **`position: fixed` resolves against `#stage`** while it has a transform, which is why the layout viewport is
  window-sized: `inset: 0` overlays, the wipe curtain and modal backdrops still reach every edge.
- **The phone-only reflow is gone** (its JS vars stay unset, so their CSS fallbacks are the identity). A phone now
  shows the desktop layout, smaller; tap-to-inspect is the reading tool.
- **`vw` / `vh` / `dvh` resolve against the window**, so all 109 uses in the stylesheets became `var(--lvw)`,
  `var(--lvh)`, `calc(N * var(--vw))`, `calc(N * var(--vh))` (fallback to the real unit when unscaled).
- **Viewport `@media` width/height queries** (they see the window) were removed where the layout viewport makes
  them dead (everything below 1920 wide / 1080 tall) or turned into `:root[data-lv~="w2200|h1000|h1200|h1360"]`
  breakpoints that stage.ts sets from the layout viewport.
- **Portals and imperative layers mount into `stageHost()`** (`#stage`), not `document.body`: 20 portals and 16
  `appendChild`s. The rotate prompt is the one deliberate exception (it must be drawn in device px).

## The coordinate rule (new; in CLAUDE.md)

Screen space: `getBoundingClientRect`, `clientX/Y`, `innerWidth/Height`, and all Pixi coordinates. Stage space:
every CSS length written to a DOM element inside `#stage`, and layout reads (`offsetLeft`, `clientWidth`). Measure
in screen space; convert with `toStage` / `rectToStage` / `stageViewport()` only where a measured value is written
into CSS (and `toScreen` where a layout read is mixed into a screen value). Converted: the drag card (translate,
size, grab origin), sell/buy zones, FLIP deltas, combat floats / projectiles / loss flyers, GSAP flights, the wipe
CSS vars, every hover popup and its viewport clamp (card reveal, quest / rune / career tips, lobby scout, Hunch,
cast preview, Ancients preview), the choreographer's lunge / knockback, buy slide, plate coalesce / dissolve,
Rebirth pillars, lobby damage, spell / ruby power numbers, dice, rune lock-in, the Ancients gate, replay ghosts,
tutorial coach placement, the hero-select ceremony geometry.

**Pixi stays in screen space.** Each `resizeTo: window` renderer is still window-sized at device resolution; the
`.pixi-screen` class gives its canvas a layout-viewport CSS box so the stage transform lays it back over the window.
Rects go into Pixi raw. Two Pixi follow-ups: authored defs (`playDef`) and the aim line are px at the 1080p layout,
so they now mount in a container scaled by `s` with anchors divided by `s` (`stageSink`), shrinking uniformly with
the board (the particle `fxScale` already did this for the hand-written effects); and the hero ceremony's
host-sized renderer folds `s` into its resolution.

**GSAP Flip's `simple: true` path** adds the screen-px box delta straight onto layout-px `x/y`, so every row slide
started `1 / s` too far out (2.8x on a phone: the "art flies in" look). `stageFlip.ts` does the same translate-only
FLIP by hand below the design size, at the simple path's cost; at `s === 1` it is Flip itself.

## Touch (new)

`touchInput.ts`, installed once in Game. A finger tap acts as a parked mouse: the tapped element's chain wears
`.tt-on`, and every hover-reveal tip rule in styles.css / ancients.css got a `.tt-on` twin (hero tip, shop buttons,
Gold pill, End Turn, quest badges, `data-tip` bubbles, Ancients meter, lobby tips). `onPointerLeave` previews are
kept open after a tap and closed by the next touch elsewhere (a replayed `pointerout`). A tap on a card in the
shop / warband / hand / combat opens Inspect (never while aiming or dragging; the mouse hover reveal is skipped for a
finger). A touch drag engages past a 10px slop (`TAP_SLOP`), so a tap never becomes a micro-drag; the mouse keeps
its tuned threshold. No grey tap flash. Portrait: the rotate prompt now portals outside the stage and wears the
board's palette.

Two touch bugs the play-through found and fixed: the Layout Lab's sell / buy edge offsets (`sellZoneY` -136,
`buyZoneY` 79) were raw screen px added to screen rects, so on a phone the sell zone shrank to a 15px strip at the
top (now `toScreen`, layout px, identical on desktop); and the hero power's press-drag aim was cancelled on a finger
because the status bar sits outside `.app`, where the page's `touch-action: manipulation` let the browser take the
move as a pan (`.statusbar { touch-action: none }`).

**Judgement calls (flag if wrong):** the hero-power BUTTON still fires on a tap (its tip opens on the tap too, and a
tap on the portrait reads the tip without firing); tap on a card = the full Inspect overlay rather than the desktop
hover reveal; no long-press anywhere.

## Verification

- Headless Chrome (CDP device emulation, touch on) at 667x375, 844x390, 932x430, 1024x640, 1280x720, 1366x768,
  1920x1080, 2560x1080, plus 390x844 portrait. Before (origin/main 63dacabed) / after screenshots and a contact sheet
  in the session scratchpad. 1920x1080 and 2560x1080 are unchanged; every smaller size is now the 1080p layout,
  uniformly smaller. 3440x1440 was not screenshotted: SwiftShader could not render a 5 MP page in time. It runs the
  `s === 1` path, pinned by `stage.test.ts`.
- Touch play-through at 844x390: the drag card sits under the finger (within 0.01px), buy, play two, sell, tap a
  card to Inspect and tap away to close, tap the Gold pill and hero for their tips, a press-drag hero power onto a
  minion with the aim line landing on it, End Turn, the combat to its end, End Combat, into round 2. A board reorder
  glides exactly one slot (was 2.8).
- Performance (prod build, 844x390 @ DPR 2, 4x CPU throttle, headless SwiftShader, rAF intervals, two runs each).
  Before / after: idle shop 21.7-32.9 / 21.3-21.9 ms avg; touch drags 35.6-41.9 / 33.2-34.6 ms avg; End Turn +
  combat 7.3-8.8 / 6.9-7.2 ms avg (p95 16.7-29.1 / 16.6-16.7); hero ceremony 9.4 / 8.6 ms (64 ms before the
  renderer resolution fix). Software GL makes the absolute numbers pessimistic; the comparison is the point.
- Tests: `stage.test.ts` (fit math), `stageTripwire.test.ts` (no body portals / appends, no raw vw / vh, no
  viewport `@media`, window-sized Pixi canvases wear `.pixi-screen`, host-sized ones fold `stageScale()`, no raw
  viewport units in TSX), `touchInput.test.ts` (tap slop). Oracle: R-PRESENT-21, R-PRESENT-22.

## Not done

- DEV-only tools (Beat Lab, FX workbench UI, tuners, UI editor) were not coordinate-audited; the owner runs them on
  desktop, where `s === 1`.
- Filter blur radii inside scaled FX stay in screen px (slightly softer on a phone).
- A real-device pass (iOS Safari, Android Chrome) is still owed: emulation cannot prove iOS hover emulation or
  address-bar resizes.
