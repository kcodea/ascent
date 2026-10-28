# 2026-10-28 — Versus cutover plumbing (Supabase → Cloudflare, per mode)

Branch `feat/versus-cf-cutover` (stacked on #2369). Rule `R-VERSUS-CF-CUTOVER-01`. Runbook: `docs/versus-cf-cutover.md`.
Nothing deployed, nothing flipped: every mode stays on Supabase until the owner runs the SQL in the runbook.

## What landed

- **The switch** `versus_host_config` (row per mode, `supabase` | `cf`) + `versus_host_config()` read, in
  `supabase/migrations/2026-11-05-versus-host-config.sql`. It decides where NEW rooms go, nothing else. Same file:
  `friends_invite` accepts a `cf:<uuid>` room target.
- **The router** (`packages/ui/src/versus/versusRouter.ts`) is now the game's `versusRemote`: every adapter method is
  classified in `VERSUS_ROUTES` (a `Record<keyof VersusRemote, ...>`, so a new method fails the typecheck until routed).
  Room calls go to the room's remembered host (localStorage `ascent.versusRoomHosts`, Cloudflare rooms only), match
  calls to their room's host, lists / open counts / `myRoomId` to both (merged; one side down still answers), records
  to Supabase. A Cloudflare create that fails on the network falls back to Supabase.
- **Room references** that leave the client carry the host: `cf:<id>` (invites, the Friends Watch id, a Live Games
  `duos:` row). Bare ids stay Supabase, so every existing row reads the same.
- **The pack**: `release:web -- --versus-cf` deploys the matching versioned Worker first, checks `/health`, sets a new
  Worker's writer secret, and bakes `VITE_VERSUS_CF_URL`. The client trusts that URL only if it is exactly the Worker
  for its own content revision. No flag = Supabase-only build, and the switch is never read (no egress added).
- **Origins**: default `https://ascent-game-web.netlify.app` + localhost ports (the `*.netlify.app` wildcard is gone);
  `VERSUS_ALLOWED_ORIGINS` at deploy time replaces it (validated).

## Judgement calls

- **Cloudflare rooms are listed from the Worker** (`GET /rooms`, its directory object), not from a Supabase registry
  table: zero Supabase egress, no new Cloudflare → Postgres write path.
- **Mode changes inside a room**: a room is created as a duel and its host can switch modes later. A Cloudflare room
  switching to a mode the switch still keeps on Supabase is remade on Supabase when the host is alone; with others
  present it is refused ("This mode needs a new room. Make one from the Versus menu."). Supabase rooms never move.
- `?versusHost=cf` keeps its meaning (all modes on Cloudflare); `?versusRoute=duel:cf` is the new per-mode dev override.
- Records (Duos results, teams, leaderboard) are always read from Supabase, where both hosts write them.

## Open

- Live Games for a Cloudflare Ranked Duos match needs the Ranked Duos port to publish `duos:cf:<room>`.
- No percentage rollout (all or nothing per mode).
