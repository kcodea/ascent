# 2026-10-28 — Opponent pool work moves off the board upload (Supabase cleanup 2.1-2.3)

Scope: [`docs/design/2026-10-28-supabase-cleanup.md`](../design/2026-10-28-supabase-cleanup.md) sections 3.1a, 3.2, 4.2.
Migration: `supabase/migrations/2026-11-07-pool-refresh-off-upload.sql` (not applied by the builder). Rule:
R-LOBBY-POOL-JOB-01 (`packages/rules/src/registry/approved/persistence.ts`).

**Problem.** A board upload averaged 1.35 s (max 7.7 s, against the 8 s statement timeout) because its statement
triggers rebuilt the run's `pool_runs` row and ran `pool_strength_refresh` inside the request. A new run has no
`strength_at`, which the "stale after 10 minutes" check reads as -infinity, so every new run's upload did a FULL refresh
of every pool run (84,191 `pool_runs` updates from 2,399 inserts in 16 days). Both triggers caught every error and only
raised a warning. Separately, `pool_runs_sample` wrote its ~3.6 MB answer to a temp file on every call (work_mem 2 MB):
13.9 GB of temp writes, and `board_strength_histogram` grouped every scored board on each of 7,055 calls.

**Change.**
- `pool_runs_sample` gets `set work_mem = '16MB'`. Read-only EXPLAIN ANALYZE on production, same 150 rows: 930 ms with
  1,246 temp blocks at the default, 131 ms and no temp file at 16 MB. Any later `create or replace` of the sample must
  repeat the setting (the new test pins it).
- The `boards` triggers now only upsert the touched run keys into `pool_dirty` (errors propagate). `pool_refresh_dirty()`,
  scheduled by pg_cron every minute (`pool-refresh`), claims the queue by deleting it, then does what the triggers did
  in the same order: `pool_runs_upsert_from` per key (first queued first, so new runs get ids in upload order), and
  when a queued statement carried a scored board, `pool_strength_refresh` with the same full/partial rule. A failure
  rolls back (keys stay queued, `attempts` + `last_error`) and writes `ops.events`.
- `board_strength_hist` / `run_strength_hist` cache the two histograms; the RPCs read them (same signature, rows and
  order, now SECURITY DEFINER because the cache tables are closed to clients). The job rebuilds them.
- `ops.events` (private `ops` schema, service role only) is the failure log the cleanup's digest will read.
- `cron-history-purge` keeps 7 days of `cron.job_run_details` (a per-minute job adds ~1,440 rows a day).

**Serving integrity.** `pool_runs_sample`'s body is untouched. `packages/sim/src/lobby/poolRefreshJob.db.test.ts` runs
the current production chain and the chain plus this migration side by side in PGlite through 30+ uploads, partial
re-uploads, a backfill update and deletes; after every step the `pool_runs` rows (ids included), both histograms and
48 seeded samples (bands, early weights, caps, the own-run exclusion) are identical. Mutation-checked: dropping the
full-refresh rule or reversing the queue order fails it.

**Measured locally (PGlite, 400 runs x 12 boards):** upload 63 ms -> 1.1 ms; one job draining 20 runs 192 ms (vs
~1.27 s spent across 20 uploads before); `board_strength_histogram` 22.6 ms -> 12.6 ms.

**Effect for players:** none visible, except a new run joins the opponent pool up to one minute after its upload.

**Lead:** apply after the ledger migration if that has landed (`npm run db:apply -- <file> --yes`), then
`select public.pool_refresh_dirty();` once and watch `cron.job_run_details` for `pool-refresh`. Rollback block is in the
migration header. Re-measure with `npm run db:measure` after a day: `insert:boards` mean and `rpc:pool_runs_sample`
temp written should both collapse.
