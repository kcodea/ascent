# 2026-10-03 - Lobby rail: round damage floats once instead of staying; calmer knockout smoke

Owner asks (2026-10-03): "remove the -x number here. when the player gets back to lobby, they can have the damage
dealt to players show and float/fade, but dont leave it on the rail. players can mouse over for the combat detail
from last round." And, for the same moment: "the knockout smoke on the rail is ugly and jarring. can you make it
cleaner, slightly slower so that it's a bit easier to notice it/see it, but not overwhelming or in your face either".

## What changed

- **No lasting number on the row.** The `.lobbydmg` cell (and its `lobbydmgpop` keyframe, plus the Gem rail's
  overrides) is gone from `LobbyPanel`. Row height and the rail's outer rect are unchanged in both looks. In Classic
  the health number used to slide right while a "-N" sat beside it; it now always sits where it sat with no number.
- **One float per hurt seat per round.** `LobbyPanel` keys an effect on the lobby round (`seenRound`). The first
  sight of a table (mount, reload, a new run) only records the round, like the knockout diff, so a reload replays
  nothing. On a new round, `roundDamageFloats` (lobbyDamageFx.ts) lists every standing seat whose last-round `taken`
  is above 0 (the old number's own rule), and each gets `floatLobbyDamageOnSeat` after `whenCurtainDown` + a rAF.
  This replaced the older "damage you dealt" float over your foe, which is now one of the seats announced.
- **The float itself** is the existing one-shot WAAPI `.lobbydmg-float`, lengthened to 1.5s (900 ms hold, 600 ms
  fade) and moved to the row's right end. Its easing is now per segment on a linear timeline: a single ease-out over
  the whole run had it mostly faded by the middle. Transform + opacity only.
- **Hover** already carried the detail: the scout card's fight list shows round, foe, outcome and damage for the
  last three fights (`seatResults`), so last round's loss is the top row. No change; a test now pins it.
- **Knockout, calmer.** `lobby-knockout.json` is now 1.5s: a soft grey veil (smoke, 5 bands, box emitter squashed to
  the row, gentle rise, falling rate curve) plus six slow pale motes in normal blend. The puff burst and the 22 add-blend
  embers are gone. The row's `lobbyko` is 1400 ms, opacity only, ease-in-out, with no swell (`LOBBY_KO_MS` 1400).

## Verification

- `lobbyRoundDamage.test.tsx`: no `.lobbydmg` and no "-N" on any row in either look; floats fire once per hurt seat
  (not for a draw, a winner or a fallen seat), not on re-render, not on remount, and again for the next round; the
  hover card's top fight reads round 1, LOST, -7.
- Live (dev server, 1920x1080): a real round-1 fight produced three floats after the curtain lifted; faked settles
  showed them readable to ~1s and gone by ~1.5s. Rail and row rects identical to main at 1920x1080 and 1366x768.
- Oracle: R-PRESENT-30 added; R-PRESENT-17's wording updated (it named the old dealt float).

## Notes

- The Lobby Rail Look tuner's "Damage-taken size" / "Damage ink" dials (`dmgScale` / `dmgCol`) now drive nothing.
  Left in place; remove or repoint them at the float in a follow-up if wanted.
- Two seats sharing a placement (both "#7") is by design: `closeRunLobbyRound` gives every seat knocked out in the
  same round `remaining + eliminated.length`, the lower shared place. GAME-RULES does not spell this out yet.
