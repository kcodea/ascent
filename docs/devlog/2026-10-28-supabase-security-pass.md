# 2026-10-28 · Supabase security pass (cleanup Phase 3)

Phase 3 of [`docs/design/2026-10-28-supabase-cleanup.md`](../design/2026-10-28-supabase-cleanup.md) (S1, S2, S3).
Two migration files, applied by the lead in order, a release apart:

1. **`supabase/migrations/2026-11-07-security-writes.sql` (apply now).** Drops the `boards` policy
   `anon insert ... with check (true)` (anyone with the public key could write boards for any user into the
   opponent pool; zero such inserts measured 2026-10-12..28). Then, for `anon` and `authenticated` on every
   table and view in `public`: revokes TRUNCATE / REFERENCES / TRIGGER / MAINTAIN, and revokes INSERT / UPDATE /
   DELETE wherever no RLS policy allows that command for that role. That last part is decided from `pg_policy`
   at apply time, so it can only remove writes RLS already refused. Measured on prod: it trims 126 role-table
   write grants and keeps exactly the client writes (boards, board_results, lobby_fights, practice_games,
   run_history, run_telemetry, runs: insert; perf_runs: insert + delete; profiles: insert + update;
   client_crash_reports: the column insert grant). Future `postgres`-created tables no longer default-grant
   TRUNCATE / REFERENCES / TRIGGER / MAINTAIN. INSERT / UPDATE / DELETE defaults are left alone on purpose.
2. **`supabase/migrations/2026-11-09-security-reads-need-session.sql` (apply one release later).** run_telemetry,
   boards, practice_games, runs, lobby_fights, board_results, pool_runs (and the `run_fight_records` view, the pool
   and histogram RPCs) answer `authenticated` only. Every player has a session (anonymous sign-in at boot), so
   only the bare public key loses access. Small public reads stay public.

Client side: boot-time reads of those tables used to race the first anonymous sign-in (prod showed ~1,200
`pool_runs_sample` and ~3,500 `board_results` calls as `anon` in 16 days). `remoteBoards.ts` now has `sessionReady`
(waits for `initIdentity`'s promise, at most 6 s, once per load) used by the pool loader and every large-table
read. Read-only dev tools use the service-role key from the untracked root `.env` when present
(`packages/tools/src/supabaseReadKey.ts`) and never sign in, so they do not mint anonymous users.

Proof: `packages/ui/src/securityGrants.db.test.ts` (PGlite, production policies, every client write and read
shape before and after both files, each applied twice). Rules R-SEC-WRITES-01 and R-SEC-READS-01.
