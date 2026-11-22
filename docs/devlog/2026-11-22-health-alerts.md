# 2026-11-22 — The daily health check now alerts on Discord

Owner ask: when the daily ops health check fails, alert a human. It had been failing for two days and nobody looked at
`ops.health_status`. Rule R-OPS-HEALTH-03. Runbook: `docs/ops/health-check.md` ("Alerts (Discord)").

- **What.** After each daily cron run the hub posts to the Discord webhook in the Worker secret `ALERT_DISCORD_WEBHOOK`:
  at once when a check starts failing (or a new one joins), a reminder at most once per daily run while it stays
  failing (23 h, so the cron's seconds of jitter never skip a day), and one "all green again" on recovery. A refused
  `ops_health_record` counts as a failing `record` check.
- **Watchdog.** The first 5-minute cron tick of each hour checks when the daily run last completed; past 26 h it alerts
  `cron_overdue`. It shares the hub, so a hub that is wholly down still cannot alert: documented as a follow-up (pg_cron +
  pg_net on `ops.health_status`, or an uptime monitor). No email path: the stack has no email sender.
- **State.** One record (`ops:health_alert`) in the Live Games directory object's storage, not Supabase: no migration,
  and the hourly watchdog costs no egress. An undelivered message leaves it unchanged so the next run retries.
- **Safety.** No secret = nothing sent or stored, one log line per isolate. The URL is never logged (errors log the HTTP
  status only); messages set `allowed_mentions: { parse: [] }`.
- **Code.** `workers/versus/src/health/healthAlert.ts` (pure rule + message + injected plumbing), wired in
  `hubHealth.ts` `runAndRecord` and `hubWorker.ts` `scheduled`. `healthCore.ts` exports `failReason` (shared with
  `formatSummary`). Tests: `workers/versus/test/healthAlert.test.ts`.
- **Live after** the owner sets the secret and runs `npm run hub:deploy -- --persist`.
