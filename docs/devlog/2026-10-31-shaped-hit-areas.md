# 2026-10-31 — Every HUD control takes the pointer only through its drawn shape (R-HIT-SHAPE-01)

Owner: "make the other buttons as clean cut as you did with end turn so that mousing over them feels snappy and
accurate". #2489 had shaped the End Turn gem and the Refresh pill, but only while the Docked rail was on.

## What changed

`packages/ui/src/hitShapes.css` (loaded last by Game.tsx), in every mode and layout:

- **Tier-up orb, Freeze, Refresh, End Turn**: box and art click-through; a `::after` with a `clip-path: polygon()`
  TRACED from each base art's alpha (`scripts/trace-hit-shape.mjs`, grown about one screen pixel so the antialiased rim
  is inside) takes the pointer. The Tier and Freeze label pills and the Gold cost chips are drawn as part of their
  button, so they now press it too. The Docked-only rules in lobbyRailDocked.css are gone (generalized).
- **Hero powers** (first, second, Equipment) and the **foe power icon**: the square box is click-through; the round art
  window (`.hpb-artwrap`) is the shape. In the Equipment looks the glow layer, which equipSlot.css sizes to exactly the
  socket plate, is the hit. The name pill, Ancient pill and Henchman chip keep their pointer explicitly.
- **Turn clock**: the cell's hit reaches over the strip's 2px rim with the strip's radius.
- **Health plaque**: drawn over the portrait's foot, so it now holds the pointer there (it used to pass it to the
  portrait, which lit and opened Buffs from the plaque).
- **Corner plaques** (Settings, Compendium, Rules, Friends): the hit is `::before` covering the plaque and its 4px hard
  bottom edge (a box-shadow, which can't be hit); it counter-moves the 2px hover lift and 3px press drop with the same
  transition, so the edge never flickers (a hover sweep across the top and bottom rows reads steady).
- **Rune and quest badges**: the rune art `<img>` (a circle 1.39x the badge) no longer takes the pointer; the badge circle
  plus its thin box-shadow ring does. A quest's step counter now lights its badge. On touch screens the badge hit grows to
  fill half the gap to its neighbour.
- **Teammate portrait (Duos)**: while watching, the dock's square box no longer takes the pointer; the disc, cap and name do.

Focus: these pieces drop the rectangular ring; keyboard focus is a drop-shadow on the art (follows the alpha) or an
outline on the round art window. Static shapes only: no animation, no per-frame work, nothing read from layout.

## Verification

Headless probe (Chromium, 1920x1080, a Practice shop plus a rich scene with a two-power hero, Equipment, two runes and a
quest): each control painted alone on a transparent page gives its visible alpha; a 2px grid inside (alpha >= 230) and
outside (alpha <= 8) of it is hit-tested with `elementFromPoint`. "Dead" = art that does not take the pointer, "live" =
empty space that does.

| control | before: dead / live | after: dead / live |
|---|---|---|
| Tier-up orb | 11.0% / 28.3% | 0.0% / 0.5% |
| Freeze | 20.0% / 34.8% | 0.1% / 0.1% |
| Refresh | 3.7% / 35.2% | 0.0% / 0.3% |
| End Turn gem | 0.2% / 0.1% | 0.0% / 0.0% |
| Gold coin | 0.0% / 1.0% | 0.0% / 1.0% |
| Hero power | 0.0% / 25.8% | 0.0% / 0.3% |
| Hero portrait | 15.9% / 0.0% | 19.2% / 0.0% |
| Health plaque | 100.0% / 0.0% | 0.2% / 0.0% |
| Corner: settings | 8.2% / 0.8% | 0.0% / 0.8% |
| Corner: compendium | 8.4% / 0.9% | 0.0% / 1.1% |
| Corner: rules | 8.2% / 0.7% | 0.0% / 0.6% |
| Corner: friends | 8.4% / 0.9% | 0.0% / 1.1% |
| Rail guides tab | 0.0% / 0.5% | 0.0% / 0.5% |
| Hero power 1 (pair) | 0.0% / 25.8% | 0.0% / 0.3% |
| Second hero power | 0.0% / 27.1% | 0.0% / 0.3% |
| Equipment slot | 21.3% / 0.0% | 4.6% / 0.0% |
| Rune badge 1 | 0.0% / 17.6% | 0.0% / 0.4% |
| Rune badge 2 | 0.0% / 26.9% | 0.0% / 1.0% |
| Quest badge | 6.1% / 0.3% | 0.0% / 2.4% |
| End Turn gem (rail not Docked) | 0.0% / 55.0% | 0.0% / 0.0% |
| Refresh (rail not Docked) | 1.3% / 45.0% | 0.0% / 0.3% |

The clock: its 2px strip rim used to be dead for the cell's tooltip; now it lights it.

What is left dead, on purpose (flagged to the owner):
- **Hero portrait ring** (the cosmetic frame): stays click-through per the 2026-09-29 ruling (the ring overhangs the hero
  power and must never take its click; `portraitFrameZOrder.test.ts`). The rest of the portrait dead count is the Health
  plaque, which now holds the pointer over the portrait foot.
- **Equipment / hero power cost coin and charge chip**: readouts that live outside the button element (`.hpwrap`, kept
  there for the z-order against the portrait ring); they stay click-through.
- Hero-select hero cards keep their rectangular card hit (a card with text, not a round/pill control); the re-roll,
  Main Menu and the Discover Peek pill were already shape-exact (border-radius).

Phones: taps keep the 44px slop (`touchSlop.ts` retargets a near-miss to the nearest control by its box), so the tighter
shapes do not shrink finger targets. Touch sizes measured on a 915x412 Android landscape: Tier orb 65x71, Freeze 52x57,
Refresh 106x45, End Turn 61x67, Gold 46, Equipment 56, hero powers 43-45 (circle), rune/quest badges 23 (+ the grown
touch circle), corner plaques 27, rail tab 15x25, chips 25 tall: the small ones were this size before and rely on the slop.

Tests: `hitShapes.test.ts` (each traced polygon covers >= 99.5% of its art's opaque pixels with < 4% empty spill, read
from the art file with sharp; the wiring per control; drag drop-through; static), `lobbyRailDockedClickThrough.test.ts`
updated to the general rule.
