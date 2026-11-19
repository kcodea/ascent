# 2026-11-18 — Keyword auras: one picture per aura instead of 10 to 40 animating layers per card

Owner bar (2026-11-18, top priority): over 240 fps (frames at or under 4.17 ms) at all times, no hitching, the recruit
phase above all. Rule: **R-PERF-KEYWORD-AURA-01**. Playbook: `docs/performance.md` §3p.

## The measured cause

The perf scope's keyword scene (E1 cause 2 and 5, S4 F3, S3 F8): four keyword auras are DOM stacks of looping CSS
animations, per card.

| aura | live markup, per card | layers / running animations added per card (measured) |
|---|---|---|
| Rise (`R`) | a dome + 27 wisps, every one `mix-blend-mode: screen` | +34 / +28 |
| Execute (`V`) | 3 comet rings + 12 shards of 3 moving pieces + a flicker | +32 / +40 |
| Flurry (`W`) | 7 spinning rings in 7 squash wrappers (5 of them masked) | +26 / +8 |
| Rebirth (`RB`) | crown: a glow, 3 cross-fading flame frames, 5 embers (+ the veil) | +20 / +10 |

They show wherever a compact card does: shop, board, hand, combat units, Discover options, the Compendium and the menu
boards. All of them followed the existing rules (transform and opacity only, static paint on a child). The cost is the
COUNT: a layer each, a main-thread animation tick each while any `requestAnimationFrame` loop runs (§3o), a render pass
per blended or masked layer.

Two things found on the way:

- **The blend modes were blending with nothing.** Each aura root carries a transform, so it is a stacking context: its
  screen-blended children blend only with each other, never with the card under them. The group is a plain RGBA
  picture. That is what makes a transparent capture exact, and it means the 28 blend passes per Rise card bought
  nothing the eye could see against the art.
- **Flip-book atlases do not work here.** The loops are long (Execute's rings and shards never repeat) and a stepped
  `transform` over an atlas needs an atlas-sized layer PER CARD: 56 megapixels for one Execute loop. An animated image
  is the one primitive the browser decodes once and shares between every element showing it.

## The fix

The authored DOM + CSS aura stays, untouched, as the source of truth and the tuning surface. Players see a CAPTURE.

- `scripts/kwfx/capture.mjs` plays the live aura on a real card in headless Chrome (real GPU), hides everything else,
  lifts the ancestors' clips, and photographs one loop frame by frame on a transparent page. Each CSS animation is
  seeked by hand to `t * n * D / L` (D its period, L the loop, n the nearest whole number of cycles), so every animation
  completes whole cycles and the last frame meets the first. A ring of k identical blades is rounded on its blade
  period. The frames become one animated AVIF per aura plus a WebP still of frame 0, in `apps/web/public/kwfx/`, and a
  manifest (`packages/ui/src/kwfx/manifest.json`: box size in card widths, frames, bytes, the largest period change).
- `packages/ui/src/kwfx/kwfx.ts` + `Card.tsx`: `RiseAura`, `FlurryAura`, `ExecuteAura` and `RebirthCrown` render
  `<div class="kwfx kwfx-…">` (one `will-change` element, the picture chosen by class in `styles.css`, the box sized
  from the manifest and seated on the live aura's centre). Rise sits inside `.art` as before, so the oval or the Taunt
  heater still clips it; the three Rise tints are three pictures picked by the card's `risetint-*` class.
- The live markup renders instead: until every picture has loaded (so nothing is ever blank, and a browser without an
  AVIF `ImageDecoder` keeps the live aura for good); while a DEV tuner has moved Execute or Rebirth away from the
  shipped values; with `localStorage['ascent.kwfx'] = 'live'`; under test; and **on phones** (see Open items).
- The wisps' and embers' scatter is now SEEDED (it was `Math.random` at module load, a different cloud every page
  load), so the live aura and its picture are the same set and can be differenced frame for frame.
- Pausing. An animated image cannot be paused, so wherever the live loops were paused the box shows the still: a board
  covered by a full-screen choice (`body.modalup`: Discover, Runeforge, an Ancient's offer, a scouted board), far menu
  rows, menu boards not pointed at, and `prefers-reduced-motion`. Off-screen and hidden-tab pictures do not advance
  (the compositor only animates what it draws). In a fight no shop aura is mounted at all (checked: 0 aura elements
  outside `.unit`).
- A re-bake is forced: `kwfx.test.ts` recomputes a signature over the aura sources (the CSS between the `KWFX-LIVE`
  markers, the aura components in `Card.tsx`, `executeConfig` / `flurryConfig` / `rebirthConfig` / `rebirthCrown`,
  comments and whitespace stripped) and fails while the manifest's differs. `capture.mjs --stamp` re-stamps after an
  edit that does not change the look.

Assets added: 7 animated AVIF (2.99 MB together at 60 a second since 2026-11-19: rise 0.31 + 0.29 + 0.24 MB, flurry 0.17, execute 0.31, rebirth 0.82 + 0.86; 1.82 MB in the first cut at 30) and
7 WebP stills (70 KB). Fetched once, about 1.5 s after boot, on desktop only. The same Rise frames as an animated WebP
were 2.7 MB against 0.18 MB as AVIF.

## Numbers

PROD bench build (`VITE_PERF_BENCH=1`), headless Chrome on the real GPU (ANGLE D3D11, RTX 4080 SUPER, 240 Hz), 1920 x
1080, a Practice shop with 7 board + 7 hand minions, the keyword set on all 14, idle. Median of 3 samples of 4 s; the
three means are in brackets. **Other builders were running on the machine**: main-thread ms/s moves by +-40% between
passes of the same build (the no-keyword scene read 113, 125, 155 and 234 ms/s), so read the frame times and the exact
counts, not the third digit of the ms/s.

| 14 cards carry | layers before -> after | CSS animations before -> after | idle frame ms before | idle frame ms after | over 6.25 ms before -> after | main thread ms/s before -> after |
|---|---|---|---|---|---|---|
| nothing | 73 -> 73 | 7 -> 7 | 4.18 (4.24, 4.18, 4.17) | 4.21 (4.23, 4.21, 4.17) | 0.1% -> 0.2% | 124 -> 155 |
| Rise | 549 -> 143 | 399 -> 7 | 20.06 (18.76, 20.06, 20.37) | 4.17 (4.26, 4.17, 4.17) | 100% -> 0.1% | 734 -> 140 |
| Flurry | 439 -> 129 | 119 -> 7 | 11.18 (11.89, 11.18, 10.13) | 4.17 (4.26, 4.17, 4.17) | 94% -> 0.1% | 299 -> 115 |
| Execute | 520 -> 114 | 567 -> 7 | 25.25 (25.25, 22.2, 27.84) | 4.17 (4.24, 4.17, 4.17) | 100% -> 0% | 664 -> 130 |
| Rebirth | 346 -> 171 | 147 -> 21 | 4.33 (4.98, 4.33, 4.24) | 4.20 (4.29, 4.2, 4.18) | 3.4% -> 0.4% | 639 -> 189 |
| Rise + Flurry + Execute | 1301 -> 171 | 1071 -> 7 | 43.68 (43.68, 45.23, 43.62) | 4.18 (4.27, 4.18, 4.17) | 100% -> 0.2% | 728 -> 139 |
| a mix, 2 keywords a card | 530 -> 136 | 353 -> 15 | 13.47 (13.47, 13.98, 13.08) | 4.27 (4.27, 4.33, 4.22) | 100% -> 0.8% | 752 -> 185 |
| all nine keywords | 1498 -> 200 | 1225 -> 35 | 65.46 (71.8, 62.24, 65.46) | 4.24 (4.36, 4.24, 4.18) | 100% -> 1.2% | 725 -> 215 |

A second pass of the candidate read 4.17 to 4.22 ms on every keyword scene (all nine: 4.22, 0.8% over 6.25 ms). What
is left per card: one layer per aura plus the layers Chrome has to split the card into around it (3 to 7 a card), and
the Rebirth veil's and Ward's one opacity animation each (the 21 and 35 above).

A FIGHT: 7 board minions that each carry Rise + Flurry + Execute + Rebirth (0 Attack, 400 Health so the fight lasts)
against the round-1 bot, 9 s of the fight traced, 3 fights each.

| | layers | CSS animations | frame mean ms | p95 | over 6.25 ms | Layerize ms per second | Layerize ms per FRAME |
|---|---|---|---|---|---|---|---|
| before | 759 to 761 | 605 to 610 | 24.5, 32.8, 24.6 | 33 to 46 | 100%, 100%, 99.7% | 107 to 114 | about 3.0 |
| after | 129 | 10 | 4.83, 5.03, 4.60 | 8.3 to 8.4 | 10.9%, 15.9%, 7.7% | 148 to 154 | about 0.7 |

Layerize per SECOND does not fall, because the page now produces about six times the frames; per frame it is a
quarter. The frames still over 6.25 ms in the fight are the fight's own work (attacks, FX, React), not the auras: this
is a round-1 opponent, not a late lobby fight, so it isolates the aura cost and says nothing about the rest.

## The look

`scripts/kwfx/compare.mjs` photographs the SAME card at the SAME loop instant twice: live (the aura seeked exactly as
the capture seeks it) and baked (that frame of the shipped AVIF, decoded in the page, on the aura's element), and
differences the crops. Contact sheets are next to this file (`2026-11-18-perf-keyword-loops/`): live | baked |
difference x4, four instants per aura, in the shop at 1x and 2x device pixels, and a combat row for each mode.

| aura | 1x: mean / largest difference (0-255) | 2x: mean / largest | 2x: pixels more than 16 apart |
|---|---|---|---|
| rise | 0.08 / 5 | 0.09 / 6 | 0% |
| rise-blue | 0.09 / 5 | 0.09 / 6 | 0% |
| rise-red | 0.07 / 5 | 0.07 / 5 | 0% |
| flurry | 0.08 / 19 | 0.19 / 78 | 0.28% |
| execute | 0.12 / 10 | 0.34 / 34 | 0.21% |
| rebirth | 0.16 / 18 | 0.2 / 22 | 0% |
| rebirth-shield | 0.17 / 18 | 0.21 / 25 | 0% |

Visible differences, for the owner:

1. **Timing, a few percent.** To close a loop each animation's period is rounded to a whole number of cycles: Rise
   3.7% (wisps 10.3 s -> 9.95 s, dome 3.2 s -> 3.32 s), Flurry at most 3.0% on a ring, Execute at most 6.1% on a shard
   (rings within 3.9%), Rebirth at most 4.6% on an ember (flicker and glow within 2%).
2. **Frame rate.** All four play at 60 pictures a second (Rise, Execute and Rebirth were 30 in the first cut; raised
   2026-11-19, see `2026-11-19-kwfx-60fps.md`), where the live loops moved on every display frame. Chromium cannot
   play an animated image faster than about 90 a second.
3. **Sharpness above 1080p.** The pictures are captured at 1920 x 1080 scale and stretched on a larger card. At 2x the
   differences stay small (table above); Flurry's thin blades and Execute's shards are slightly softer. A 2x capture
   of those two would cost roughly 3x their bytes.
4. **Blur and shard sizes now scale with the card.** Live, the blurs and the shard / tail lengths are fixed pixels
   while the aura box follows the card, so the aura looked a little different at other window sizes. Baked, it is the
   1080p look scaled as a whole.
5. **Every card showing one aura is in phase**, and the wisp / ember scatter is one fixed set. Cards that mounted
   together (every unit at a fight's start) already were in phase; cards bought at different times used to be offset.
6. **Covered boards freeze on the still** (frame 0) instead of pausing mid-motion, behind the overlay's dim and blur.
7. **Phones are unchanged** (still the live auras).

## Open items

- **Phones.** Not switched: WebKit animates images on its own path and its memory behaviour with a 400-frame AVIF is
  unmeasured. They keep the live auras, so no regression, and no gain yet. Needs a WebKit check before flipping
  `KWFX_ENABLED` there.
- **Stagger.** The brief asked for the cards not to tick in phase. With one shared picture there is no per-card tick
  left to stagger, and no way to offset it either (item 5).
- **Port.** 5252 was held by another builder's server during the last passes, so those ran on 5262.
- The Rebirth veil and Ward's shell keep one opacity animation each per card; Ward's shell is a candidate for the same
  treatment if it ever shows in a census.

## Verification

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build:web`: see the PR. `packages/ui/src/kwfx/kwfx.test.ts`
(signature, files, sizes, the stylesheet's classes, no animation / blend / filter / mask on a baked rule, the live
fallbacks).
