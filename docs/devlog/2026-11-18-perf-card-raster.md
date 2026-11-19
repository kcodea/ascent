# 2026-11-18 — Card raster: the cards were being painted again, not their filters

Branch `perf/card-raster`. Owner bar (2026-11-18, top priority): over 240 fps (frames at or under 4.17 ms) at all
times, no hitching, most of all in the recruit phase. The scope's measured top cause
(`.claude/perf-scope-2026-11-18/E1-measurements.md`, cause 1) was "CSS filters and shadows on cards are re-rasterised
on the GPU on every buy, refresh and stat tick", and the brief was to bake those filters into images.

**What the measurement said instead:** the filters are not the cost. The cost is that every card is painted again
whenever anything near it changes. Fix that, and the filters stop mattering: with every filter, shadow and text
shadow removed from every card, GPU raster moves by under 10%. So this PR ships the isolation (three selectors of
CSS) and does **not** bake anything. Rule: `R-PERF-CARD-LAYER-01`. Test: `packages/ui/src/cardLayer.test.ts`.

## How it was measured

`scripts/perf-card-raster.mjs` (new). A production bench bundle (`VITE_PERF_BENCH=1`) served from disk on
127.0.0.1:5251, the installed Chrome headless with hardware GL (`ANGLE (NVIDIA GeForce RTX 4080 SUPER, Direct3D11)`),
a throwaway profile, every request to `supabase.co`, `supabase.in` and `workers.dev` blocked. 1920 x 1080, DPR 1.

One late-game recruit state, built through the game's own actions in a Practice game (tier 6, buy and play until the
board holds 7 and the hand 10, then the stats written): board stats 60 to 6,100 so every milestone badge tier is on
screen, two Gilded bodies, Ward / Rally / Venomous among the keywords, 6 Shop offers. The scenes, each repeated:

- **buy**: buy the first Shop minion (hand at 8), 0.5 s window
- **refresh**: roll the Shop, 0.5 s window
- **tick**: +1/+1 on one board minion every 70 ms (the badge pop plays each time)
- **sell** / **play**: sell the right-most board minion, then play a hand minion, 0.5 s windows
- **idle**: 2 s of nothing

A variant is an injected stylesheet, and the variants are run in turns in the same page (base, A, B, base, A, B), so
drift on a shared machine lands on all of them. **The machine was shared with five other building sessions for the
whole day**: CPU sat between 60% and 100%, and in the worst runs the frame clock itself ran at about 170 Hz instead of
240 Hz (the median frame reads 5.6 to 6.0 ms, and "over 4.17 ms" reads 100%). Read the ratios between variants of the
same run, not the absolute numbers, and never one run against another. "Over 6.25 ms" means at least one dropped
240 Hz frame.

## 1. The inventory

Computed styles on every card of that state and every descendant (`--dump`; `filter`, `box-shadow`, `text-shadow`,
`mask`, `mix-blend-mode`, pseudo-elements included). Per card, on average:

| zone | filtered elements | filter primitives (visible) | text-shadow elements | masks | blend modes |
|---|---|---|---|---|---|
| Shop | 9.9 | 14.1 (11.1) | 1.9 | 3.0 | 1.0 |
| board | 15.1 | 20.1 (17.1) | 2.0 | 3.6 | 1.7 |
| hand | 12.7 | 19.3 (12.3) | 8.3 | 2.9 | 2.0 |

The ones on every card: the frame's `brightness(1) drop-shadow(0 4px 6px)` (Gilded adds a gold `0 0 4px`), the
contact-shadow copy of the frame `brightness(0) blur(7.2px)`, a `drop-shadow(0 2px 4px)` on each of the two milestone
badge frames (every badge has a frame: tier 1 starts at 0), a text shadow on each stat number, `drop-shadow(0 1px 2px)`
on the tier plate and on the tier stars, the medallion's `drop-shadow(0 2px 3px)` over its `grayscale(0.71)` image,
the hover glow (three stacked drop-shadows at opacity 0, and a masked rim with `blur(0px)`), the frame tint (masked,
`mix-blend-mode: overlay`, opacity 0). From 500 in a stat: a `blur(9px)` glow disc per badge. Hand cards add: the
card name's SVG filter (`#cn-gild-N`: three `feMorphology`, two `feGaussianBlur`, five flood / composite pairs, a
six-way merge), triple and double text shadows on the tribe line and the rules text, `mix-blend-mode: overlay` on
the text backbox, a drop-shadow on the name divider, the plate glow (four drop-shadows at opacity 0). The silver
`--frame-tone` (`grayscale(0.92) brightness(1.2) contrast(0.9)`) the brief wanted baked is all but dead: every tribe
has had its own oval and its own Taunt shield since 2026-07, so only a card with no tribe frame takes it.

## 2. One at a time, they are each worth a little

Same page, each row one stylesheet (frames over 6.25 ms; one run, two passes each, a loaded machine):

| variant | buy | refresh | tick | sell | play |
|---|---|---|---|---|---|
| main | 43.3% | 15.4% | 35.0% | 26.6% | 24.8% |
| every filter / shadow / text shadow off, whole page | 11.6% | 3.8% | 4.4% | 2.0% | 3.1% |
| the same, cards only | 31.6% | 5.9% | 23.6% | 3.2% | 2.2% |
| frame drop-shadow off | 41.1% | 9.7% | 27.7% | 24.4% | 21.7% |
| contact shadow copy off | 40.8% | 17.8% | 32.6% | 25.0% | 23.7% |
| badge frame shadow, glow disc and number shadow off | 37.2% | 15.8% | 28.4% | 17.7% | 20.6% |
| tier / medallion / divider shadows, art tone off | 48.3% | 12.4% | 15.2% | 20.1% | 19.1% |
| hover glow, plate glow, tint layers hidden | 41.4% | 12.0% | 10.9% | 23.7% | 23.0% |
| hand name filter, hand text shadows, backbox blend off | 28.0% | 5.6% | 10.2% | 25.0% | 24.0% |
| **`will-change: transform` on every card, nothing removed** | **12.6%** | **7.8%** | **16.6%** | **1.8%** | **2.0%** |

No single filter is the cause, and one line that removes none of them does as well as removing all of them. That is
the finding.

## 3. Why

Chrome paints the page into tiles, and with GPU raster a tile is about as wide as the window. Every Shop card shares
one band of tiles, every board card another, the hand a third with the HUD around it. A static filter costs nothing
while its tile is left alone. A buy, sell, play or refresh moves cards, so their tiles are painted again, and that
means every card in the band: its 14 to 25 effects, and its art sent to the GPU again. The cards that did not change
are almost all of the work.

Give a card its own compositor layer and it is painted when it arrives and again only when its own pixels change.
A neighbour sliding over is a compositor move.

GPU process main thread, one traced pass of tick + refresh + buy (about 30 s each), two passes:

| | busy | raster flush + deserialise |
|---|---|---|
| main | 22.9 s / 27.0 s | 10.4 s / 9.8 s |
| a layer per card | 18.7 s / 23.2 s | 5.1 s / 4.9 s |
| a layer per card, every card filter and shadow off | 19.2 s / 25.0 s | 4.7 s / 4.6 s |
| a layer per card, every filter and shadow on the page off | 15.9 s / 19.7 s | 3.9 s / 4.4 s |
| a layer per card, frame drop-shadow and contact shadow off | 19.8 s / 22.1 s | 5.1 s / 5.0 s |

Raster halves from the layers alone. Taking every filter off every card after that buys 9%; taking the two big frame
filters off buys nothing measurable. **That is why nothing is baked.** A baked shadow would also not be the same
picture: every radius on a card is a fixed number of pixels (`blur(7.2px)`, `0 4px 6px`) while the card scales with
the window (`--ccw` is 138 px at 1080p and 184 px at 1440p), so an image baked at one size is right at one window
height and visibly tighter or looser at every other. It would have needed the owner's sign-off for a 9% gain.

The page also holds FEWER layers with the rule than without (106 against 121; 18.4 against 19.9 megapixels): the
cards used to push each other's overlapping pieces into extra squashed layers.

## 4. What shipped, and the three things measured wrong on the way

```css
.zone[data-zone='tavern'] .row > .card,
.zone[data-zone='warband'] .row > .card,
.zone[data-zone='hand'] { will-change: transform; }
```

A layer per Shop card, a layer per board card, ONE layer for the hand.

- **Not a layer per hand card.** It measures best (buy 6 to 15%), and it is visibly wrong: a hand card's fan
  transform is a rotation plus a fraction of a pixel, and a card on its own layer is drawn from its texture through a
  second resample. Laplacian energy of the ten hand cards at rest dropped 7 to 21% (17 to 21% on nine of them), and
  the names and stat numbers are soft at a glance in a 2x crop. Inside the zone's layer the cards are painted directly,
  as before, and the hand is pixel-identical (under 1.1% of pixels move by more than 2 levels, none by more than 20;
  sharpness within 0.4%).
- **Not `will-change: opacity`.** It keeps a card's sub-pixel position exactly, which is the point of it, and that
  means the card is painted again every time it moves. Buy 33.1% against main's 28.1% in the same run: no gain.
- **No layers for the stat badges or their numbers** under the card layer. 195 layers instead of 112, and every scene
  slower than the card layer alone (buy 11.0% and 17.0% against 6.0%).

In-page A/B, frames over 6.25 ms (and frames over 16.7 ms), three passes each:

| | buy | refresh | tick | sell | play | idle |
|---|---|---|---|---|---|---|
| **main**, the rule injected: before | 38.6% (177) | 16.8% (91) | 31.6% (48) | 22.1% (33) | 23.3% (66) | 4.8% (0) |
| after | 26.1% (131) | 9.7% (63) | 16.7% (13) | 6.5% (12) | 8.8% (52) | 3.5% (0) |
| **the branch build**, the rule removed: before | 44.1% (149) | 10.9% (63) | 29.3% (21) | 23.2% (22) | 24.2% (61) | 1.1% (0) |
| after | 30.9% (104) | 12.8% (67) | 5.2% (26) | 2.3% (3) | 6.1% (44) | 2.3% (0) |

Mean frame, the branch build: buy 7.92 to 6.15 ms, sell 5.52 to 4.32, play 6.21 to 4.83, tick 5.64 to 4.43, refresh
5.01 to 5.12 (no change), idle 4.21 to 4.27 (no change). The first pair ran with the frame clock at about 170 Hz
(median frame 5.6 to 6.0 ms), the second at 240 Hz.

**A sell, a play and a stat tick are close to fixed. A buy is a third to two thirds of what it was, depending on the
run, and a refresh moves little.** Neither is at the bar.

## 5. What a buy still costs

The hand. A buy adds a hand card, the others glide to make room (a transform transition, which lifts each card onto
a layer of its own for 140 ms and drops it back), and the hand's layer is painted again at both ends: about twenty
hand-card paints per buy. One more pass on the branch build, on a quiet machine (frame clock at 240 Hz; frames over
6.25 ms, and over 16.7 ms):

| the branch build, plus | buy | sell | play |
|---|---|---|---|
| nothing (what ships) | 11.3% (39) | 3.2% (2) | 4.5% (17) |
| the rule removed (main) | 32.7% (76) | 22.5% (13) | 22.5% (38) |
| hand: every filter, shadow, text shadow and blend off | 3.7% (18) | 1.4% (0) | 1.5% (9) |
| hand: name filter off | 24.6% (43) | 3.1% (3) | 4.9% (20) |
| hand: rules-text and tribe-line text shadows off | 14.2% (35) | 3.4% (2) | 5.8% (25) |
| hand: backbox blend off | 20.2% (67) | 2.8% (0) | 4.2% (16) |
| hand: a layer per card (soft, see above) | 7.2% (27) | 1.1% (0) | 2.6% (10) |

(The three single-effect rows are inside the noise of this run: their two passes disagree by more than the rows
differ.) In the hand the effects do still cost, because the hand is the one place that is still painted again as a
whole: 11.3% to 3.7% with all of them off. No one effect carries it. The clean fix is the one in section 7 (a sharp
layer per hand card), which removes the repaint instead of making it cheaper.

## 6. The picture: what was compared, and the two differences

`scripts/perf-card-raster.mjs --shots` and `scripts/perf-card-raster-diff.mjs` (new). Main's build against the
branch's build, the same state plus two Taunt bodies (one Gilded): the Shop alone, the board alone, the hand alone,
each at rest, with a card hovered (its preview open; the hand card popped), again at rest after the hovers, and with
a card held mid-drag. Infinite animations parked at their first frame, GSAP and the FX ticker paused. Contact sheets
(before | after | difference x8, one row per card) are in `shots/`.

**Noise floor** (main against main, two launches): identical to the last level everywhere except the three board
cards whose badges carry running Pixi effects (2.8%, 8.0% and 11.1% of their crop over 2 levels).

**The hand: identical.** All ten hand cards at rest, the hovered hand card, the hand after the hover and the dragged
hand card: no pixel differs by more than 2 levels (one card: 0.2% of its crop, largest difference 12), and the
sharpness of every hand card is unchanged to 0.0%.

**Shop and board cards: two differences, both listed for the owner.**

1. **Each card sits on whole pixels.** The centred rows put cards at fractions of a pixel (428.45, 296.33). A layer
   sits on whole pixels, so the card lands up to half a pixel from where it was. In a pixel diff that touches every
   edge in the card (30 to 62% of a crop moves by more than 2 levels, as any half-pixel shift does), and the eye
   cannot see it: sharpness (Laplacian energy) of the fourteen cards is within -3.1% and +0.6%, eleven of them within
   0.7%. The same at 2x. The hover glow, the preview and the dragged copy are unchanged apart from that shift under
   them.
2. **Where two neighbours overlap, the later card now draws over the earlier one.** A Shop / board card is a stacking
   context now; before, the pieces of neighbouring cards sorted against each other by z-index (every badge above every
   frame). Measured apart from the shift (the same cards with `isolation: isolate`, which changes the order and makes
   no layer): one sliver about 3 x 40 px where a Ward bubble meets the next card's frame, at most 36 levels, 0.7% of
   that crop over 8 levels. A tall milestone badge beside a neighbour's contact shadow is the other place it can show.

Nothing else moved: no change in text anti-aliasing, glow, shadows or badge order within a card.

**What was not captured, and why.** `Page.captureScreenshot` never returns in this headless Chrome once the page
holds more than about 20 cards (4 board + 10 hand + 6 Shop captures; 5 + 10 + 6 hangs; so does everything at DPR 2 at
1920 x 1080). That is why the three rows are captured apart, and why the 2x pass runs in a 960 x 540 window (the same
1920 x 1080 device pixels). The full screen with all 24 cards up was captured only on the branch-shaped page, where it
no longer hangs. See section 7.

## 7. Things found on the way (not fixed here)

- **The page sits on 180 MB of GPU image cache in this state** (`gpu/transfer_cache`, memory-infra dump; 184 MB of
  Skia GPU resources; single mipped textures of 41.9, 10.5 and 8 MB). The capture hang above appears with content, not
  with any one element: 7 board cards with no hand capture, 7 with the hand and no Shop capture, 5 with both hang, and
  one more hovered preview is enough to tip a page that captured a moment before. It behaves like a budget. If Chrome's
  image cache is over its budget here, every repaint of a tile decodes and uploads its images again, which would be
  why raster "deserialise" is a third of raster time (it is where inline image data lands). I could not confirm it: the
  image-level trace categories stalled this machine. It is the first thing I would measure next, and the phase-decode
  work is the place for it.
- **Combat units can take the same rule.** `.unit` is already a stacking context in combat (`:where(.app.combat) .unit`
  has a z-index), so `will-change: transform` on it changes no order. Not done here: `Unit.tsx` and the combat ladder
  belong to perf/combat-render, and there is no combat scene in this bench.
- **A hand card on a layer of its own is the remaining prize for a buy** (7% against 11% in the quiet run of section 5). It needs
  the fan rotation moved INSIDE the layer (an inner wrapper that carries `rotate(var(--fan-rot))`, the card itself
  keeping only the translate), so the layer is drawn square-on and stays sharp. That is a markup change in `Card.tsx`
  and a pass over every `.card >` selector, so it is its own PR.
- **Hand cards are already soft for 140 ms** on every hand change today: the make-room glide is a transform
  transition, which puts each card on its own layer for its length. Nobody has reported it. It is the same softness
  measured above, in motion.
- The bench's fixed spending lit the Gold Fuse in E1's runs; this one keeps `goldSpentThisTurn` far below zero.

## Re-measuring

```
VITE_PERF_BENCH=1 npm run build:web
node scripts/perf-card-raster.mjs --dist apps/web/dist --variants v.json --reps 12 --cycles 3 [--trace]
node scripts/perf-card-raster.mjs --dist apps/web/dist --shots out/a --tag a --no-bench
node scripts/perf-card-raster-diff.mjs --a out/a --atag a --b out/b --btag b --out shots
```

`v.json` is `[{ "name": "...", "css": "..." }]`. To see the rule's worth on a build that has it:
`.zone[data-zone='tavern'] .row > .card, .zone[data-zone='warband'] .row > .card, .zone[data-zone='hand'] { will-change: auto !important; }`.
