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

## Kept as accents (meaning)

Heart red; Armor steel blue (`#c4d6ef`, number + shield + hairline); foe red tint on the opponent's name pill (as the
rail); gold cost text, red edge + text when unaffordable, the Refresh coin colour picker (`--rfb-cost-color`) and green
free roll; low-time tint and red clock; difficulty hues as edge + word; the rift violet, each Ancient's colour and the New
orange as edges; the cream Shop Tier plaque; Gold Fuse count stays gold; Versus gold-title labels unchanged; the
locked / rift / cleared / Versus-open plate variants keep their own edges.

## Not changed

The round Gold coin (owner revert); the combat Summary / Skip / End Combat buttons (still the purple Gem plate: buttons,
out of scope, a candidate follow-up since Start Game used to share their paint); the Compendium guide filter buttons; card
frames; the crystal fuse FX (canvas).
