# Reading crash + error reports

Every client report lands in `public.client_crash_reports` (insert-only for clients; read with the service role: the
Supabase CLI or SQL Editor). Sources: `packages/ui/src/errorReport.ts` (desktop exe, desktop browser and phone errors,
crashed sessions, the desktop shell's crash file), `crashReport.ts` (a phone's crashed sessions, full breadcrumbs) and
`phonePerfLog.ts` (`kind = 'perf'`, not a crash). Devlog: `docs/devlog/2026-11-22-desktop-crash-reports.md`.

The `platform`, `kind` and `app_version` columns exist once `supabase/migrations/2026-11-29-client-crash-reports-desktop.sql`
is applied. Before that, read `payload->>'platform'` and `payload->>'kind'` instead.

| column | values |
|---|---|
| `platform` | `desktop` (exe), `web` (desktop browser), `phone` |
| `kind` | `error`, `rejection`, `render`, `crash-session`, `renderer-gone`, `child-gone`, `renderer-hang`, `main-exception`, `main-rejection`, `perf` |
| `build` | `version+sha[-dirty]` of the web bundle; the exe's own version is `payload->'detail'->>'exeVersion'` (shell reports) |
| `last_step` | `kind: name: message` (error rows) or the last breadcrumb (phone crash rows) |

## Queries

The latest 50 (no perf rows):

```sql
select created_at, platform, kind, build, last_step
  from public.client_crash_reports where kind <> 'perf' order by created_at desc limit 50;
```

The playtest view, grouped by error signature:

```sql
select payload->'error'->>'sig' as sig, kind, min(last_step) as example, count(*) as n,
       count(distinct coalesce(user_id::text, payload->>'session')) as players, max(created_at) as last_seen
  from public.client_crash_reports
 where platform = 'desktop' and created_at > now() - interval '7 days' and kind <> 'perf'
 group by 1, 2 order by n desc;
```

Desktop shell crashes with their reason and memory:

```sql
select created_at, kind, payload->'detail'->>'reason' as reason, payload->'detail'->>'processType' as process,
       payload->'detail'->>'memFreeMB' as free_mb, payload->'detail'->>'exeVersion' as exe, payload->'steps' as steps
  from public.client_crash_reports where kind in ('renderer-gone', 'child-gone', 'renderer-hang', 'main-exception', 'main-rejection')
 order by created_at desc limit 20;
```

One report in full: `select payload from public.client_crash_reports where id = <id>;` (`payload.error.stack`,
`payload.componentStack`, `payload.steps` = the last 12 step names with ms since load).

Run any of these with
`npx --yes supabase@2.120.0 db query --linked --project-ref zcwhbejpqcdcfdpfxeza "<sql>"`.

### Spikes

What the spike alert points at: the last 2 hours on one platform, by kind, version and message (swap `'phone'`).

```sql
select kind, app_version, left(last_step, 100) as message, count(*) as n,
       count(distinct coalesce(user_id::text, md5(ua))) as players, min(created_at) as first, max(created_at) as last
  from public.client_crash_reports
 where platform = 'phone' and kind <> 'perf' and created_at > now() - interval '2 hours'
 group by 1, 2, 3 order by n desc limit 20;
```

The digest the hub reads, as the CLI (the database admin) sees it: `select ops.crash_digest_hour(now());` and
`select ops.crash_digest_day(current_date - 1);`.

## Limits worth knowing when reading counts

The client sends one report per error signature per page load, at most 5 errors a load and 20 reports a device a day,
so a count is "loads that hit it", not "times it was thrown". The server refuses more than 100 rows a day from one
signed-in player and 300 an hour from rows with no user.

## Alerts (Discord)

R-OPS-HEALTH-04 (owner 2026-11-22: alerts for crash SPIKES, not one message per crash). The hub (`ascent-hub`) posts to
the same Discord webhook as the health alert (`ALERT_DISCORD_WEBHOOK`, [`health-check.md`](health-check.md#alerts-discord));
without that secret it does nothing at all. Code: `workers/versus/src/health/crashAlert.ts`.

**The data.** `supabase/migrations/2026-11-30-ops-crash-digest.sql` adds `public.ops_crash_digest(p_key, p_mode, p_at)`,
key-gated with the hub's writer secret like `ops_health_probe`. It returns counts only: per platform the last hour's
reports, players, kinds and app versions (each with when it was first seen in the last 7 days), the top 3 messages
(`last_step`, already redacted on the client), and the hourly baseline over the 168 hours before (mean, stddev, max;
quiet hours count as zero). `p_mode = 'day'` returns yesterday (UTC) by platform and kind against the 7 days before.
`perf` rows never count. "Players" = distinct signed-in users, or distinct devices (by user agent) for rows with no
user. It reads only top-level columns through the `created_at` index, never `payload`, so it stays far under the anon
role's 3 s ceiling (R-OPS-HEALTH-02): 80 ms (hour) / 32 ms (day) on a PGlite bench of 21,000 rows, about 50x the
live volume.

**The rule** (constants at the top of `crashAlert.ts`):

| | |
|---|---|
| evaluated | every 15 minutes (the :00 / :15 / :30 / :45 ticks of the hub's 5-minute cron) |
| spike | last hour >= max(`SPIKE_MIN` 5, `SPIKE_FACTOR` 3 x the platform's 7-day hourly mean) |
| bad build | an app version (or a crash kind) first seen in the last 24 h with >= 3 reports from >= 2 players in the hour |
| while it lasts | at most one message per platform every 2 hours (`CRASH_REMIND_MS`) |
| back to normal | one message after 30 quiet minutes (`CRASH_CLEAR_MS`), so a sliding hour cannot flap it |
| morning summary | 06:20 UTC: yesterday by platform and kind vs the 7-day average, the top 3 messages, the health check line; nothing on a day with no crash reports; the hub var `CRASH_DAILY_SUMMARY=off` turns it off |

What the messages look like:

```
**ASCENT crashes: phone crash spike** (2026-11-22 14:30 UTC)
14 reports in the last hour from 9 players. Normal: 0.6 an hour over the last 7 days (alert at 5).
Kinds: crash-session 12, error 2
App version: 0.42.0 (13), 0.41.3 (1)
New build 0.42.0: 13 reports from 8 players, first seen 2026-11-22 13:52 UTC
Top:
- crash-session: combat start (8)
- error: TypeError: x is undefined (2)
How to look: the "Spikes" query in docs/ops/crash-reports.md (last 2 hours by kind, version and message).
```

```
**ASCENT crashes: phone back to normal** (2026-11-22 17:45 UTC)
High since 2026-11-22 14:30 UTC; peaked at 30 reports in an hour. Last hour: 1.
```

```
**ASCENT daily, 2026-11-22**: 37 crash reports from 21 players (7-day average 41 a day)
- phone 30 (avg 35): crash-session 28, error 2
- desktop 7 (avg 6.0): renderer-gone 4, error 3
Top:
- phone crash-session: combat start (11)
- desktop renderer-gone: oom (4)
- phone crash-session: shop open (3)
Health check 06:17 UTC: all green.
How to look: docs/ops/crash-reports.md
```

Messages mention nobody (`allowed_mentions` is empty) and carry no email, user id, user agent or stack; message text
is scrubbed again on the hub (emails, ids, long tokens, URL queries, `@`). An undelivered message is retried at the
next evaluation. State: one record, `ops:crash_alert`, in the Live Games directory object beside `ops:health_alert`.

**Turning it on:** apply `supabase/migrations/2026-11-30-ops-crash-digest.sql` (after the health-check file and the
desktop crash-report file), then `npm run hub:deploy -- --persist`. The webhook secret is the health alert's; nothing
else to set.
