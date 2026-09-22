# Hall of Champions: runs ranked by the games they have won against other players

**Date:** 2026-09-22 · **Branch:** `feat/hall-board-records` · **Owner asks:** "change hall of champions to be
basically a board showcase of the boards that have won the most games, including the win from the player's game
… this should only be lobby mode wins, and it should be sorted by most wins" — then, on how a served run earns
its record: "track the run that beat the player when they were knocked out … if i play a board that wins on turn
14 and it knocks a player out on turn 9, that board should probably get a win. subsequently, if that same board
is served to a player and it comes in 3rd against the player on turn 13, my board should get a loss recorded."

## What a win is

A finished run is served into other players' lobbies as a **recorded seat** (`author|heroId|seed`, the key
`playerRunsFrom` groups the pool by), replaying its boards round by round. Its record is what it did **against
the player it was served to**:

- it knocked that player out → a **win** (the seat the player lost their last fight to; a ghost counts, it was
  still that run's board);
- it was knocked out while that player still stood → a **loss**;
- it was still standing when the player fell, or fell in the same round without felling them → **nothing** was
  decided between them, no row.

Plus the one win the run earned for the player who built it. No draws. A run nobody has been served yet reads
1–0.

## Why not play the table out

The first cut of this branch resolved the remaining rounds headlessly after the player's knockout, so every seat
got a placement and "won the lobby" could be counted. Two things were wrong with it. It measured a simulation
nobody watched rather than what happened against a real player, and it collided with the balance instrument,
which already plays its pilot's table out itself and records each round: a reducer-side play-out finished the
table underneath it, and its suite caught a seat reading 0 health at the round the pilot died. The knockout
rule needs none of that: everything it reads is already in the lobby state when the player's run ends. The
play-out, its lobby rule and its tests are gone.

## The ledger

`seat_results`, one row per recorded seat with a result: `run_key`, `outcome` ('win' | 'loss'), `round`,
`player_placement`, `lobby_seed`, `seats`, `mode`, `patch`, `user_id`. Rows are built by the pure
`seatOutcomesOf(lobby, patch)` in the sim and written by `recordSeatResults` at the end of every real lobby via
the same fire-and-forget / offline-queue path as every other upload, as an upsert on `(lobby_seed, run_key)`
with `ignoreDuplicates`, so a restored-and-finished-twice run can never count a table twice.

## The Hall

Per the owner's layout: the left is the hero, the player and the hero name (no W–L–D of the run's own rounds);
the middle is exactly the Recent Games presentation (Final team + Runes, no round pips); the right is the record
"X–Y" in place of VICTORY (they are all winners), the date of its most recent win, and the rank the player held
when they won it. That rank comes from the career row `settle_rank` stamps (`run_history.entry.rank.before`,
read by seed through `fetchHallRanks`); a run that was never rated shows no rank.

`Leaderboard.tsx` pulls a pool of 200 lobby victories, one chunked `fetchSeatRecords` call for every row's run
key (built from the row's own stored board by `hallRunKeyOf`, falling back to the row's author), folds through
`hallRecordOf`, ranks by wins with fewer losses then recency as the tiebreak, and cuts to 20. "Most wins" is the
default; "Most recent" stays as a second sort.

Until the table exists, `fetchSeatRecords` returns an empty map and every entry reads 1–0 with "Not yet served
to anyone", which is true.

## Owner runbook: create the table (one time)

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Paste the whole of `supabase/migrations/2026-09-22-seat-results.sql` (the same block is at the bottom of
   `schema.sql`). Click **Run**. It is idempotent; re-running is safe.
3. Verify with the anon REST probe (replace the URL and key with the two values in `.env`):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$VITE_SUPABASE_URL/rest/v1/seat_results?select=run_key&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
   ```

   `200` means the table exists and is readable. Before step 2 it answers `404`.
4. Nothing else. Rows arrive as lobbies finish; the count starts from zero, so every Hall entry reads 1–0 until
   its run has been served somewhere and decided something.

## Oracle

`R-LOBBY-02` pins the record definition. Enforced by `packages/sim/src/lobby/seatOutcomes.test.ts`,
`packages/ui/src/hallRecord.test.ts` and `packages/ui/src/seatLedger.test.ts`.
