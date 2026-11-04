# 2026-11-04: Priestess, the first Duos-only hero; Matchmaker T4, CueBee T5

Owner ask: "add new duos hero and wire art - Priestess - 14 armor, Passaria -> 2g pass a non-golden minion to your
teammate. duos card changes: matchmaker -> T4, cuebee -> T5".

- **`HeroDef.duosOnly`** is new: the hero-level twin of `CardDef.duos`. `playableHeroes` leaves such a hero out unless the
  caller passes `{ duos: true }`; `practiceHeroes` and `powerDiscoverPool` always leave it out. Priestess sits last in
  `HEROES`, so solo offer order and every seeded solo draw are unchanged.
- **The deal.** The Worker's `dealGroupOffers` (Duos and Ranked Duos) passes `{ duos }`; the 1v1 room and Group do not. The
  client builds the re-roll candidates, so `versusRerollCandidates` passes it too.
- **Passaria reuses the effect pass.** `passMinionToTeammate` already did the job for Handout and CueBee's Pass, so the wire
  (`passFrom: 'spell'`), the Worker's golden guard, the full-hand wait, the flights and the spectator streams needed no
  change. The only new data on the outbox entry is `paid` (non-zero for the first time on a `via` pass) and `power` (the
  slot), so `refundDuosPass` gives back the Gold and the turn's charge.
- **`passariaTarget`** is the single legality answer: reducer, aim glow and button all read it.
- **Compendium.** The Duos toggle is now live on the Heroes tab, because a Duos-only hero belongs behind it.

Calls left for the owner are in the PR. The main one: "pass a minion" was read as Shop or board, matching CueBee's Pass,
not hand (a hand card already has the 1 Gold drag).
