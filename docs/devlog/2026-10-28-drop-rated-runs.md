# 2026-10-28 — Drop the unused `rated_runs` table (Supabase cleanup 2.6)

Migration: `supabase/migrations/2026-11-07-drop-rated-runs.sql` (not applied by the builder). Scope:
[`docs/design/2026-10-28-supabase-cleanup.md`](../design/2026-10-28-supabase-cleanup.md), RETIRE-now.

`rated_runs` was the C3 dedupe/rate-limit ledger of the first `submit-rating` function; the medal rank (2026-09-20)
moved settlement to `settle_rank` + `rank_results`. Proof it is unused, measured read-only on production today: 0 rows
and 0 writes since the 2026-10-12 stats reset; no function body, view, trigger, policy, publication entry, cron job or
foreign key references it; its 3 index scans are the FK checks of auth-user deletes; no code in `supabase/functions`,
`packages`, `apps`, `workers` or `scripts` names it. The migration refuses to drop the table if it ever holds a row,
and carries the C3 definition as its rollback. `supabase/README.md`'s submit-rating section now names `rank_results`.

Verification: `packages/tools/src/dropRatedRuns.db.test.ts` (PGlite: drops the empty table, re-run is a no-op, a table
with a row is refused and kept).
