# 2026-10-23: the opponent's hero block stays on the board at every window shape

Owner (2026-10-23, screenshot of a tall, narrow window in combat): "everything in the game works/stays in place
seemingly except for opponent information. can you fix it so these locations are baked in the viewport in the same way
as other ui elements?"

## Root cause

The foe block (`.combatopp`: portrait, name, Health/Armor, the Shop Tier pill, the rune slots) and the foe's hero power
(`.heropowerbtn.opp-power` and its tip) were already portalled into the stage host, like every other layer. What was
wrong was their vertical anchor: `top: calc(20 * var(--u) + var(--hd-power-y) * var(--scale) ...)` is measured from the
top of the LAYOUT VIEWPORT, not from the top of the 16:9 game box. Horizontally they were fine (`50% - var(--gw) / 2`
is the box's right edge).

At 16:9 the two are the same (`--bar-y` = 0), so a desktop never showed it. On a window taller than 16:9 the stage lays
out at the design width and grows taller (`--lvh` > `--gh`), the 16:9 box sits in the middle, and the foe block stayed
at the window's top. Every other top-anchored HUD piece (the Refresh crystal, the combat Skip, the round label) already
starts from `var(--bar-y)`; the player's own block is centre-anchored (`bottom: calc(50% - ...)`).

## The fix

The three `top` anchors now start from `var(--bar-y)`, the box's top edge. CSS only, no JS, no new layout reads, no new
animation. `--bar-y` is 0 at 16:9, so desktop is unchanged pixel for pixel.

## Verification

Prod builds of `main` and the branch in headless Chrome, walked title > Play > hero select > first shop > End Turn.

- The built CSS differs from main's in exactly these three `top` declarations.
- Desktop A/B on ONE frozen page (rAF, timers and CSS animations stopped, one-shot animations finished, the version
  label hidden), swapping only the stylesheet between main's and the branch's built CSS: 0 changed pixels at
  1920 x 1080 (shop and combat) and 2560 x 1440 (shop and combat). In combat a stylesheet reload re-rasters the 2.4x
  scaled foe layer, which moves a few hundred pixels by at most 6/255 between ANY two loads, the same CSS included
  (measured as a control); captured back to back in the same raster state, main vs branch is 0. The foe's rects are
  identical to the tenth of a pixel.
- Other shapes, foe portrait top in screen px (branch): 1366 x 768 32.7 (same as main), 2560 x 1080 45.9 (same as
  main), iPhone landscape 852 x 393 15.6, iPad portrait 820 x 1180 377.6 (on the board, which is letterboxed from
  359 px).
- The phone stage zoom path (#2242) was not active in headless Chrome. It sizes the same layout vars, and the other
  `--bar-y`-anchored HUD (the Refresh crystal, the combat Skip) already holds there, so the foe block now follows them.
- 483 x 898 (the owner's window): before, the foe portrait sat at the window's top-right (portrait top 11.6 px) while
  the board was centred; after, it sits at the board's top-right (portrait top 324.7 px = 313.1 px of letterbox + the
  same 11.6 px), mirroring the player's block.
- Versus and spectating reuse the same `CombatOpponent` in combat. The Versus shop foe block (`.vsfoe`) is
  `position: absolute` inside `.app` (the 16:9 box) with a percentage top, so it was already box-anchored.

Pinned by `packages/ui/src/combatOpponentStageAnchor.test.tsx` and oracle rule R-STAGE-OPP-HUD-01 (foundation).
