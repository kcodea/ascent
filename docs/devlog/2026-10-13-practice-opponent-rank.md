# 2026-10-13: Practice gets an Opponent Rank option

Owner: "when playing in practice mode, can we add an option to select what rank the snapshots they face are in? this
should be exactly what is already in place with what snapshots a bronze vs silver vs gold player can face", then "and
we'd just add buttons that says All Ranks, Bronze, Silver, Gold, Platinum". Rule: **R-PRACTICE-RANK-01**.

## What shipped

- **A Sandbox Mode row, "Opponent Rank":** All Ranks (default), Bronze, Silver, Gold, Platinum. Stored on the
  Practice setup as `PracticeConfig.rank`, and so on the run.
- **A medal reuses ranked's own rule, not a copy of it.** `practiceStrengthBand(rank)` returns that medal's entry of
  `STRENGTH_BANDS`, and `createLobbyRun` hands it to `createRunLobby` as the `strengthBand` a rated lobby passes. So
  the band, the early / late weight, the overall cap, the widening and the 4-seats-per-player cap are all the rated
  ones, and a retune of ranked retunes Practice with no second table to forget. The test seats a Practice table and a
  rated table of each medal from one pool on twelve seeds and compares them seat for seat.
- **All Ranks** is no band. **Platinum** has no band in ranked, so today it draws like All Ranks; it follows the
  table if Platinum is ever given one.
- **God Mode** ignores the row (`godPracticeConfig` sets All Ranks), like the other Sandbox options.

## The part that was not a one-liner: the pool is sampled per rank

The opponent pool is not "every run": it is a sample of 150 whole runs the server draws **for one band**, the band of
the player's own medal. Seat selection then filters what is on hand. Two things follow.

1. **A Practice game needs the picked rank's sample.** A Bronze player's pool holds only Bronze-band runs, so "Gold"
   or "All Ranks" would have had nothing but Bronze runs to pick from. The band the pool asks for is now the Practice
   game's while its hero picker is open (`poolBandFor`), the fetch starts the moment the picker opens
   (`confirmPracticeSetup` -> `PoolLoader.matchBand`), and the launch curtain's gate waits for whatever is left
   behind the existing "Finding opponents..." wait (`gate.run({ matchBand: true })`). One attempt, at most 10
   seconds; if it does not arrive the game starts on the pool on hand, filtered and widened as before. A rated
   launch does not wait for a band (unchanged).
2. **Samples for other ranks must not leak into a later table.** Registration only ever adds runs (a saved game may
   be seated from them, so nothing is removed). Without a guard, a Platinum or Gold player could open a Bronze
   Practice game and then queue ranked with Bronze's 150 weak runs sitting in the pool: an easier rated lobby on
   demand. The loader now remembers which band each run was fetched for and names the runs fetched **only** for
   other bands (`foreignRuns(band)`); every table passes them as `LobbySeatOptions.excludeRuns` and seat selection
   passes them over. Nothing is named until a sample for the table's own band has arrived, so a table can always be
   seated from what is on hand.

## Behaviour changes to know about

- **Default Practice is now really "all ranks".** Practice never had a band in seat selection, but it drew from the
  pool sampled for the player's own medal, so a Bronze, Silver or Gold player's Practice met mostly their own band.
  With All Ranks as the default it now fetches the open sample: for those players, default Practice opponents get
  stronger on average. If that is not wanted, the default should be the player's own rank (a one-line change in
  `DEFAULT_PRACTICE_CONFIG` plus a "My rank" reading). Owner's call; flagged in the PR.
- **Rated, after a rank change in one session:** the new rank's table no longer draws runs fetched only for the old
  rank once the new rank's sample is in. It used to filter the union of both samples. Same rule, drawn more exactly.

## Judgement calls to confirm with the owner

- The row's name, "Opponent Rank", and its hint lines.
- Where it sits: fourth, between Time and Tribes.
- All Ranks as the default (see above).
- Platinum and All Ranks do the same thing today. Both buttons are there because the owner listed both.

## Not verified

- A real fetch against the live pool for another rank (the tests drive the loader with a stubbed network). Worth one
  real Practice game set to Bronze and one to Gold, watching for the brief "Finding opponents..." wait.
