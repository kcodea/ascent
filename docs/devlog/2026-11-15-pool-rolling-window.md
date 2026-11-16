# 2026-11-15: the opponent pool is a rolling window of the newest 250 runs

Rule R-POOL-ROLLING-01; migration `supabase/migrations/2026-11-22-pool-rolling-window.sql`; test
`packages/sim/src/lobby/poolRollingWindow.db.test.ts`; design
`docs/superpowers/specs/2026-11-15-pool-rolling-window-design.md`.

## Why

Owner: "its tough facing strong boards that are now weakened due to balancing changes", "lets do newest 250 runs".
A recorded run keeps the boards it was built with, and every eligible run was drawn with equal chance however old it
was. Measured on production, 2026-11-15 (read-only):

- 551 eligible runs (559 total), 6,973 boards, 11 players, all `set2`, the oldest from 2026-08-17.
- 225 runs (41%) were more than five weeks old.
- 50 to 80 new runs a week, so 250 runs is about the last four weeks.
- 477 of the 551 are stamped patch `0.1.0+`, so the app version cannot mark a run's age. `pool_runs.id` (upload order)
  can.

## What changed

Almost all in SQL. No client change and no app release. One hub (Worker) fix ships with it and must be deployed FIRST
(see "To apply").

- `pool_runs.live`: true for the newest `pool_live_limit()` (250) eligible runs of each set, by `id`. A run gets its id
  when its first board arrives (so "newest" is the order runs were STARTED in) and keeps it when boards are added,
  re-uploaded or re-scored, so an old run does not come back. The one exception: a run whose every board was deleted
  and uploaded again gets a new id.
- The hub mirror deletes dropped runs in chunks (`deleteInChunks`, `workers/versus/src/core/poolMirrorCore.ts`). A
  Durable Object deletes at most 128 keys per call; one call with about 300 keys would fail, the sync would never
  adopt the new index, and the hub would keep serving the whole old pool. Found by the branch review.
- `pool_live_refresh()` re-marks the flag. The once-a-minute job (`pool_refresh_dirty`) calls it after adding new runs
  and, when the window moved, re-ranks strength in full (once).
- `pool_runs_sample` and `pool_runs__pick` draw from `eligible and live` (the two picking blocks are still identical;
  the new test compares the texts). `pool_runs_sample` now carries `set work_mem = '16MB'` in its own definition.
- The hub mirror's `pool_mirror_version` / `pool_mirror_index` and the health check's whole-index digest read live runs,
  so the hub drops a run on its next sync after it leaves the window. The draw port (`poolPick.ts`) is untouched: it
  only ever sees what the index holds.
- Run strength (`pool_strength_refresh`) ranks live runs among themselves and writes only live rows. A run outside the
  window keeps its last number. The run histogram a client ranks its own game against holds live runs only. The board
  histogram is unchanged.

## What did not change

- Nothing is deleted. Career, match details, replays and the balance tools read every run. A saved game keeps its
  table because the save carries its seats' recordings (R-LOBBY-SERVE-01).
- A game client that is already running keeps the runs it loaded (registration only adds) until it restarts, and the
  7-day last-good cache can re-register old runs when the network sample fails. Both are bounded.
- God Mode's board sample reads every run.
- Ranked Duos' recorded duo TEAMS (`duo_runs`, `duo_runs_sample`) are a separate, small pool and are not windowed.
  Solo runs that fill Ranked Duos seats come through `pool_runs_sample` and follow the window.

## To apply (a developer)

In this order:

1. **Deploy the hub** from a commit that has `deleteInChunks`. If that is not possible, step the number down instead
   (for 551 runs: 430, then 310, then 250, one 5-minute sync apart) so no sync drops more than 128 runs.
2. `npm run db:apply -- supabase/migrations/2026-11-22-pool-rolling-window.sql --yes`. It refuses to run before
   `2026-11-20-game-session-cf.sql` and `2026-11-21-ops-health-checks.sql` (it replaces functions they create).
3. Check a signed-in player can read the new column (the draw runs as the caller):
   `select has_column_privilege('authenticated', 'public.pool_runs', 'live', 'select');` must be true.
4. `npm run db:drift`, and `npm run health` after the hub's next sync.

Nothing changes for players until step 2. Re-running an earlier pool migration afterwards puts its old filter back
(drift reports it as OLDER): re-apply this file after it. The patch note ships with the client, so it is only true
once the SQL is applied.

## To change the number

Replace `public.pool_live_limit()` (one line), then:

```sql
select public.pool_live_refresh();
select public.pool_strength_refresh(null, null, null);
select public.pool_strength_hist_refresh();
```

Raising it brings older runs back; nothing was deleted.

## Notes for the next session

- The first sync after applying, the hub mirror's version changes and it drops about 300 runs.
- `pool_runs_rebuild()` does not re-mark the window; run `pool_live_refresh()` after it.
- `scripts/egress-game-probe.mjs` still builds its stand-in mirror index from `eligible` alone (not updated here).
- A new function that seats a table must filter `eligible and live`. `eligible` alone means "a whole, servable run".
- With 250 live runs and the client's limit of 150, the draw takes the small-pool branch (`span <= 4 * limit`) unless
  ineligible runs open large gaps in the id range.
