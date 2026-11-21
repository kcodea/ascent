# 2026-11-19: the Ancient reveal goes before the rune select

Owner (Mike): "if a player awakens their ancient through combat points on the combat that leads to a rune phase (so
combat after shop turn 5 and shop turn 8) then the ancient reveal should happen BEFORE the rune select".

## What changed

Rule R-ANCIENT-ORDER-01. Before, the awakening waited for every other decision, the Runeforge included, so on a rune
turn the player picked a rune and only then saw the Ancients.

- `ancientLeadsRuneforge(state)` (`packages/sim/src/ancients.ts`): the offer is open, the meter's last gain was
  `combat`, a forge is open, and no quest / power pick / Discover / aim / scout is up.
- Reducer: the modal gate lets `pickAncient` through on it. The rune actions are still accepted first, so a recording
  made before this change replays unchanged.
- UI (`packages/ui/src/ancients/awakeningLeadsForge.ts`): the gate and the offer no longer wait for a forge they lead,
  and the Runeforge overlay is held while the offer is unanswered and then until the awakening stage is back to idle
  (the pick's slam into the hero power).

## Known edge

A replay recorded before this change, of a turn where both were open, held the forge on screen first. It now plays the
recorded rune pick without showing the forge, then the awakening. State is identical; only that one overlay is missed.
