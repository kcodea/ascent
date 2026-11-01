# 2026-11-01 — phone hero portraits rasterised at their drawn size (R-PHONE-HERO-LAYER-01)

Owner, phone, after #2492 / #2506: "Still seeing blurry hero art on mobile" (lobby shop, round 1).

**Measured first** (prod build, Playwright WebKit as an iPhone 852 x 393 @3x, page scale 0.385): every hero-art surface
already loads an image bigger than its drawn device px, except the hero pick ceremony.

| surface | drawn (device px) | image loaded | natural / drawn |
|---|---|---|---|
| hero select card | 261 | 512 master | 1.96 |
| hero pick ceremony portrait | 632 | 512 master | **0.81** (needs a bigger bundled master: art call) |
| your portrait (shop + combat) | 307 | 512 master | 1.67 |
| hero power medallion | 128 | 256 copy | 2.0 |
| Docked rail slice (x8) | 177 | 256 thumb (t2) | 1.45 |
| combat foe portrait | 296 | 512 master | 1.73 |

So more pixels was not the fix. **The cause is the compositor.** Your portrait is laid out ~73 stage px and magnified
by transforms: `.statusbar .hero` `scale(3.1)` x `.f` `scale(1.17)` = 3.6x; the combat foe by `.combatopp`
`scale(2.4)`. Chrome's layer tree (CDP, same walk) shows `div.hero` as its own composited layer (98 x 116 stage px,
screen scale 1.19) and in combat `div.combatopp-portrait` (112 px, screen scale 1.22). WebKit backs a layer at its
LAYOUT size x page scale x DPR (the same model `phone-run-memory.mjs` uses for the iOS memory estimate), then stretches
it on the GPU: ~84 device px of raster for a 307 px drawing. Chrome rasterises at the screen scale, so desktop and every
Chromium capture looked sharp; headless WebKit on Windows also looks sharp (a different compositor), so this could not
be reproduced in a screenshot, only in the layer model.

**Fix** (`styles.css`, phone only via `html.lite-art`): the two images are laid out 4x bigger (`width/height: 400%`,
negative margins hand the extra back to the flow), scaled back with `transform: scale(0.25)` from `0 0`, and given their
own layer (`will-change: transform`). Their raster is now 293 / 432 stage px (338 / ~500 device px), at least the drawn
size whether or not the browser accounts for ancestor scale. Drawn rects unchanged (266 x 266, 256 x 256). The factor 4
covers panelScale x portraitScale (3.63) and oppScale (2.4); `heroArtLayer.test.ts` pins that.

Rail slices and the power medallion: no magnified layer above them (their layers sit at the page scale or below), and
the images are 1.45x / 2x their drawn size, so nothing changed there.

**Budget** (`perf:phone-run --interact`): peak decoded images 136.0 MB (cap 140; run-to-run variance from random
heroes), peak iOS estimate 293 MB (before 292). The two new layers are ~0.5 MB each in the iOS model.

**Open:** the hero pick ceremony draws the portrait at ~632 device px from the 512 px master (0.81x). A bigger bundled
hero master (the sources are 1254 px) is an art-wiring call for the owner.
