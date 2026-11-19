# A viewer presses nothing on the board (2026-11-18)

Owner report: "when spectating, spectators shouldnt be able to hit the end turn gem etc. for some reason i was spectating
and the combat ended and the player died and i could hit the gem which took me to their shop with them at 0 hp".

- ROOT CAUSE. The viewing screen makes every button inert with one rule (`.app.viewing button { pointer-events: none }`,
  styles.css, 2026-08-30). The shaped hit areas (R-HIT-SHAPE-01, #2500, 2026-10-31) gave the Tier-up orb, Freeze, Refresh
  and the End Turn gem a `::after` hit layer with `pointer-events: auto`. `pointer-events` is only INHERITED by the
  layer, so its own `auto` wins, and a press on a pseudo-element is a press on its button. From that day those four
  buttons took a viewer's click again (watch screen, replay viewer, Duos teammate view).
- WHY IT SHOWED A SHOP. The store swallows a viewer's `dispatch`, so nothing resolved. But End Combat's exit is local
  presentation: `endCombat` ran the curtain, `spectatorFightCovered` had nothing to swap to, and Recruit dropped the
  fight's staging. The spectator saw the watched player's shop dressing over their finished fight (still phase
  `combat`), at 0 Health when that fight had eliminated them. Reproduced headless by putting a real game's screen into
  the viewer state after its fight (shots, not committed).
- FIX. Two layers, one gate (the `viewing` class):
  - hitShapes.css: under `.app.viewing` the four buttons' hit layers and their drawn chips / pills are off.
  - `viewerPress` (viewerGuard.ts): the four buttons' click handlers return first on a viewer's screen, so a press that
    arrives without the pointer (Tab + Enter / Space, a synthetic click, a later stylesheet) plays nothing and calls
    nothing. It reads the class from the button's ancestors (no store import, no layout read). No Recruit.tsx edit.
- ELIMINATION, unchanged and now reachable only that way: the watch screen holds the last fight (the game's own end
  screen is never drawn for a spectator, `spectatorRunOf`), then a lobby game closes the end gate and opens on the menu
  with the player's place and the XP for watching (R-SPECTATE-END-01); a Versus table moves the screen to a player
  still in (R-VERSUS-GROUP-WATCH-01).
- NOT CHANGED: the hero power button keeps its hover on a viewer's screen (its tip); arming it is refused in the store.
- Rule: R-SPECTATE-INERT-01. Test: `packages/ui/src/viewerInert.test.tsx`.
