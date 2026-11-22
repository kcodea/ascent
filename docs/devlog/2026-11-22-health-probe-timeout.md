# 2026-11-22 — Health probe timeout: pre-computed before the hub asks

**What broke.** The daily health check (hub cron, 06:17 UTC) recorded four failures on 2026-11-21 and 2026-11-22
(`writer_key`, `writes.lobby`, `writes.versus`, `writes.duos`), all `57014 canceling statement due to statement
timeout`. Writes were healthy (games were landing); the check itself was being cancelled.

**Why.** The hub calls `public.ops_health_probe` through PostgREST with the anon key, and the `anon` role has
`statement_timeout = 3s`. Measured live: the probe takes ~3.25 s on a cold database, ~30 ms warm. It only started
failing on 2026-11-21 because that is when the probe was added (`2026-11-21-ops-health-checks.sql`).

**Fix.** `2026-11-28-health-probe-cache.sql`: pg_cron (`ops-health-probe-warm`, 06:10 UTC) computes the probe as the
owner into `ops.health_probe_cache`; the wrapper answers from it when fresh (30 min) and the window matches (2 h),
live otherwise. R-OPS-HEALTH-02, `workers/versus/test/opsHealthProbeCache.db.test.ts`.
