# 2026-11-22 · A daily, batched retention cleanup (`ops-retention`)

Branch `chore/db-retention-cleanup`. Rule R-OPS-RETENTION-01 (approved/persistence.ts). Owner approved building it
2026-11-22. Migration `supabase/migrations/2026-11-27-ops-retention.sql` (NOT applied by the PR). Runbook
`docs/ops/retention.md`.

## What

`ops.retention_rules` (one row per rule: enabled, keep_days, batch_limit, last run stats) and `ops.retention_run(p_dry_run
default true)`, scheduled daily at 03:37 UTC. Four rules, all shipped enabled: `perf_runs` (60 days), `versus_1v1_leftovers`
and `versus_group_leftovers` (the submissions / rounds / fights of matches COMPLETE more than 30 days; the match and seat
rows are never deleted) and `anon_empty_users` (anonymous, idle 30 days, no recent session, id in no user-linked column;
500 a day). Each run logs an `ops.events` row (`source = 'retention'`).

## Decisions worth knowing

- **Nothing was excluded from the Versus rules.** Checked who reads the child rows of a finished match: the Worker only
  writes them, the client gets rounds over the socket, Duos history and the duo run recording are copied at game end
  (`duos_match_history`, `duo_runs` / `duo_run_rounds`), room records read `versus_matches`. The one late reader is
  `settle_progression`'s "a committed round exists" gate: an already-settled claim dedupes before it, so only a match
  never settled within 30 days loses its XP claim. A later re-run of `duos_history_backfill()` would find no boards for
  such a match, but it only adds games not yet recorded, and it already ran.
- **The "owns nothing" check is built from the catalog on every run** (`ops.retention__user_columns()`): FK-to-auth.users
  columns plus uuid / uuid[] columns named like a user reference. Beyond the brief's name list it also matches
  `requester`, `owner(_id)`, `actor`, `players`, `member%`, `%_by`, uuid[] columns and `storage.objects` owners: each can
  only keep a user. Unlike the older by-hand `maint.anon_purge_*` (2026-11-07), it does not regex-scan jsonb/text for ids
  (too heavy for a daily job); the ids inside `duo_runs.members` are also in `versus_group_seats.user_id`.
- **Bounded:** at most batch_limit rows per table per run, lock_timeout 3 s, one sub-transaction per rule, an advisory
  lock against overlapping runs, and the cron command sets statement_timeout 10 min. Users are locked
  `for update skip locked` and re-checked at delete.
- Deleted space is reused, not returned: the reported DB size only drops after a VACUUM FULL.

## Verified

`packages/ui/src/opsRetention.db.test.ts` (PGlite, stub auth/storage, the cron block skipped by its own guard).
