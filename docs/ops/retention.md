# The daily retention cleanup (runbook)

Rule: **R-OPS-RETENTION-01**. Migration: `supabase/migrations/2026-11-27-ops-retention.sql`. Test:
`packages/ui/src/opsRetention.db.test.ts`.

pg_cron runs `ops.retention_run(false)` every day at **03:37 UTC** (job `ops-retention`), well away from the 06:17 UTC
health check. Each enabled rule deletes at most `batch_limit` rows per table, so a backlog drains over a few days and no
run ever holds a long lock (lock_timeout 3 s; each rule runs in its own sub-transaction, so one failing rule records its
error and the others still run).

## The rules

| rule | deletes | keeps | default keep / batch |
| --- | --- | --- | --- |
| `perf_runs` | `public.perf_runs` older than keep_days | everything newer | 60 days / 5000 |
| `versus_1v1_leftovers` | `versus_submissions` + `versus_rounds` of a `versus_matches` row that is `complete` and ended more than keep_days ago | the match row always; live and recent matches untouched | 30 days / 5000 per table |
| `versus_group_leftovers` | `versus_group_submissions` + `versus_group_fights` + `versus_group_rounds` of a `complete` `versus_group_matches` row that ended more than keep_days ago | the match row and `versus_group_seats` always | 30 days / 5000 per table |
| `anon_empty_users` | anonymous `auth.users` (no email / phone), last sign-in (or creation) older than keep_days, no session updated or refreshed within keep_days, and whose id is in no user-linked column | every non-anonymous user; any user whose id is anywhere | 30 days / 500 |

"User-linked columns" are read from the catalog at every run, so a new table is covered without touching the function:
every uuid / uuid[] column of a public table with a foreign key to `auth.users(id)`, plus every uuid column named like a
user reference (`%user%`, `sender`, `recipient`, `reporter`, `blocker`, `blocked`, `author_id`, `from_user`, `to_user`,
`user_a/b`, `user_lo/hi`, `watched_user`, `bot_user`, `host_user(_id)`, `p1_user`, `p2_user`, `requester`, `owner(_id)`,
`actor`, `players`, `member%`, `%_by`), plus `storage.objects.owner` / `owner_id`. See exactly what is scanned:

```sql
select * from ops.retention__user_columns();
```

Why the Versus child rows are safe to drop after 30 days: nothing reads them for a finished match. The Worker only
writes them; the client gets rounds over the socket; Duos history and the duo run recording are copied at the end of the
game (`duos_match_history`, `duo_runs` / `duo_run_rounds`); room records read `versus_matches`. The one late reader is
`settle_progression`, which needs a committed round before it awards Versus / spectate XP: a claim already settled is
answered from its ledger first, so only a match nobody settled within 30 days of its end loses that XP claim.

## Dry run (any time, deletes nothing)

```sql
select ops.retention_run(true);   -- or just select ops.retention_run();
```

Returns `{ dry_run, deleted: 0, failed, rules: { <rule>: { candidates, deleted, tables?, ms, ... } } }`. `candidates`
is everything that qualifies right now (a real run takes at most `batch_limit` of it).

## Status

```sql
select rule, enabled, keep_days, batch_limit, last_checked_at, last_dry_run, last_candidates, last_deleted,
       last_error, last_deleted_at, total_deleted from ops.retention_rules order by rule;
select at, kind, detail from ops.events where source = 'retention' order by at desc limit 5;   -- 'run' / 'dry_run' / 'error'
select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'ops-retention')
  order by start_time desc limit 5;
```

## Toggle or tune a rule

```sql
update ops.retention_rules set enabled = false where rule = 'anon_empty_users';
update ops.retention_rules set keep_days = 90, batch_limit = 2000 where rule = 'perf_runs';
```

`keep_days` must be at least 7 and `batch_limit` 1..50000 (table checks). The change applies at the next run.

## Database size

Deleting rows does **not** shrink the size the dashboard reports. Postgres marks the rows dead and autovacuum makes that
space reusable, so the database stops growing into it, but the files keep their size until a `VACUUM FULL` of the table
(it takes an exclusive lock and rewrites the table: a planned, by-hand step, never the cron).

## Rollback

```sql
select cron.unschedule('ops-retention');
```

The full drop list is at the top of the migration. Deleted rows cannot be restored.
