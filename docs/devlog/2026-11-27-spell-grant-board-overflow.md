# 2026-11-27 — A granted spell never takes a board slot

**Report (owner, screenshot):** "player's hand was full and this happened": two Dragonflame spell cards sitting in the board's minion slots.

**Cause:** `grantMinionToHandOrBoard` (recruit.ts) is the grant path for quest / rune reward `cards` and for rune meters' `grantCards`.
With the hand full it pushes the card onto the board, and it never asked whether the card was a minion. Rune of Dragon Hoard
(`runeThreshold`, gold, per 3, `grantCards: ['sp_dragonflame']`) hands out a spell through it, so a full hand put Dragonflames on
the board. Shouts, Echoes and Discovers already use hand-only paths (`conjureToHand`, the cap check in `battlecryGrantSpell`).

**Fix:** a spell or a Ruby is hand-only in that helper: hand if there is room, the hand past its cap if the grant is an
over-capping reward, else dropped. Minions keep the board overflow. Rule R-HAND-SPELL-NEVER-BOARD-01; tests in `handCap.test.ts`
(they fail without the fix).

**Not done:** a run already carrying a spell on its board keeps it (no save repair).
