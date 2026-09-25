# 2026-09-25 — Announcer: the moment catalog's first batch (31 moments, ElevenLabs lines)

Owner ask: wire all 98 idea moments from the team's moment catalog into the game, with the approved ElevenLabs
takes (the catalog's example lines, generated with `npm run vo:generate` in the owner's cloned announcer voice).
This PR is the first of four groups: the 31 moments whose state the store already carries. `CATALOG_BATCH_1_EVENTS`
in `announcer.ts` lists them.

- **Detection** follows the existing shape: store-diff detectors in `syncAnnouncer`, split into `detectVerdict`,
  `detectReturn`, `detectShopTurn` (+ `detectArmorUp`) so the main function does not grow further. New run fields read:
  `armor`, `soldThisTurn`, `spellsThisTurn`, `playedThisTurn`, and the lobby seats' `resolve`.
- **Underdog / Favourite** read `combatOdds`, which lands on its own store update (the deferred probe); it is
  weighed once per wave on any update while the fight is on, before the `p === run` early return.
- **SecondPlace** replaces GameLoss for exactly 2nd and joins the end lines that never expire (`UNCAPPED_EVENTS`).
- **One take each.** Moments the catalog lets recur (TierUp, RoundMilestone, BoardTotal, PlayersRemain, FastTier)
  are wired to recur, but the no-repeat bag silences them after their single take; more takes unlock the repeats.
- **Priorities are Claude's proposal** (owner: "you propose, I adjust"), each beside its nearest live moment.
  One real conflict found in testing: FastTier at tier 6 by round 9 outranked TierSix and silenced it for good
  (TierSix cannot recur), so FastTier sits at 44, just under TierSix's 45.
- **BrokeTurn** needs both tallies KNOWN (`embers === 0`, `cardsBoughtThisTurn === 0`); absent is unknown, never 0.
- **Tests:** the older suites pin exact line sequences, so a suite-wide `beforeEach` mutes this batch through the
  tuner's Chance dial and the batch's own suite turns it back on. Two older expectations changed on purpose: a
  2nd-place finish now plays `second-place`, and the append-only check covers the new block at the table's end.

Deferred to the next groups: in-fight moments timed to the replay (group B, incl. ClutchWin / NarrowLoss, which
need the final fight board), moments needing new tallies or engine signals (group C, incl. RefreshStreak,
GoldRush, and LastLife, which needs a ruling on "any loss"), and the per-hero / per-tribe moments that need more
lines first (group D).
