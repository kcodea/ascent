# 2026-09-29 · A recorded seat never brings a late-game board to an early round

Owner reports (2026-09-29): "my friend is playing a game and just faced this board on turn 5 which is clearly
wrong. can you look into this?" and, a round later, "on round 6 he just faced a player without a rune too.
something is wrong with our snapshots". Rule: R-LOBBY-07.

## What happened

IonLime (Netlify build 842413357), round 5, faced "Lucky Orangez": seven Beasts, several tier 4 to 6, stats
up to 41/49 at the end of the fight, Rune of the Burrow. 30 Resolve + 15 Armor is simply the untouched start
(`startingArmor: 15`), not the stale-final-board rule.

Evidence (anon REST reads of `boards`, 1,725 rows):

- No board in the table has those exact stats. The seven cards, in that order, are the wave-10 board of
  `Orangez|soren|1129878061` (patch 0.1.0+d7ea6db4, uploaded 2026-08-22, tier 6): Echohorn, golden Armadiyo,
  Dunkey, Spots, Beardsley x2, Paragon, with Rune of the Burrow + Beastial Swarm. The screenshot's numbers are
  that board after its own in-combat growth.
- That run's real wave-5 board is ordinary (Gourmand 11/10, Pimm 3/1, Armadiyo 5/3, tier 4).
- The client pulls the newest 120 boards PER WAVE. Early waves hold more rows than late ones (wave 5: 146 rows,
  wave 10: 112), so the Aug-22 run's waves 2 to 9 fell outside the cut and only waves 10 to 17 arrived.
  Reassembled, it still had 8 waves (above the 4-wave minimum). `recordedSeat` serves "this wave, else the
  closest earlier, else the EARLIEST board", so on round 5 it served wave 10.
- 17 of the 146 live runs were cut this way (some lost their early waves, some a multi-wave middle, which
  serves a too-WEAK board instead).

### The round-6 opponent with no rune

- Snapshots do not lose runes: every wave-6 board in the pool carries one (145 of 145, and every wave 7 to 10
  board too); 141 of 146 runs forge on turn 6, 4 on turn 5 (Runesmith), 1 on turn 7. Row columns and the
  snapshot jsonb agree on wave, hero, seed and author for all 1,725 rows. The IndexedDB cache stores each board
  whole with its own `wave`, and seats group by the snapshot's `wave`, so the cache cannot re-file a board.
- Cause 1, same holes as above: a run kept as waves 1, 2, 4, 8 (`LazerLemon|robin|1478677177`) or 1, 10
  (`Orangez|cassen|1765732243` and five others) serves its closest EARLIER board, from before its Runeforge,
  on round 6.
- Cause 2: a GENERATED (hybrid) seat never had a rune. `autoplayRun`, which records a generated seat, answered
  every Runeforge with `skipRuneforge`.

The owner's hypothesis (dev-build / Practice / sandbox runs uploading cheated boards) did not hold for this
board: the run is a genuine 2026-08-22 game. Checked anyway: Practice and Scene Builder runs (`sandbox`, where
the 999 Gold god mode lives) are already excluded from every upload (`store.ts` run-end gate:
`mode !== 'practice' && mode !== 'tutorial' && !sandbox`), and `devGrant` is only reachable from the DEV-only
Scene Builder. A normal lobby game played on a dev build does upload, and that is how most of the owner's 647
boards got there; it was left alone (open question below).

## What shipped

- `packages/sim/src/lobby/snapshotSeats.ts`: `playerRunsFrom` seats a run only when `runCoversItsRounds`
  (first board at wave <= 2, at most one missing wave in a row) and `runTiersPlausible` (every board's tier <=
  `maxPlausibleTier(wave)` = the all-in tavern-up curve from CONFIG + 2: 3, 4, 4, 5, then 6). A dropped run is
  simply not eligible, so the next run in the shuffle takes the seat. Restored lobbies resolve through the same
  function, and a run missing from the pool already degrades to a generated seat.
- `packages/sim/src/snapshot.ts autoplayRun`: at a Runeforge it buys the first offered rune it can afford and
  only skips when none is. This changes every generated recording from turn 6 on (hybrid seats, the bootstrap
  pool builder, tools that autoplay); the sim, tools and rules suites pass unchanged.
- Measured against the live pool: every complete run passes (max one missing wave; the highest tier-for-wave
  board is a Runesmith at tier 6 on wave 6, inside the bound).
- Test: `packages/sim/src/lobby/runCoverage.test.ts` (the live shape, holes, the tier bound, an end-to-end lobby
  where no seat serves a board more than one wave ahead in rounds 1 to 12, and generated recordings owning a rune
  from wave 7).

## Pool cleanup

None needed: the boards are real. No SQL.

## Open for the owner

- The pull itself still truncates old runs (they are now dropped rather than mis-served). A follow-up could
  pull by run instead of by wave so older runs stay whole.
- Generated seats are now a little stronger from round 6 (they own a rune). Revert the `autoplayRun` branch if
  that is not wanted.
- Should a normal lobby game on a DEV build (`npm run dev`) still upload to the shared pool? Today it does.
- Separate finding: the `profiles` table returns the `email` column to the anon key.
