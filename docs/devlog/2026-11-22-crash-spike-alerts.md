# 2026-11-22 — Crash-spike alerts and a morning crash summary on Discord

**What.** Owner ask: tell a human when players start crashing, not once per crash. The hub (`ascent-hub`) now checks
the crash reports every 15 minutes and posts to the same Discord webhook as the health alert (R-OPS-HEALTH-03) when a
platform spikes (last hour >= max(5, 3x its 7-day hourly mean)) or a new build or crash kind (first seen in the last
24 h) has >= 3 reports from >= 2 players. One message per platform per 2 hours while it lasts, one "back to normal"
after 30 quiet minutes. At 06:20 UTC one message sums up yesterday by platform and kind against the 7-day average,
with the top 3 messages and this morning's health check line; a crash-free day posts nothing. R-OPS-HEALTH-04.

**How.** `workers/versus/src/health/crashAlert.ts` (pure rule + messages, plumbing on injected IO), wired in
`hubHealth.ts` (`runCrashWatch`) and the hub's 5-minute cron; state `ops:crash_alert` in the directory object beside
`ops:health_alert`. Supabase side: `supabase/migrations/2026-11-30-ops-crash-digest.sql`, a key-gated
`public.ops_crash_digest` returning counts only (no ids, user agents, payloads or stacks).

**Speed.** Designed against the R-OPS-HEALTH-02 failure (the anon role's 3 s ceiling cancelled the cold health
probe): the digest reads only top-level columns of the 7-8 days it needs through the existing `created_at` index and
never touches the TOASTed `payload`. PGlite bench, 21,000 rows over 7 days (~50x live volume): hour 80 ms, day 32 ms.

**Verified.** `workers/versus/test/crashAlert.test.ts` (detection, rate limit, recovery, summary text, timing,
scrubbing, no-secret no-op, undelivered retry) and `workers/versus/test/opsCrashDigest.db.test.ts` (PGlite: key gate,
shapes, windows, nothing identifying, speed).

**To turn on.** Apply `2026-11-30-ops-crash-digest.sql`, then `npm run hub:deploy -- --persist`. Neither done in this
PR. The "how to look" hint points at the dashboard Health tab (#2845: crashes by build and last step) and the
"Spikes" SQL in `docs/ops/crash-reports.md`.
