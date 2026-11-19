# 2026-11-19 — Card raster 2: a sharp layer per hand card; what a refresh still costs

Branch `perf/card-raster-2`, stacked on `perf/card-raster` (PR #2791). Owner bar: over 240 fps (frames at or under
4.17 ms) at all times, recruit first; worst case a fast engine turn. #2791 gave every Shop and board card its own
layer and the hand ONE layer, and left a buy repainting the whole hand. This PR gives each hand card its own layer
without the softness that ruled it out last time. Rule: `R-PERF-HAND-LAYER-01`. Test: `packages/ui/src/cardLayer.test.ts`.

## How it was measured

`scripts/perf-card-raster.mjs`, as in `2026-11-18-perf-card-raster.md`: a production bench bundle, headless Chrome
with hardware GL (RTX 4080 SUPER, D3D11), 1920 x 1080, one late-game recruit state (tier 6, board 7 with stats 60 to
6,100, hand 10, Shop 6), variants as injected stylesheets run in turns in the same page. **The build measured is the
integration of the eight performance PRs of 2026-11-18 (`perf/integration-bench` f2c495441) plus this branch**, so
the gains below are on top of all of them. The machine was quiet for these runs (idle: 0.0% of frames late).

New in the script: `--scenes engine` (the ENGINE TURN: 60 actions at 4 a second, sell / buy / play with a roll when
the Shop runs dry, and every action also ticks all seven board cards' stats), and `--trace-main` (the page's main
thread by event, and what is inside each task over 4 ms).

On a 240 Hz frame clock a late frame lands on the next tick (8.3 ms), so "over 4.17 ms" and "over 6.25 ms" are the
same number to 0.1 of a point in every row; one column is shown.

## 1. Why a hand card on its own layer was soft, and what fixes it

A compositor layer is a picture. Drawn with the fan's tilt (up to 7 degrees) and a fraction of a pixel of offset, it
is resampled, and a 1:1 picture resampled loses its edges. Laplacian energy of the ten hand cards against the same
cards painted directly, same page:

| hand card layer | at rest | hovered (popped, 1.47x) |
|---|---|---|
| a 1:1 layer (`will-change: transform` on the card: what #2791 measured and refused) | -24% to -34% | same as direct |
| the tilt moved INSIDE an untilted layer (the fix #2791 proposed) | -12% to -20% (the layer still sits on a fraction of a pixel), and a buy still repaints every card, because every card's tilt changes when the count does | not measured |
| layer rastered at 1.25x | -5% to -18% | same as direct |
| **layer rastered at 1.35x (shipped)** | **-8% to +5% (mean -1%)** | **same as direct** |
| layer rastered at 1.4x | -5% to +10% | same as direct |
| layer rastered at 1.5x (the first builder's pick) | +3% to +21% (an earlier page: +9% to +27%) | identical (0.00% of pixels over 2 levels) |
| layer rastered at 2x | +80% to +104% | -6% if drawn from the texture |

(The 1.25 / 1.35 / 1.4 / 1.5 rows are one session: the same build, the same state, the factor switched by a stylesheet,
each against every layer rule off. Crops at 4x: `x4-recruit-h@1x-off_on_ss135_ss14_ss125.png` in the PR's evidence.)

The texture is made larger than the card, so the tilt is drawn DOWN from it. Two wrappers inside the hand card do it:
`.card-ssl` is the layer, drawn at `scale(1 / 1.35)`; `.card-ss` inside scales the body back by 1.35. Chrome never
rasters a `will-change: transform` layer below 1:1 in its own space, so the texture holds the card at 1.35x. 1.35 is
the factor whose result is closest to a directly painted card (some cards a touch softer, some a touch crisper, the
mean at -1%), which is the bar: the hand must look as it does today. The first builder shipped 1.5, which measured
3 to 27% crisper than today: a change of look, so it was brought down. 1.35 is also 1.82 times the card's pixels
instead of 2.25, and measured the same frames as 1.5 (section 2).

The hovered card is the one the player reads, so it is not drawn from the texture at all: on hover both scales drop
to `none`, the layer is rastered again at the pop's own size, and the popped card is the same picture as before to
the last pixel. That is two single-card paints per hover (the zone layer used to paint all ten cards, twice).

Everything that moves a hand card stays on `.card` itself, which is NOT the layer: the tilt, the tuck, the make-room
glide (`--hand-glide`), the reorder slide (`handSlidePx`), the hover pop, GSAP Flip, the summon and coalesce effects.
None of them had to change, and none of them can repaint the card now.

Not on phones (`html.lite-art`): ten more textures is memory a phone does not have. There, and in any clone of a hand
card outside the hand row (ghosts, the pass lob), the wrappers are `display: contents`.

**Found on the way: #2791's one hand layer can itself go soft.** In one page the hand zone's layer held seven of the
ten cards 30% softer than a direct paint for as long as nothing forced it to be painted again (two captures seconds
apart, a hover in between); toggling the rule off and on cleared it. With a layer per card the zone's layer holds no
card pixels, so this cannot happen.

## 2. Frames

**First builder, quiet machine** (the eight-PR integration build plus this branch at 1.5x). Same page, three variants
in turns, two cycles (8 reps a cycle). Share of frames that missed 240 Hz; mean frame.

| scene | no card layers (main's behaviour) | #2791 (hand = one layer) | this PR |
|---|---|---|---|
| **engine turn** (60 actions in 15 s) | 32.2%, 6.90 ms (145 fps) | 13.8%, 5.18 ms (193 fps) | **5.2%, 4.51 ms (222 fps)** |
| engine turn, p95 frame | 20.8 ms | 12.4 ms | 8.2 ms |
| engine turn, frames over 16.7 ms (two 15 s turns) | 285 | 106 | 28 |
| buy | 22.6% | 3.2% | **1.8%** |
| play | 14.0% | 3.3% | **1.1%** |
| sell | 12.4% | 0.7% | 0.5% |
| refresh | 3.4% | 1.2% | 1.5% (no change: both halves of both variants sit between 1.2% and 1.8%) |
| idle | 0.0% | 0.1% | 0.0% |

A second, traced run (tracing slows every variant) agrees: buy / play / sell 1.8% / 1.4% / 0.8% against 3.6% / 4.0% /
2.8% for #2791. Two more untraced engine turns on this build read 5.4% and 6.2% (221 and 218 fps).

GPU process main thread, one traced pass of buy + sell / play + tick, two passes each:

| | busy | raster (flush + deserialise) |
|---|---|---|
| no card layers | 15.2 s / 17.0 s | 9.8 s / 10.6 s |
| #2791 | 11.4 s / 11.7 s | 5.5 s / 5.5 s |
| this PR | 10.2 s / 8.8 s | **3.8 s / 3.3 s** |

Layers: 94 (70 drawing, 19.8 megapixels) against #2791's 77 (61, 18.2) and main's 92 (78, 19.9). Ten more layers,
1.6 megapixels more texture.

**Re-measured 2026-11-19 by the second builder, on this branch alone** (stacked on #2791, without the other seven
performance PRs), at 1.5x (`base`) and 1.35x (`k135`, the shipped factor, by stylesheet). The machine was NOT quiet:
two other builders' benches ran in the same minutes, so every column carries more noise than the table above; the
variants still ran in turns, so the noise lands on all of them. Two runs, share of frames that missed 240 Hz:

| scene | no card layers | #2791 (`zoneOnly`) | this PR at 1.5x | this PR at 1.35x (shipped) |
|---|---|---|---|---|
| buy (run 1 / run 2) | 28.5% / - | 14.3% / 14.9% | 4.1% / 8.1% | 14.4%* / **7.7%** |
| play | 21.3% / - | 4.6% / 4.7% | 1.2% / 2.5% | 4.8%* / **2.2%** |
| sell | 22.4% / - | 1.0% / 5.5% | 1.7% / 6.2% | 2.2% / **3.6%** |
| engine turn | 43.1% / - | 16.8% / 21.7% | 16.9% / 17.7% | 23.1%* / **16.6%** |
| engine turn, frames over 16.7 ms | 354 / - | 146 / 390 | 104 / 237 | 192* / 277 |
| refresh | 4.9% / - | 2.9% / - | 4.2% / - | 9.7%* / - |
| idle | 0.4% / - | 0.0% / 1.3% | 0.0% / 0.2% | 0.1% / 0.5% |

\* run 1's 1.35x column caught a stall from the other benches in its second cycle (max frames of 250 to 340 ms, its
second half 22 to 39% late in every scene against 3 to 15% in its first). Its first halves: buy 5.0%, play 2.5%,
engine 14.6%, against the 1.5x column's first halves of 5.9%, 1.5%, 19.8%.

What holds across both builders: a buy and a play miss about half as many frames as with #2791 alone, a sell is
unchanged, and 1.35x performs like 1.5x. The engine turn's gain over #2791 is clear on a quiet machine (13.8% to
5.2%) and small to nothing in a busy one (16.8% / 21.7% to 16.6% / 17.7%): it should be re-run quiet before it is
quoted as a headline number. Layers: 123 (98 drawing, 19.6 megapixels at 1.35x, 20.0 at 1.5x) against #2791's 106
(89, 18.4).

## 3. The picture

`main` here means every layer rule off in the same page; all captures with looping animations parked. The bullets
below are the first builder's (at 1.5x). At the shipped 1.35x the resting cards measure -8% to +5% in edge energy
against `main` (section 1) and the hovered card the same as `main`. Captures at 2x device pixels did not return in
the second builder's session (`Page.captureScreenshot` hangs at DPR 2 in this headless Chrome with the machine
loaded), so 1.35x is proven at 1x only.

- **At rest, 1x and 2x device pixels:** the ten hand cards are the same picture, 9 to 27% higher in edge energy
  (10 to 28% at 2x). A pixel diff touches about a third of each card by more than 2 levels, as any resample does;
  nothing is displaced. Side by side at 4x the art, the frame, the name and the stat numbers read the same, a touch
  crisper.
- **Hovered:** identical (0.00% to 0.01% of pixels over 2 levels, largest difference 3).
- **A hand card held mid-drag, the rest parted:** the same as at rest.

Not captured: a hand card with a keyword aura (the bench hand has one Ward card; its bubble animates, so its numbers
are noise in every variant, this one included), a locked card, the Triple Reward arrival. They are the same DOM
inside the same wrapper, and worth an eye in a real game.

## 4. Refresh: profiled, and nothing shipped

A refresh is now about two late frames per roll (1.2% to 1.8% of a 0.5 s window) with every variant. Where they go
(`--trace-main`, per roll; tracing inflates each figure by roughly a third):

- **One main-thread task of 9 to 12 ms** at the roll: script 5 to 6 ms (the reducer is 1.0 to 1.3 ms of it; the rest
  is React rendering Recruit and mounting five to seven cards), style for the roughly 220 new elements 3 ms, image
  requests for their roughly 60 `<img>`s 2 ms, layout 0.5 ms.
- **The next frame's paint**: paint 2 ms, layer update 2 ms, hit-test data 1.4 ms.
- About 23 image decodes per roll on worker threads (0.6 to 3.2 ms each): the new cards' art at the size it is drawn.

**Tried and rejected: mounting the new Shop cards over several frames** (the first card at once, then one per 240 Hz
frame, placeholders holding the slots). Refresh late frames: 1.5% / 1.7% before, 1.5% / 2.1% after. Every commit pays a
fixed 2.5 to 3 ms of style and 2 ms of paint and layer update however few cards it mounts, so six small commits are
six frames at 7 ms instead of one at 12. The code is not in this PR.

What would move it, in order of what the profile says:

1. **Style cost per element.** 220 elements cost 3 ms because about 1,270 selectors are tried on each. Rules whose
   last part is `:is(.a, .b)` cannot be bucketed by class, so each is tried against every element restyled (3,500 to
   17,800 attempts per five rolls for rules that match nothing). A build step that splits a trailing `:is()` into
   plain selectors would cut this for every action, not only a roll. It changes specificity, so it needs its own PR
   and a full visual pass.
2. **The milestone badge effect reads layout every frame.** `fx/milestoneBadgeFx.ts` follows each badge at 5,000 or
   more with `getBoundingClientRect` per frame: 0.23 ms of every 4.17 ms frame with three such badges, always on.
   Flagged as its own task.
3. **The card frame images** (6 MB decoded each): `perf/frame-size`, the next PR in this stack.

## Re-measuring

```
VITE_PERF_BENCH=1 npm run build:web
# v.json: [{ "name": "zoneOnly", "css": ".card-ssl, .card-ss { transform: none !important; will-change: auto !important; }" }]
node scripts/perf-card-raster.mjs --dist apps/web/dist --variants v.json --reps 8 --cycles 2 --scenes buy,refresh,sellplay,engine,idle
node scripts/perf-card-raster.mjs --dist apps/web/dist --scenes refresh --trace --trace-main
```
