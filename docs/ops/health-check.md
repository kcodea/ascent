# The daily health check (runbook)

Owner ask, 2026-10-31: *"a small daily health check that compares the Cloudflare pool copy against Supabase, confirms
the hub is up, and confirms the end-of-game writes are arriving."* Rule: **R-OPS-HEALTH-01**.

## Reading it (session start)

```sql
select * from ops.health_status;
```

One row. Healthy means `cron_overdue = false` and `cron_failing = 0`.

| column | meaning |
| --- | --- |
| `last_cron_at` | when the hub's cron last recorded a run |
| `cron_overdue` | no cron row in 26 hours. The hub is down, its cron trigger is gone, or Supabase refused the write |
| `cron_failing` / `failing_checks` | failing checks in the latest cron run |
| `last_cli_at` | the last `npm run health -- --record` |

Detail of the latest run, failures first:

```sql
select source, ts, check_name, status, detail from ops.health_latest;
```

Run them through the Supabase CLI login like any other read (`supabase db query --linked`, what `scripts/supabase/lib.mjs`
`runSql` does).

## Running it now

```
npm run health                # print the summary; exit 1 if anything fails
npm run health -- --json      # the raw results
npm run health -- --record    # also append the run to ops.health_checks (source 'cli')
```

It runs the same code as the cron (`workers/versus/src/health/healthCore.ts`). The hub and the Versus Worker are read
over their public routes. Supabase is read through the Supabase CLI login the `db:*` scripts use, as the database admin,
so no key is needed on the dev machine. Needs `supabase/migrations/2026-11-21-ops-health-checks.sql` applied.

## The checks

| check | ok when | n/a when |
| --- | --- | --- |
| `hub` | `ascent-hub` `/health` answers, `min <= hub`, `code` is a real deploy hash (not `dev`) | never |
| `versus_worker` | the current Versus Worker's `/health` carries its own name's protocol and revision | no revision known at all |
| `pool.whole` | the hub's pool mirror and Supabase agree on every eligible run (id, key, rev, boards hash) | the hub does not advertise `pool_mirror` |
| `pool.draw` | the same for one seeded `pool_runs_sample_keys` draw (seed `health:<UTC date>`, 150 runs) | same |
| `writes.lobby` | games were listed, and run_history, boards and lobby_fights rows all arrived in the last 24 h | fewer than 3 lobby games listed (or, with no hub tally, fewer than 3 cloud saves) |
| `writes.versus` | Versus rooms were listed, and Cloudflare `versus_matches` rows arrived | fewer than 2 rooms, or the hub has no tally |
| `writes.duos` | Duos rooms were listed, and `duos_match_history` rows arrived | fewer than 3 rooms, or the hub has no tally |
| `session.flush` | the game session's flush rejected no writes in the window | the hub does not advertise `session`, or `session_cf_writes` does not exist |
| `writer_key` | cron: Supabase accepted the hub's writer secret. CLI: the `ascent-hub` key row exists | never |

Thresholds live in `HEALTH_LIMITS` (`healthCore.ts`).

**Which Versus Worker is "current".** In order: the site's `release.json` (written by `npm run release:web` next to
`index.html` since this change), else the content revision live lobby games were hosted on in the last 7 days (the
directory's tally), else the newest Cloudflare match's `content_revision`. `detail.source` says which one was used.

**"Were games played?"** The Live Games directory on the hub keeps an hourly tally of NEW listings by kind (counts only,
no players, 48 hours; `GET /ops/activity`). A listing is counted once per game, never on its keep-alive.

## When something fails

- **`hub` fails, or `cron_overdue`.** Open `https://ascent-hub.team-ascent.workers.dev/health`. If it answers, look at
  the Worker's logs in the Cloudflare dashboard for `health_record_failed` (Supabase refused the write: usually the
  migration is not applied or the writer key row is gone). If it does not answer, redeploy with `npm run hub:deploy -- --force --persist`.
- **`versus_worker` fails.** `detail.problems` says what the Worker answered. A Worker that carries the wrong revision
  means a pack was cut against a different deploy: re-run `npm run release:web`.
- **`pool.*` fails.** `detail` names the runs: `missing` / `extra` (the mirror's index differs), `stale` (a run's rev
  moved and the mirror has the older one), `byteDrift` (same rev, different boards text: a real bug), `orderDiffers` (the
  seeded draw picked the same runs in another order: the pick port drifted from `pool_runs__pick`). A single `stale`
  run right after an upload is the mirror's 5-minute sync window: re-run `npm run health` a few minutes later. Anything
  else is a bug in the mirror.
- **`writes.*` fails.** `detail.demand` is how many games were listed, `detail.rows` the rows that arrived, `detail.latest`
  the newest row of each table (any age): the time the writes stopped. Look at `ops.events` for `write_failure` /
  `write_rejected` around that time.
- **`session.flush` fails.** `select * from ops.events where source = 'session' and kind = 'write_rejected' order by at desc limit 20;`
- **`writer_key` fails.** The hub's `HUB_WRITER_SECRET` no longer matches a `versus_cf_writer_keys` row. Re-set it with
  `node workers/versus/scripts/writer-secret.mjs ascent-hub` and insert the hash it prints.

## How it is built

- `workers/versus/src/health/healthProtocol.ts`: the shared vocabulary (capabilities, routes, the pool digest format).
- `workers/versus/src/health/healthCore.ts`: the checks, pure (everything they read is handed in).
- `workers/versus/src/health/hubHealth.ts`: the hub's plumbing and record write; `HUB_CAPS` (what `/health` advertises).
- `workers/versus/src/core/liveActivity.ts`: the directory's hourly tally.
- `workers/versus/scripts/health.ts`: the CLI.
- `supabase/migrations/2026-11-21-ops-health-checks.sql`: `ops.health_checks`, the views, `ops.health_probe`,
  `ops.pool_digest`, `ops.health_record`, and the hub's key-gated wrappers (`public.ops_health_*`).

**Why the hub's cron, not pg_cron + an Edge Function.** The hub is the one Worker that is always deployed (never per
content revision), it already holds a Supabase writer key, and the pool mirror and the Live Games directory live inside
it, so the check reads them in-process with no auth route. A pg_cron job would need an Edge Function holding a key to
reach the hub, and could not see the directory's tally. The cost of the hub: if the hub is down, it cannot report
that, which is why the lead's query treats a missing cron row as a failure.

**The hub's fetches.** `hub.wrangler.toml` carries `global_fetch_strictly_public`, so the hub can fetch the Versus
Worker's `/health` (a workers.dev fetch to another Worker on the same account is otherwise refused).

### Turning on pool parity and the session check

The pool mirror and the game session are on `main` (#2493), but the hub does not advertise them yet: the mirror has no
`digest` method, and the session switch is off. The checks are written and stay `n/a` until the hub advertises the capability.

1. **Pool mirror.** Give the `PoolMirror` Durable Object (bound as `POOL`, named `global`) a method
   `digest(params: PoolParams | null): Promise<PoolDigest>`. `params` null: every run in the mirror's index, in run id
   order. Otherwise draw `pickRuns` with those parameters (seeded: `p_seed` is always set). Build the answer with
   `poolDigestOf` from `healthProtocol.ts` over each drawn run's `{ run_id, run_key, rev, boards }`, where `rev` and
   `boards` are the held ones (the exact text `pool_mirror_boards` returned), and add `syncedAt`. Then add
   `HUB_CAP.poolMirror` to `HUB_CAPS` in `hubHealth.ts`. `opsHealth.db.test.ts` pins that `poolDigestOf` over
   `pool_runs_boards` equals `ops.pool_digest` byte for byte.
2. **Session.** Add `HUB_CAP.session` to `HUB_CAPS` once `session_cf_flush` is live. The probe already reads
   `session_cf_writes` and the `ops.events` `write_rejected` rows when they exist.
3. **The cron.** Already shared: `crons = ["*/5 * * * *", "17 6 * * *"]`, and `hubWorker.ts` `scheduled` runs the health
   check at `HEALTH_CRON` and the mirror's sync on every other tick.
