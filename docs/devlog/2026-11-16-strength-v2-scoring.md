# Strength v2 in the game: carry-forward ranking, the 7-round floor, "Calculating Score" (2026-11-16)

Plan 2 of 3 of the strength v2 design (`docs/superpowers/specs/2026-11-16-strength-v2-design.md`,
plan `docs/superpowers/plans/2026-11-16-strength-v2-scoring.md`). Plan 1 (the measurement tools) merged earlier the
same day. Rules: R-LOBBY-18, -19, -20, R-ENDSCREEN-SCORE-01; R-LOBBY-09, -13, -15 amended.

## What changed

- **Reference set2-v2 in the game** (`strengthReference.v2.json`, 40 boards per round x 4 fights, rounds 1-15), and
  one probe that scores a board at any round: `createStrengthProbe(board, ref, atRound)`.
- **The rating rules live in `@game/sim`** (`lobby/strengthV2.ts`: `rateRunsV2`, `rawRoundsOfRun`,
  `runCompleteV2`). The tools re-export them.
- **SQL** (`2026-11-23-strength-v2.sql`): `boards.strength_carried`, `strength_ref_current()` /
  `strength_ref_last_round()`, the 7-round floor in `pool_run_eligible`, `pool_strength_entries` /
  `pool_strength_round_pcts` (every live, complete run once per round), a board histogram that is that same
  population, and a draw that leaves unscored runs out of any band or cap. `strengthV2.db.test.ts` holds the database
  equal to `rateRunsV2` on a 30-run pool (mutation-checked: two deliberate SQL errors were both caught).
- **Seating**: `seatablePlayerRuns` applies the floor where a table is seated; `runInStrengthBand` puts an unscored
  run outside every band. The hub Worker's `pickRuns` ports the same draw rule; its parity test chain now ends on the
  two newest pool migrations.
- **Run end**: a lobby game that reached round 7 has its final board scored against every later round, in slices of at
  most 6 ms, then uploads once with `strength_carried`. The store's `runScoring` drives the end screen's
  "Calculating Score" lock (text, a transform-only bar of fights done / fights to do, Continue disabled), cleared when
  done and after 5 seconds at the latest.
- **Tools**: `npm run strength -- backfill` now writes `packages/tools/.cache/strength-backfill-v2.sql` (every pool
  board's v2 score plus each run's carried scores, one transaction, UPDATEs of `public.boards` only). The v1 `ref`
  and `backfill` commands are retired.

## Decisions made while building (each can be overruled)

1. **Carried scores are a self-describing jsonb** on every row of the run's final round: `{ ref, rounds }`. An empty
   final board has no `strength_ref` to lean on, so the version rides inside.
2. **The floor is applied where a table is seated, not in `playerRunsFrom`.** A saved game, a replay and the fight
   ledger look runs up by key and must still find one seated before the floor existed. `MIN_RUN_WAVES` (4) stays as
   the "is this a run at all" minimum.
3. **A game under 7 rounds still uploads its boards.** The design said it would not, but the live replay and the
   record board read `public.boards` by run. The database marks the run ineligible, so it is never seated or ranked.
4. **The lock also covers an offline (unrated) lobby game**: its boards go to the pool too.
5. **Run-end scoring runs on the main thread** in 6 ms slices, each its own task through a `MessageChannel` (not
   `requestAnimationFrame`, which stops in a hidden tab, and not `setTimeout(0)`, which is clamped to 4 ms), not in a
   Web Worker.
6. **`pool_strength_refresh` always re-rates every live run** (250 runs x 15 rounds); its key arguments are kept for
   its callers and ignored.
7. **`ops.pool_digest` is a content hash**, so the count of live unscored runs is its own function,
   `pool_live_unscored()`.
8. **Rollout order is SQL first, then Ship Ascent straight away** (the design said hub first): the
   `strength_carried` column must exist before a client that sends it ships. The SQL is ONE generated file
   (`strength-v2-apply.sql`: the migration with the backfill inside its transaction), never the migration alone:
   see the review pass below.
9. **A new regime era** for the Balance Report: `bandsV2Scoring`, formula `earlyLateV2`.
10. `schema.sql` was not appended (it does not hold the 2026-11-22 file either).

## Not done / not verified

- **Not measured in the running game.** The plan's gate (no frame over 20 ms from scoring; a round-12 game unlocks in
  under 2 s on the production build) has not been run. In a jsdom test a 7-round game scored from scratch (2,400
  fights, the worst case with nothing pre-scored) took about 3 s; in real play the real boards are already scored and
  only the carried rounds remain (at most 1,280 fights).
- **The look of the lock** (text and bar above Continue) has not been reviewed by Mike in the running game.
- **Nothing is applied to the live database.** Rollout, for Mike or Kevin:
  1. `npm run strength -- fetch`, then `npm run strength -- backfill` (about 15 minutes of fights). It writes
     `packages/tools/.cache/strength-v2-apply.sql`.
  2. Apply that ONE file (never the bare migration), then `select public.pool_refresh_dirty();`. Check
     `select public.pool_live_unscored();` returns 0.
  3. "Ship Ascent", straight away.
  4. About a week later: `npm run strength -- fetch` and `backfill` again, and apply
     `packages/tools/.cache/strength-backfill-v2.sql` (the top-up) for games uploaded by clients that had not updated.
- An **uncapped custom band** still widens to "no band" and then seats unscored runs. Every medal band has a cap, so
  no rank reaches that step.

## Review pass (one independent whole-branch review, 2026-11-16)

Fixed, each with a test:

- **The migration alone must never be applied to the live database.** On its own it left every run unscored until a
  separate backfill, and the hub that is live until Ship Ascent still seats unscored runs in Bronze, Silver and Gold
  tables (its draw is the old port). `applyV2Sql` now writes one file with the backfill inside the migration's
  transaction, before the pool is re-rated. What remains until the hub ships: a game uploaded in that window by a
  client that has not updated is unscored and the old hub can still draw it into a banded table.
- **The percentile query rescanned the round histogram for every entry** (about 14 million row visits a refresh; 2.5 s
  in PGlite at 250 runs). It is now one pass with window sums; only boards on a round past 15 take the slower path.
- **The 7-round run-end test depended on this machine's speed** (it failed on the reviewer's run at 5.5 s). Its cap
  is lifted in that file (the cap has its own test), and the MessageChannel change took the same work from about
  3 s to about 1.8 s here.
- **Focus**: when the lock lifted, focus jumped to Continue even if the player had opened Match details.
- Found while checking the review's open question: **a carried board was scored with its banked next-combat spells
  live.** A table meets a final board past its round with those already spent, so the probe now builds the side for
  the carried round. This moves carried scores slightly from the Plan 1 measurement (which relabelled the board's
  round instead).

Not fixed, for the owners to weigh:

- **A slow device can still pass 5 seconds**, and that game is then unscored (so it never enters Bronze, Silver or
  Gold tables until a top-up backfill). Short weak games are the Bronze population, so this leans against slow
  devices. The reviewer's suggestion: unlock Continue at 5 s but let the scoring finish and upload afterwards. That
  departs from the design's "goes up with what is ready", so it is Mike's call.
- A game restored from a save and ended before its next captured round queues all its boards at run end.
- `pool_live_unscored()` is not in the daily ops digest yet.
- Games uploaded by clients that have not updated take slots in the 250-run window while unscored, so banded tables
  are thinner during the transition.
- `servingIntegrity.test.ts` no longer has an under-7-round shape (a table cannot seat one); short runs served
  through a saved game are not pinned there.
- The end screen's legacy branch (no rank source) has an unlocked Play Again; whether it is still reachable was not
  determined.

## Older tests that changed

Fixtures lengthened to 7 rounds (seatArmor, seatEmotes, servingIntegrity, railAccuracy, watchedSeats,
telemetryRankAtStart, poolLoader, unratedLobby); scored fixtures where a band is in play (rankedDuos.db,
strengthBands); `boardStrength.db.test.ts` keeps the band rule its (older) migrations shipped with; the reference
size assumptions (30 x 2) became `ref.fightsPerRef`.
