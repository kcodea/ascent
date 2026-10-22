# 2026-10-22 — Phone crash reports reach Supabase; `npm run phone:preview` for LAN testing

Owner 2026-10-22: *"I still can't even play it because of the crashing, but I want to make this mobile experience
flawless end to end."* He has an iPhone (15/16/17 Pro class) and no Mac, so no Safari Web Inspector. Oracle rule
**R-TOUCH-CRASH-REPORT-01** (foundation).

## 1. Crash reports upload by themselves

`packages/ui/src/crashLog.ts` already recorded breadcrumbs on a phone (or `?crashlog=1`) and found an unclean previous
session on the next load. New `packages/ui/src/crashReport.ts` sends each such crashed session to the new
`client_crash_reports` table:

- Only while the crash log records this load (`crashLogActive()`, new): desktop without the flag sends nothing.
- Scheduled from `Game.tsx` on mount: 6 s later, then `requestIdleCallback` (10 s timeout). The crashes are snapshotted
  at mount, so tapping the readout's Close (which forgets them) cannot cancel the report.
- Once per session (key `id@startTime`): marked sent in `localStorage['ascent.crashlog.reported.v1']` only after the
  insert succeeds; at most 3 tries per session across loads, each try counted BEFORE its request; one request per
  session per load, 10 s timeout, no retry loop. No client (no backend), offline, missing table: resolves quietly.
- Row: `last_step`, `ua`, `standalone`, `build` (`version+sha[-dirty]`), `session_key`, and `payload` (the whole crumb
  trail, the heartbeat, duration, last step, crashes on record, screen w/h + viewport + DPR, lite flag, phone
  diagnostics switches, build date). Trimmed from the middle to stay under 48 KB of JSON.
- No new per-frame or boot work; crashLog.ts only gained a one-line getter.

**Migration (NOT applied, the lead applies it):** `supabase/migrations/2026-10-22-client-crash-reports.sql` (also
appended to `schema.sql`). Insert-only for `anon` + `authenticated` (column grants + one insert policy; no select,
update or delete), `user_id default auth.uid()` and may only be the caller, `pg_column_size(payload) < 65536`, short
text caps. `packages/ui/src/crashReports.db.test.ts` runs it on PGlite (twice, idempotent) and checks the policy.
Until it is applied the inserts fail quietly and each crash keeps up to 3 tries for later loads.

Note: there is no server-side rate limit (an anon insert-only table can be spammed); the size caps bound each row. If
that ever matters, move the insert behind an Edge Function like `bug_reports`.

### Reading the reports

```
npx --yes supabase@2.120.0 db query --linked --project-ref zcwhbejpqcdcfdpfxeza "select id, created_at, last_step, standalone, build, (payload->'session'->>'durationMs')::int / 1000 as secs, payload->'device'->'screen' as screen, left(ua, 70) as ua from public.client_crash_reports order by created_at desc limit 20"
```

The full trail of one report (`describeCrumb` keys: `a` audio MB, `i`/`im` images count/MB, `ga`/`gmb` live WebGL
contexts/MB, `an`/`wc`/`fl` animations/will-change/filters, `pd` diag switches):

```
npx --yes supabase@2.120.0 db query --linked --project-ref zcwhbejpqcdcfdpfxeza "select jsonb_pretty(payload) from public.client_crash_reports where id = <id>"
```

## 2. `npm run phone:preview` — a branch build on the phone over home Wi-Fi

`scripts/phone-preview.mjs`: `npm run build:web`, then `vite preview --host 0.0.0.0 --port 4174 --strictPort`, and
prints `http://<LAN IP>:4174/` for each LAN address (private ranges first). `--port N` and `--no-build` are optional.
4174 because 5173 is the dev server's and 4173 is the `web-prod` launch config; neither is touched. Windows may ask
once to allow Node on Private networks.

The build talks to the **live** Supabase project (the tracked `apps/web/.env` holds the URL + publishable key), so
crash reports from a LAN build land in the same table, tagged with its build id (`-dirty` when built from a tree with
local changes).

### Secure context (plain http on a LAN IP is NOT a secure context in iOS Safari)

Checked in the source; nothing installed:

| Thing | On http LAN | Notes |
|---|---|---|
| Play, WebGL/Pixi, Web Audio + the touch unlock, localStorage, fetch to Supabase (https from http is fine), CORS | works | |
| `crypto.randomUUID` (secure-context only) | **was a throw** in `boardLibrary.ts` at run end | fixed: guarded with a v4 fallback (every other call site was already guarded) |
| `crypto.getRandomValues` | works | not secure-context gated |
| Supabase auth, anonymous session | works | implicit flow (no `crypto.subtle`); `navigator.locks` is absent on http and auth-js falls back to its lockless mode |
| Magic-link sign-in | **does not come back** | `emailRedirectTo` is the page origin (`http://192.168.x.x:4174`); unless that is in the project's redirect allowlist Supabase sends the link to the Site URL instead. The LAN origin also has its own storage, so the phone plays there as a NEW guest account (a stray guest row in the live DB per origin). Fine for crash hunting; don't use it for account testing. |
| Clipboard (ErrorBoundary copy, dev tools) | silent no-op | all calls use `?.` / catch |
| Service worker, wake lock, `crypto.subtle`, `getUserMedia`, AudioWorklet | not used | |
| Add to Home Screen | works, separate storage | the readout auto-shows only in standalone; in a Safari tab add `?crashlog=1` once. Uploads happen either way on a phone. |

If https is ever needed: `@vitejs/plugin-basic-ssl` (self-signed; iOS shows a warning page every time and a Home Screen
app may refuse it, unless the cert is installed + trusted as a profile), `mkcert` with its root CA installed on the
phone (clean, one-time setup per phone), or a tunnel (`cloudflared tunnel --url`) giving a real https URL (no cert
work, but traffic leaves the house and the URL changes each run). The Netlify deploy preview remains the zero-setup
https option.

## Verification

`crashReport.test.ts` (which sessions upload, oldest first, once across loads; no-op without a client and no storage
touched; failures not marked and capped at 3; rejected/hung inserts never throw; trimming keeps the boot and last
crumb), `crashReportDesktop.test.ts` (owner 2026-10-22, "We don't want to break desktop for this": a desktop load without
the flag records nothing, schedules no timer, never calls the backend and writes no storage, even with an old unclean
log in storage; `?crashlog=1` opts in), `crashReports.db.test.ts` (the migration on PGlite). Full gate in the PR.
