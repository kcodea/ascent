# 2026-10-31 — The lobby rail is docked into the board

A day of owner review on `feat/lobby-rail-tiles` ended with "the rail is good to merge". It replaces the Gem rail's seat
rows in every lobby game. Where the rail cannot dock, it is still the Gem rail: the Guides view, a Duos team rail, the
Versus 1v1 block, and any board without its HUD (unit tests in jsdom included).

**What it is** (R-RAIL-DOCKED-01, docs/GAME-RULES.md):
- The rail is a stack of slices against the board's right side. A round slice is tied into the Refresh pill. Below it
  sits one slice per seat, all the same height, from just under the pill to the Gold coin's foot.
- The pill, the End Turn gem and the coin cut clean shapes out of the slices beside them. The shapes follow the board's
  real copper and bronze sockets, measured off the art as ratios of the elements' boxes, with an even clearance and a
  gold SVG edge along every outline.
- Each slice shows the hero art fading right, the player's name (one alignment line, ellipsis past 2 lines) and a gloss
  Health bar: red Health, a steel-blue Armor chunk over max Health. On cut slices the bar follows the cut.
- Your slice is edged in gold. The next foe's slice gets a thick red edge, a breathing glow (opacity only) and a
  crossed-swords chip.
- The fallen keep their slice, grey with a skull, the skulls in one column. A knockout never moves the stack.
- Hovering a slice opens the compact scout card: name, Health and Armor, shop tier, Gilded made (owner ruling, as
  R-LOBBY-RAIL-02), top tribe, runes, last three fights.

**How**:
- `lobbyRailDockedLayout.ts` is pure: anchors in, slice boxes and outlines out.
- `useDockedRail.ts` measures the board once per layout change and converts screen px into the rail's containing
  block. It never measures per frame.
- `lobbyRailDocked.css` holds the paint. Every value reads a `--lr2-*` var whose fallback is the shipped value.
- Lobby Rail Tuner 2 (DEV only) drives everything. Its test checks that every paint control reaches its rule and that
  every layout dial moves the layout.
- Stacking: the rail is z 40, under the board HUD's z 41, so HUD tooltips draw over it.
- Click-through: only the slices take the pointer. While docked, the gem and the Refresh pill take the pointer only
  through their own shapes (R-RAIL-DOCKED-CLICKTHROUGH-01).

**Gone**: the review variants (A to E, Tiles, the `?rail=` switch) and the on-board gilded count.
