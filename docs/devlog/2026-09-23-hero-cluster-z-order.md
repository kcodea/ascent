# 2026-09-23 — Combat units paint over the hero cluster (the z-order ladder)

Owner report (verbatim): "can you fix the z axis of the hero power art etc? it is on top of minions and heroes so
when they attack they are behind it."

## Root cause

`.statusbar` (the bottom-left cluster: portrait, hero-power diamond with its counter and name pill, equipment
slot, rune nodes) is a `#root` SIBLING of `.app` at `z-index: 40`, and `.app` is a `position: relative;
z-index: 1` stacking context. The combat units live inside `.app` (the tavern and warband zones), so no z-index
written on a unit could ever beat the cluster: the attacker's `.unit.attacking` z8 and the lunge's inline z12
only ranked it inside `.app`, which as a whole sat under z40. A minion wound up or lunging out of the leftmost
slot passed behind the power diamond. The foe portrait was never affected (it is a `<body>` portal at z42 and
goes to z100 while it strikes); the player's own hero strike was already covered by `body.duel-attacker-player`.

## Fix (`packages/ui/src/styles.css`)

The same move the hand-hover and `body.modalup` rules already make, plus one re-seating:

- `.app.combat { z-index: auto }` dissolves the app's context for the fight, so the board art, the cluster and
  the units sort at ROOT.
- `:where(body:has(.app.combat)) .statusbar { z-index: 0 }` seats the cluster at z0: over `.boardbg`,
  `.pixifx-below` and the app's own box (all z0 / auto and EARLIER in the tree) and under every unit.
- `:where(.app.combat) .unit { z-index: 1 }` (dying z2) lifts the idle units over the bar. Attacking 8, struck
  12, the lunge's inline 12, poisoned 13 and reborn 14 are untouched, so the defender still sorts over the
  attacker inside the ONE root context.
- `:where(body:has(.app.combat)) .statusbar:where(:has(.heropanel:hover, .questbadge:hover, .buffsopen))
  { z-index: 41 }` lifts the whole bar back over the units while a popover is up (the tooltips are trapped in the
  fixed bar's stacking context and can only escape by lifting the bar), still under the foe portrait (42) and the
  FX canvas (110).

The full ladder is documented in the COMBAT Z-ORDER LADDER comment at `.app.combat`.

Two dead ends worth remembering:

- **Raising `.app`** is wrong for the reason both precedents give: `.boardbg` is its child and rides up with it,
  covering the cluster.
- **A negative bar** (`z-index: -1`, first attempt) paints correctly but sits under `.app`'s transparent box,
  so every pointer over the power diamond landed on `.app` and the tooltip never opened. The bar must be z0 and
  win by tree order; that is why the idle units had to rise to z1 rather than the bar sink.
- **Per-zone z-indexes** would break "defender over attacker": the two are always on opposite boards.

Specificity is load-bearing: the new rules are wrapped in `:where()` so a bare `body:has(.app.combat)`
(0,3,1) cannot silently out-rank the duel rule (0,2,1), and the idle-unit rule (0,1,0) cannot flatten
`.unit.attacking` etc. (0,2,0).

## Verification

- Live on port 5255 (Practice, Ayse, a full board, combat at 0.5x, GSAP frozen mid wind-up via a `gsap.set`
  hook): the same frozen frame with and without the fix. Before: the leftmost minion's attack badge hidden under
  the "1/3 Lucky Seat" diamond. After: the card over the diamond. Hovering the diamond lifts the bar to 41; its
  tooltip and a rune node's tooltip render over the card.
- `packages/ui/src/combatZOrder.test.ts` pins the ladder tokens, their order, and the `:where()` shape.
- Oracle rule `R-PRESENT-07` in `packages/rules/src/registry/approved/foundation.ts`.
- Patch note under Systems (2026-09-23, "Fixes").
