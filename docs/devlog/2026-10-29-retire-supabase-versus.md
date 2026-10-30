# 2026-10-29 — Versus is Cloudflare only: the Supabase host is retired

Owner: "why are we using supabase for versus instead of cloudflare? stop doing that". Standing rule: never switch a
mode back to Supabase; fix forward on Cloudflare. Rule `R-VERSUS-CF-ONLY-01` (supersedes `R-VERSUS-CF-CUTOVER-01`).

## What changed

- **Client.** `versusRemote` is now the Cloudflare transport (`makeCfVersusRemote`) and nothing else. Gone: the cutover
  router (`versusRouter.ts`: the per-mode routing, the merged room lists and the "Cloudflare create timed out, make the
  room on Supabase" fallback), the `versus_host_config` read and its dev overrides (`?versusRoute=`), the room-host
  memory, the whole Supabase room / match adapter (`makeVersusRemote`: every `versus_*` room RPC, the table reads, the
  Realtime channel, the `versus-resolve` finalize calls) and the Supabase Ranked Duos Live Games heartbeat
  (`duosLive.ts`; the room writes its own row). `VersusRemote` is now an explicit interface. What stays on Supabase is
  `makeVersusRecords`: team names, a settled Ranked Duos result, the leaderboard, a player's teams and the dev-bot flag.
- A Worker that cannot be reached is a plain error with Try again ("Connection problem. Try again."; Duo + Play keeps its
  own deadline). Room refs are always `cf:<id>`; a bare id (an older client's Supabase room) says "That room has closed."
- A build trusts its baked Worker URL only when it is its own engine's; otherwise it uses the Worker named after its
  engine. Dev builds use `npm run versus:cf:dev` (or `?versusHost=cf-live` / `?versusCfUrl=`).
- Live lobby / Practice games publish to the Worker without reading the switch. Their per-game Supabase listing fallback
  (Worker not answering within 6 s) is kept: it is a listing for spectators, not a Versus host. Flagged to the owner.
- The dev test bots now play on the Worker as their own anonymous accounts (each its own `makeCfVersusRemote`). Their
  Duos dev tuner RPCs (`devSetVitals`, `devSkipShop`) were never on the Worker and still answer `cf_unsupported`.
- **Release.** `npm run release:web` always deploys the Worker (and the friends hub) first; `--versus-cf` is a no-op.
  The "redeploy versus-resolve" step is gone from the script, CLAUDE.md "Releasing" and the runbook.
- **Server** (`supabase/migrations/2026-11-14-retire-supabase-versus.sql`, for the owner to apply after the wait in the
  runbook): the switch is pinned to `cf` with a check constraint (kept, because an older client reads a failed read as
  "all Supabase"); `versus_create_room` refuses with `versus_moved`; `versus_sweep()` runs one last time and the
  `versus-sweep` cron job is unscheduled (it only ever swept Supabase-hosted matches and pruned `versus_events`, which
  only the Supabase host wrote; it touched no Cloudflare-written row); a last `versus_events` prune. No data table is
  dropped.
- **Tests.** The Supabase chaos matrix (`versusChaos.db.test.ts`, `chaosServer.ts`, `fakeSupabase.ts`, `chaosKnown.ts`),
  the router / cutover / Realtime tests went with the code. `versusCfParity.db.test.ts` now plays each mode on the
  Cloudflare room only and pins the screen shapes the two hosts agreed on, plus the result writer on PGlite
  (`writerDb.ts`). New `versusCfOnly.test.ts` pins the contract (no Supabase call on a failed create, `cf:` refs, no
  banned RPC name anywhere in the client, no versus-resolve in the release script). The Supabase SQL `.db` tests in
  `packages/sim` stay: they cover SQL that is still on the server and partly shared by the Worker's writer.

## Follow-ups

- After the owner deletes the Edge Function: remove `supabase/functions/versus-resolve/`, `versus:bundle` and the parity
  tool's `bundle` / `remote` modes (roadmap).
- Desktop packs (`release-desktop.mjs`) deploy no Worker; old desktop builds were Supabase-only for Versus.
