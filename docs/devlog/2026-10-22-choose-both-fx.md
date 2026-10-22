# 2026-10-22: the (Both) Choose One marker, remade

Owner (2026-10-22): "can you branch off and remake the 'both choose one effects active' effect? it's really sloppy
right now".

## What it was

When a Choose One card will resolve as BOTH options (`chooseBothActive`: Facetwright under the Rune of Facetwright,
Veinbreaker under the Rune of the Unbroken Vein), `useChooseBothFx` ran the `choose-one-both` Pixi def as a LOOP on the
card, following its rect every frame (owner ruling 2026-08-28: a persistent marker, never fired on play). Why it read
as sloppy, from prod-build frames:

- **Wrong size and shape.** A ring emitter of radius 115 px (a 230 px circle) on cards about 130 px wide. In the hand
  fan the three rings merged into one cloud over all the cards, so you could not tell which card was marked; in the
  Shop the ring sat out on the felt around a 120 px oval.
- **Smudge, not light.** About 215 live shards per card with a blur filter, gravity pulling them down and turbulence
  scattering them: it read as dirt drifting off the card.
- **Clashing colour.** Teal, magenta, pink and blue, unrelated to the card or to its "(Both)" label, which is printed in
  the tribe colour (Kobold red-orange).
- **Drawn over the card.** The FX canvas sits above the cards, so particles crossed the art and the rules text.
- **Capped at four.** Past `CHOOSE_BOTH_FX_CAP` a qualifying card got no marker at all (three Facetwrights in hand plus
  two Veinbreakers in the Shop: the last offer was unmarked).
- **Cost.** About 0.8 ms of script per frame for four loops (measured below), plus a per-frame `getBoundingClientRect`
  per card.

## The new design

The marker is now part of the card. `Card` renders one extra copy of the existing hover-glow layer when the card has a
`chooseBothKey`: `.plateglow.bothglow` on plated cards (hand, Discover, Inspect) and `.cglow.bothglow` on framed cards
(the Shop's oval, spell and taunt frames). Both copies already trace the card's own silhouette from the frame or plate
art and sit BEHIND the opaque art, so only the outward halo shows and nothing crosses the card face.

- **Colour:** a thin warm-white rim, then the tribe colour (`--c`, the same variable `.descboth` prints "(Both)" in)
  stacked outward. The label and the marker now read as one cue.
- **Arrival:** `bothin` / `bothin-plate`, 0.7 s, one-shot: the silhouette starts 1.45x wide and transparent and closes
  in on the card from both sides as it brightens ("both halves coming together"). It plays when the card appears
  with the state: drawn into hand, an offer rolled into the Shop, the rune bought, a Discover or Inspect opening.
- **Hold:** `bothbreathe`, 2.8 s, opacity 1 to 0.6 and back, over a STATIC drop-shadow (the `kwglow` rule).
- **Reduced motion:** `bothstill`, a zero-length filled animation holding opacity 0.9. (A plain `opacity` would lose
  to the hover layers' `opacity: 0`; an animation outranks it.)
- **Hover still works:** the white hover glow is its own element, untouched.

The plate copy re-states its whole `transform` in the arrival keyframes instead of using the individual `scale`
property: the plate glow already owns `transform: translateX(-50%) ...`, and `scale` would apply after that translate
and pull the glow sideways while it converged.

The arrival animation fills `backwards`, not `both`: with two animations on `opacity` and the first one held
`forwards`, Chrome re-ran style for the glows every frame (trace: 154 ms of style recalc per 3 s versus 44 ms on
`main`). With `backwards` it is 62 ms per 3 s, in the noise of the scene's other animations.

## Removed

`useChooseBothFx.ts`, its key list in `Recruit.tsx`, its `directCalls` entry and its tests. The `choose-one-both.json`
def stays in the FX library (owner-authored, still playable from the workbench) but nothing in the game plays it, and
`chooseOneBoth.test.tsx` now fails if anything does. No combat, spectate or replay path ever showed the marker: a
(Both) card resolves on play, so a board or combat unit never qualifies, and replays and spectating render the same
`Card` with the same key, so they get the glow wherever the live game does.

## Measured (prod build, headless Chrome 1600x900, 3 Facetwright/Veinbreaker hand cards + 1 Shop offer)

| | main (Pixi loop) | this branch (CSS glow) |
| --- | --- | --- |
| frame time p50 / p95 / p99 | 4.2 / 4.3 / 4.3 ms | 4.2 / 4.3 / 4.3 ms |
| frames over 6.25 ms (8 s) | 0 | 0 |
| main-thread script per frame | 0.77 to 0.84 ms | 0.02 ms |
| main-thread task per frame | 0.98 to 1.05 ms | 0.30 to 0.33 ms |
| Paint events in 3 s steady state | 0 | 0 |

Headless rAF is paced at 240 Hz, so frame times cap at 4.17 ms on both; the main-thread numbers are the real
difference.

Oracle: R-TEXT-BOTH-MARKER-01.
