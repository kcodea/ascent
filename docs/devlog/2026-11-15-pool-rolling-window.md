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

All in SQL. No client change, no Worker deploy, no app release.

- `pool_runs.live`: true for the newest `pool_live_limit()` (250) eligible runs of each set, by `id`. A run keeps its
  id when its boards are re-uploaded or re-scored, so an old run never comes back.
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

- Nothing is deleted. Career, match details, replays and the balance tools read every run; `pool_runs_boards` still
  serves any run by id, so a saved game keeps its table.
- God Mode's board sample reads every run.
- Ranked Duos' recorded duo TEAMS (`duo_runs`, `duo_runs_sample`) are a separate, small pool and are not windowed.
  Solo runs that fill Ranked Duos seats come through `pool_runs_sample` and follow the window.

## To apply (a developer)

`npm run db:apply -- supabase/migrations/2026-11-22-pool-rolling-window.sql --yes`, after `2026-11-20-game-session-cf.sql`
and `2026-11-21-ops-health-checks.sql` (it replaces functions they create; applied before them, they would put the old
filter back). Nothing changes for players until then. Then `npm run db:drift`.

## To change the number

Replace `public.pool_live_limit()` (one line), then:

```sql
select public.pool_live_refresh();
select public.pool_strength_refresh(null, null, null);
select public.pool_strength_hist_refresh();
```

Raising it brings older runs back; nothing was deleted.

## Notes for the next session

- The first minute after applying, the hub mirror's version changes and it drops about 300 runs in one sync.
- A new function that seats a table must filter `eligible and live`. `eligible` alone means "a whole, servable run".
- With 250 live runs and the client's limit of 150, the draw takes the small-pool branch (`span <= 4 * limit`) unless
  ineligible runs open large gaps in the id range.
