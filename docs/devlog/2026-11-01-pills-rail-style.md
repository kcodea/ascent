# 2026-11-01 · Every pill wears the rail look

Owner ask 2026-11-01: "look at the style of the rail now - can you apply this same text/coloring style to the rest of our
pills in game?" (picked: EVERY pill), then added the Start Game button and the turn clock / Gold Fuse. Same day, on review:
"revert the gold coin pill back to what it was", so the round Gold counter by the board keeps its yellow glass coin.
Branch `feat/pills-rail-style`.

## What

- ONE source: `--pill-*` tokens in `uiTheme.css` (`--pill-plate`, `--pill-plate-hover`, `--pill-edge`, `--pill-edge-hover`,
  `--pill-outline`, `--pill-font`, `--pill-text`, `--pill-text-shadow`, `--pill-num-shadow`, `--pill-armor`, `--pill-foe`,
  `--pill-gold`, `--pill-red`). The plate follows the Lobby Rail 2 tuner's `--lr2-navy`, the shadow strength its
  `--lr2-name-shadow`, the edge the UI theme's `--ui-edge-main`.
- The Docked rail (`lobbyRailDocked.css`) now reads those tokens; a computed-style probe of the rail's plate, rank box,
  names and Health numbers (default and with tuner overrides) was identical before and after.
- Pills moved onto the tokens: the Gem HUD family in `healthPills.css` (`.hudpill-name/-hp/-arm`, `.combatopp-tier`, the
  turn timer, the Gold Fuse count, the Practice speed select), the hero power name/counter (`--hpill-*`), the Tavern and
  Refresh cost pills, tooltip pill tags (`--atip-pill-*`), `.riftpill-name`, `.anc-pill`, `.hcdiff`, `.lchat-pill`,
  `.newpill`, `.cv2-ppill`, the Versus hover states of name pills, and `.hsc-start` (Start Game).

- Later the same day (owner, from the review on 5173): the Docked rail's INSPECT card (panel `--pill-plate`, its tiles,
  power box and fight rows on `--pill-well` with a `--pill-hair` gold hairline), the ROUND slice (`.lrv-headbg`), the
  KEYWORD boxes (`.kwbox`: own navy plate, solid gold 1px edge, title shadow), and EVERY tooltip panel through the shared
  `--atip-*` tokens (navy plate, solid gold edge in place of the bevelled gradient, no sheen, titles take
  `--atip-title-shadow`): the Gold tip, the timer / Gold Fuse tip, the End Turn and upgrade tips, `data-tip` bubbles, hero
  and rune tips. Then a sweep of what was still purple in game: the combat Summary / Skip / End Combat pills, the Equipment
  name and clock-window plates, the rail's Versus status pill, `.vsfoe-status`, and the title's "Last played" pill.

## Kept as accents (meaning)

Heart red; Armor steel blue (`#c4d6ef`, number + shield + hairline); foe red tint on the opponent's name pill (as the
rail); gold cost text, red edge + text when unaffordable, the Refresh coin colour picker (`--rfb-cost-color`) and green
free roll; low-time tint and red clock; difficulty hues as edge + word; the rift violet, each Ancient's colour and the New
orange as edges; the cream Shop Tier plaque; Gold Fuse count stays gold; Versus gold-title labels unchanged; the
locked / rift / cleared / Versus-open plate variants keep their own edges.

## Not changed

The round Gold coin (owner revert); the board's targeting prompt pill (owned by `feat/target-prompt-says-effect`); the
menu screens' purple buttons, tabs and panels (Compendium, Collection, Career, Leaderboard, Escape menu, Versus room,
Runeforge, hero select Back / reroll); the dev panels (Scene Builder, God mode); the classic non-docked rail; card
frames; the crystal fuse FX (canvas).
