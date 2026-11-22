# 2026-11-22 — Crash + error reports on the desktop exe and the web (not just phones)

Owner ask 2026-11-22, ahead of the Steam invite-only playtest on the desktop app: automatic crash and error reporting on
desktop and web. Before this, `crashReport.ts` sent only a phone's crashed sessions (or `?crashlog=1`), the
ErrorBoundary only logged to the console, nothing listened for `error` / `unhandledrejection`, and the Electron shell
had no `render-process-gone` handling, so a renderer crash left a white window. Oracle rule
**R-CRASH-REPORT-DESKTOP-01** (foundation). Branch `feat/desktop-crash-reports`.

## What is captured (all to `client_crash_reports`, one pipeline)

New `packages/ui/src/errorReport.ts`, installed first thing in `apps/web/src/main.tsx`:

| kind | from | where |
|---|---|---|
| `error` | window `error` (uncaught) | every client |
| `rejection` | `unhandledrejection` | every client |
| `render` | `ErrorBoundary.componentDidCatch` (with the component stack) | every client |
| `crash-session` | a load that ended without `pagehide` / going hidden, found on the next load by a tiny localStorage sentinel | desktop exe + desktop browser (phones keep `crashLog.ts`) |
| `renderer-gone` | Electron `render-process-gone` (crashed / oom / killed / launch-failed...) | desktop exe |
| `child-gone` | Electron `child-process-gone` (GPU, utility) | desktop exe |
| `renderer-hang` | the game window's `unresponsive` (once a launch) | desktop exe |
| `main-exception` / `main-rejection` | the main process's `uncaughtException` / `unhandledRejection` | desktop exe |

The phone path (`crashReport.ts`) is unchanged except its payload now also carries `kind: 'crash-session'`, `platform`
and `app` so the new generated columns fill in.

## Desktop shell hand-off

`apps/desktop/crashReports.cjs` (pure helpers + `installCrashRecording`, wired in `main.cjs`, skipped in smoke runs)
writes each event synchronously to `<userData>/crash-reports.json` (newest 10, fields capped, the Windows/Unix user
name scrubbed from paths). The next session's page calls `ascentDesktop.takeCrashReports()` (preload), which returns
the list and DELETES the file; the page re-validates and redacts every field (`desktopRecord`) and queues them with
its own reports. A renderer crash is told twice (the shell's `renderer-gone` with the reason, the page sentinel's
`crash-session` with the steps); `mergeDesktopCrashes` pairs them within 2 minutes into ONE report. After a renderer
crash the shell shows a native dialog, "The game stopped unexpectedly." (or "ran out of memory"), Reload / Quit;
Reload reloads the window (or opens a new one if it was destroyed); a failed dialog reloads anyway.

## Caps, dedupe, redaction, cost

- Dedupe: one report per signature per session (FNV-1a of kind + name + message with numbers folded + top 3 stack
  frames). A signature still waiting from an earlier load is not queued again.
- Caps: 5 errors per load (`MAX_PER_SESSION`; crashes handed over from an earlier launch skip this one), 20 reports per
  device per UTC day (`MAX_PER_DAY`, all kinds), 8 waiting at most, 3 loads of tries per report, one try per report per
  load. No sampling.
- Noise dropped: `ResizeObserver loop...`, cross-origin `Script error.` with no stack, `AbortError`.
- Redaction (`redact`): JWTs, `sb_publishable_` / `sb_secret_` / `sk-` keys, every URL's query + fragment (magic-link
  tokens), emails, `token=` / `password=` / `Bearer ...` values, the home folder's user name, any 40+ char opaque run.
  Messages 300 chars, stacks 15 lines / 3 KB, component stacks 1.5 KB, the step trail = the last 12 step NAMES
  (`crashLog.ts` now keeps that ring on every platform: an array push, never the step details, no DOM read, no
  storage write). A row stays under 16 KB.
- Cost: nothing per frame. Capture is a few string ops; the reporter writes localStorage only for an admitted report.
  Nothing is sent until `Game.tsx` hands over the transport on mount, then 6 s, then `requestIdleCallback`; offline it
  waits for `online`. The sentinel writes a few hundred bytes on idle after a step (at most every 5 s) and every 15 s
  while visible. Inserts go through the Supabase client, then the keepalive REST fallback (`anonRestInsert`).
- Never throws: every entry point is wrapped; a missing backend, a missing column, RLS refusing all resolve quietly
  and the report waits for a later load.

## Server (NOT applied: `supabase/migrations/2026-11-29-client-crash-reports-desktop.sql`)

- Generated columns `platform`, `kind`, `app_version` from the payload. Generated, so the client never sends them:
  a client that ships before the SQL runs keeps working, and old rows fill in (`device.lite` = phone, no kind =
  `crash-session`).
- A before-insert rate limit (security definer trigger): 100 rows a day per signed-in user, 300 an hour across rows
  with no user (the publishable-key fallback). Grants and RLS unchanged: insert only, own rows only, no client reads.
- `packages/ui/src/crashReportsDesktop.db.test.ts` runs it on PGlite (twice).

## Reading the reports

See `docs/ops/crash-reports.md` (queries by platform / kind / build). The analytics dashboard gets a crash panel
separately.

## Not done

- Native main-process crashes (a segfault in Electron itself) leave no JS to run; that needs Electron's `crashReporter`
  with a minidump endpoint. Out of scope for the playtest.
- The 40+ char opaque-run rule can redact a long identifier in a message that was not secret. Accepted: better too
  much than a leaked token.
