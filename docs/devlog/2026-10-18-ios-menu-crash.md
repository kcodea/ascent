# 2026-10-18: iPhone crash on the menus (layer memory)

Owner report: on a recent iPhone (14 or newer), opened from the Home Screen icon, the live build (main b4746e35e)
showed Safari's "A problem repeatedly occurred" page on the menus. That page means iOS killed the page's WebContent
process, almost always for memory. Rule: R-TOUCH-MENU-MEMORY-01.

## Cause

The stage is laid out at about 2341 x 1080 and scaled to ~0.4 on an iPhone in landscape. iOS (WebKit) paints a
composited layer at the layer's own size times the device pixel ratio, 3, and an ancestor's scale-down does not
shrink it. So one full-screen layer costs about 87 MB.

Three gameplay Pixi FX canvases (`#root > .pixifx`, `canvas.pixifx-above`, and one more `pixiFx` instance) stay
mounted under the title and every menu page. A canvas is always its own composited layer, so every opaque menu layer
painted over it had to become its own full-screen layer too: the title, the mode home, the Versus / Practice page,
the backdrop (`.mbd`), the sidebars. The bobbing title logo (an infinite transform animation) did the same for
everything painted above it, and it kept running under the mode pages.

#2159 (the touch UI) made it worse but did not start it: zoomed pages reflow and scroll, the touch sidebar overflowed
sideways (a two-way scroller), and the Versus page kept the mode home and the whole title alive under it.

## Measured (prod build, headless Chrome as an iPhone, 932x430 @3x, iOS UA, touch)

Estimated iOS layer memory in MB (`npm run perf:phone-menus`: Chrome's layer list, each layer at its own size x 9 x 4
bytes, clipped to the visible part; WebGL canvases excluded). bcb = before #2158, 203 = before #2159.

| screen | bcbdfa7fc | 203d1bd00 | main b4746e35e | fix |
|---|---|---|---|---|
| title | 203 | 203 | 227 | 140 |
| mode home | 349 | 349 | 406 | 196 |
| Practice | 188 | 188 | 379 | 292 |
| Versus | 435 | 435 | 685 | 295 |
| Career / Leaderboard / Recent / Live | 276-279 | 276-279 | 295 | 209 |
| Compendium | 651 | 651 | 674 | 587 |
| hero select | 435 | 435 | 491 | 101 |

#2158 changed nothing here. The JS heap (25-37 MB), DOM size and decoded menu art (17-50 MB) are the same in every
build, and a 40 s soak on Career showed no growth. Chrome process memory does not reproduce the crash, because Chrome
rasterizes a scaled-down layer at its on-screen size: this is an iOS-only cost.

## Fix (touchUi.css, keyed off `html[data-touch-ui]`, so a mouse device is untouched)

1. While `#root` holds the title, a ladder page or a mode page, the three FX canvases get `display: none !important`
   (Pixi writes an inline `display: block`). Their renderers size to the window, so nothing resizes. The wipe canvas
   (already `visibility: hidden` between wipes) and the ranked gate canvas are not touched.
2. Under an open mode page, the title's `.titlemenu`, `.titleaccount` and `.titlefoot` are `visibility: hidden`, and so
   is the mode home under another mode page.
3. The touch sidebar is `overflow-x: hidden`.

All of it hides only what an opaque menu already covers: the screenshots before and after match.

## Guard

- `npm run perf:phone-menus` (scripts/phone-menu-memory.mjs): serves `apps/web/dist`, visits every menu screen as an
  iPhone, prints the per-screen estimate and the biggest layers, exits 1 over budget (350 MB a screen, 650 MB for the
  Compendium). Every request off 127.0.0.1 is blocked. main b4746e35e fails it (Practice 379, Versus 685).
- `touchUi.test.ts` checks the rules exist, keep `!important`, and never touch the wipe or gate canvases.

## Follow-ups

- Practice is still above its pre-#2159 level (292 vs 188): its zoomed options overflow, so the page scrolls, and the
  fixed backdrop inside the scroller takes its own 87 MB layer. Options: a lower page zoom for Practice, or moving the
  backdrop out of the scroller.
- The Compendium (587) predates the touch UI: the book frame `::after` has `will-change: transform` (77 MB at 3x) and
  each visited card cell holds a `will-change` layer (~7 MB each at 3x).
- `#stage` itself is a full-stage layer (87 MB) on every screen.
- Not confirmed on a real iPhone. The numbers are a WebKit model built on Chrome's layer list.
