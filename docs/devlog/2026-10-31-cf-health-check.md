# 2026-10-31 — The daily health check (hub cron + `npm run health`)

Owner ask: "a small daily health check that compares the Cloudflare pool copy against Supabase, confirms the hub is
up, and confirms the end-of-game writes are arriving." Rule R-OPS-HEALTH-01. Runbook: `docs/ops/health-check.md`.

- **Where it runs.** A Cron Trigger on the stable `ascent-hub` Worker (06:17 UTC), not pg_cron + an Edge Function: the
  hub is always deployed, already holds a Supabase writer key, and holds the pool mirror and the Live Games directory
  in-process. `npm run health` runs the same checks from a dev machine (Supabase through the CLI login, no key).
- **What it checks.** Hub `/health`; the current versioned Versus Worker `/health` (named by a new `release.json` the
  release now writes next to `index.html`, with fallbacks); pool mirror vs Supabase as one sha256 over each run's id,
  key, rev and boards-text hash (whole pool + one seeded draw), byte-exact with `pool_runs_boards` (PGlite-pinned);
  end-of-game rows in the last 24 h against the number of games the Live Games directory listed; session flush
  rejections; writer key validity.
- **Capabilities.** `/health` now answers `caps`. Pool parity needs `pool_mirror` and the session check needs
  `session`; both are `n/a` until feat/ranked-solo-cf ships them (the runbook lists the three small steps).
- **New hub state.** The directory keeps an hourly tally of new listings by kind (counts only, 48 h; `GET /ops/activity`).
- **Record.** `ops.health_checks` + `ops.health_status` (the lead's one-row query: overdue / failing) via key-gated
  `ops_health_record`. Migration `2026-11-21-ops-health-checks.sql`. The hub needs a redeploy (`npm run hub:deploy -- --persist`).
