# 2026-10-02 - Lobby loss cap check (Scene Builder "-30 on turn 7")

**Owner report:** "im in a scene builder game ... im seeing someone that took -30 on turn 7. there were also people
that took -15 on max -10 rounds. can you confirm nothing is busted about our lobby rules and they follow the same
dmg taken system"

**Finding: not a bug.** Scene Builder runs a practice-BOTS lobby. In that table, bot-vs-bot fights are scaled by
`BOT_SEAT_DAMAGE_MULT` (5) and are deliberately UNCAPPED (`settleRunLobbyRound` `seatCap`, #1199, owner ask
2026-08-25 so bot games don't drag). Gremlinz vs VaporBadger on round 7 was raw 6 x 5 = 30; Gremlinz went
45 (30 Resolve + 15 Armor) -> about 40 -> 10. The -15s on cap-10 rounds are 3 x 5. The player's own fight, the
damage the player deals, and ghost fights stay capped even there.

In real lobbies every path (player fight via `runLossCap(run.wave)`; settle, seat-vs-seat, ghost stand-in, bye
ghost via `roundLossCap(lobby.rules, lobby.round)`; headless `resolveRound`) caps with the same round, Armor
absorbing after the cap. The rail "-N" and the scout DMG column read `encounters[].damageTo*`, which is exactly
what `hitSeat` charged.

**Shipped:** `packages/sim/src/lobby/lobbyLossCap.test.ts` (8-seat lobby, 16 rounds, 3 seeds: no seat ever loses
more than `roundLossCap`, and every HP drop equals its recorded DMG; a custom `lossCaps` table; the practice-bots
table caps the player and pins the bot exemption's stamp). Mutation-checked: making seat-vs-seat uncapped fails it.
Also corrected the stale `BOT_SEAT_DAMAGE_MULT` comment that claimed the cap bounds bot fights.

**Owner ruling (same day):** "leave practice/scene builder as is". The exemption stays; recorded as R-LOBBY-11.
