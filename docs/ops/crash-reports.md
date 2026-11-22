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

## Limits worth knowing when reading counts

The client sends one report per error signature per page load, at most 5 errors a load and 20 reports a device a day,
so a count is "loads that hit it", not "times it was thrown". The server refuses more than 100 rows a day from one
signed-in player and 300 an hour from rows with no user.
