# 2026-11-27 — Combat Prowess replays every Ancient Start of Combat

**Report (owner):** "combat prowess didnt trigger". Gorun with the Ancient of Genesis ("Start of Combat: your two left-most
minions gain Ward and Flurry") and Rune of Combat Prowess ("Your Start of Combat effects also trigger at End of Turn").

**Cause:** Combat Prowess replays run-level Start of Combat blocks through `socRuneReplaysOf` (recruit.ts), a hand-kept list.
None of the Ancient pairings' Start of Combat effects (the `ancient*` blocks in `simulate.ts`'s `socRunLevel`) were on it.

**Owner ruling:** "All of them". Every Ancient Start of Combat replays at End of Turn as a permanent Shop effect.

**Fix:** `ancientSocShopReplays` in ancients.ts lists the picked pairing's Start of Combat replays, each mirroring its combat
block with Shop semantics. `socRuneReplaysOf` pushes each as one hero-sourced beat named for the hero power, so the commit,
the projection and the beat list stay 1:1.

| Pairing | End of Turn under Combat Prowess |
| --- | --- |
| Indy × Time | the right-most minion is Gilded (`gildMinion`) |
| Cindy × War (Duos) | the left-most minion is Gilded |
| Xerox × War | an exact copy of the highest-Health minion beside it; full board: to hand |
| Braum × War | every minion +8/+8 per Gilded minion played this game |
| Braum × Bonds | Neutral minions triple their stats |
| Flint × War | Dwarves +1/+1 per Dwarf bought this game |
| Priestess × War (Duos) | every minion +2/+2 per card passed this game |
| Gorun × Genesis | the two left-most gain Ward and Flurry (commit e1e67b5f2) |
| Midas × War | one Ward per Gilded minion, each to a distinct random minion without Ward |
| Gorun × Time | every minion gains Blade Mastery's current grant once |
| Drakko × War | +1/+1 to a random minion, once plus once per Shout this turn |
| Brackus × War | an exact copy of the left-most Tier 7 (full board: to hand) and a plain copy to hand |
| Auctioneer × Time | the left-most and right-most Shouts fire (`replayBattlecry`) |
| Drakko × Time | the left-most Shout fires (on top of its own End of Turn trigger) |
| Nadja × War | the left-most gains Rally (+2 Attack per Gold spent this turn); a later End of Turn grows that one graft |

**Not replayed:** Magician × War (needs the teammate's board, which a run never holds in the Shop) and `socEnemyCopy` (no
pairing uses it since ancient pass 2). Brackus × War (`socCopyTier7`) was not on the builder brief's list but is a Start of
Combat, so it is in.

Rule R-PROWESS-ANCIENT-SOC-01; tests in `packages/sim/src/prowessAncientSoc.test.ts` (the new ones fail without the fix).

**Open for the owner:** these compound every turn (the gild, the copies, Braum's lump, Blade Mastery). Twilight does not repeat
them, per the standing rune-replay rule. The permanent Nadja Rally graft has no printed card text (granted Rallies never do).
