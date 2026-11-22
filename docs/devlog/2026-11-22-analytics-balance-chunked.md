# 2026-11-22: analytics-v2 migration fixed for the Free plan's disk (chunked balance rollup)

Applying `supabase/migrations/2026-11-29-analytics-v2.sql` (merged in #2845) to the live database failed and rolled back
entirely: `ERROR 53100: could not write to file "base/pgsql_tmp/..." No space left on device`, inside the one-shot
all-history backfill (`analytics.balance_rollup_catchup()` -> one `INSERT ... GROUP BY ... array_agg(distinct)` over
every run's card arrays). The database was 320 MB of 500 MB, with `run_telemetry` ~147 MB, so the sort spill did not fit.
Nothing of the file was live, so the file itself is fixed (no second migration):

- **No backfill in the migration.** It creates the tables, functions and cron job only (bench: ~15 ms, 0 temp on ~50k games).
- **One UTC day per aggregate.** `analytics.balance_rollup_day(day)` rolls up one day's runs (work_mem 16 MB; bench: slowest
  day 55 ms, 0 temp even at the Free plan's 2 MB). `analytics.balance_rollup_catchup(n)` does at most n days, oldest first,
  and records progress in `analytics.balance_rollup_state`; the nightly job runs it with n = 14.
  `analytics.balance_backfill_step(n)` is the same call by name for the lead to fill history sooner.
- **Per-run de-duplication inside each run** (no wide global sort on the arrays).
- **The Balance read** reads only today live (never the whole un-rolled history), carries no player keys through its sorts,
  reads final boards row by row, and sets its own work_mem (32 MB): All time on ~50k games went from 295 MB of temp to 0.
  The page says which days the card and rune numbers cover while history fills.
- **Every other analytics read** sets work_mem 16 MB: All time on ~50k games writes 0 temp (it wrote 6-42 MB at 2 MB).
