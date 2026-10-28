# Versus cutover: Supabase → Cloudflare, one mode at a time

Owner decision 2026-10-28 (design: [`design/2026-10-28-versus-cloudflare.md`](design/2026-10-28-versus-cloudflare.md)).
This is the runbook for moving a Versus mode onto the Cloudflare Worker and back, with no downtime. Rule:
`R-VERSUS-CF-CUTOVER-01`.

## How it works

| Piece | Where | What it does |
|---|---|---|
| **The switch** | `public.versus_host_config` (one row per mode: `duel`, `group`, `duos`, `ranked_duos`; host `supabase` or `cf`) — `supabase/migrations/2026-11-05-versus-host-config.sql` | Decides where **new** rooms of that mode are created. Nothing else. Every mode starts on `supabase`. |
| **The client's read** | `versus_host_config()` RPC, read once at launch and at most every 30 s while creating rooms (`packages/ui/src/versus/versusHost.ts`) | Tiny jsonb. Only builds that carry a Worker URL read it at all. A failed read = everything on Supabase. |
| **The router** | `packages/ui/src/versus/versusRouter.ts` (the game's `versusRemote`) | Sends each call to the room's host. A room keeps the host it was created on **for life**; the client remembers it across a reload. |
| **The Worker URL** | `VITE_VERSUS_CF_URL`, baked in by `npm run release:web -- --versus-cf` | A build with no URL (or a URL for a different content revision) is Supabase-only whatever the switch says. |
| **Room lists** | Both backends, merged in the client | Supabase rooms from `versus_list_rooms` as today; Cloudflare rooms from the Worker's own `GET /rooms` (its directory object). |
| **Invites / Watch / Live Games** | Room reference `cf:<room id>` for a Cloudflare room, the bare id for a Supabase room | `friends_invite` accepts `cf:<uuid>` with the room's signed proof (checked at send, R-VERSUS-CF-INVITE-01); the Friends "Watch" id and a Live Games `duos:` row carry the same prefix. A Cloudflare Ranked Duos room writes its own Live Games row (`duos:cf:<room>`, R-VERSUS-CF-LIVE-01). |
| **Origin allowlist** | `ALLOWED_ORIGINS` in `workers/versus/wrangler.toml` | `https://ascent-game-web.netlify.app` + localhost dev ports. Deploy-time override: `VERSUS_ALLOWED_ORIGINS`. |

**Why the Worker lists its own rooms (not a registry table in Supabase):** the Worker already keeps every live room in
its directory object (`workers/versus/src/directory.ts`, `GET /rooms`). Reading it costs zero Supabase egress and needs
no new write path from Cloudflare into Postgres (the only Cloudflare → Supabase write stays the limited result writer,
`versus_cf_persist`). A registry table would add a write per room state change plus a second Realtime/poll read for
every room list, which is exactly the egress we are trying to shed.

**What a room does during a flip:**
- Flip a mode to `cf`: rooms of that mode created from then on (within 30 s) go to Cloudflare. Supabase rooms already
  open or playing finish on Supabase.
- Flip it back (rollback): new rooms go to Supabase at once (within 30 s). Cloudflare rooms finish on Cloudflare.
- A Cloudflare room whose host switches it to a mode still on Supabase is remade on Supabase when the host is alone in
  it; with others in the room the change is refused ("This mode needs a new room. Make one from the Versus menu.").
- A Cloudflare create that fails on the network falls back to a Supabase room, so a Worker outage never blocks play.

## One-time setup (before the first flip)

1. Apply `supabase/migrations/2026-11-04-versus-cf-writer.sql` (the result writer; PR #2369).
2. Apply `supabase/migrations/2026-11-05-versus-host-config.sql` (the switch + `cf:` invites). Safe on its own: every
   mode starts on `supabase`, and builds without a Worker never read it.
   Then apply `supabase/migrations/2026-11-08-versus-cf-live-games-invites.sql` (Live Games rows from Cloudflare Ranked
   Duos rooms, and the signed invite check). Safe on its own: a Supabase invite is checked as before, and a call without
   the new `p_proof` argument still resolves.
3. Ship a pack that carries the Worker:
   ```
   npm run release:web -- --versus-cf
   ```
   (needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in the environment). It deploys the Worker for that exact
   commit **first** (`npm run versus:cf:deploy -- --persist`, named `ascent-versus-v<protocol>-<content>`), checks
   its `/health` answers that engine, gives a NEW Worker its result-writer secret (`writer-secret.mjs`; it prints one
   `insert into public.versus_cf_writer_keys ...` line: run it on Supabase before flipping, or that Worker's matches
   leave no records), then builds the zip with the Worker URL baked in. Upload the zip as usual and do
   the usual versus-resolve redeploy (CLAUDE.md "Releasing"): Supabase rooms still need it.
   Without `--versus-cf` the zip is Supabase-only (today's behaviour).

## Flip a mode (no build, no deploy)

```sql
-- Move 1v1 to Cloudflare:
update public.versus_host_config set host = 'cf', updated_at = now(), note = 'cutover 1v1' where mode = 'duel';

-- Check:
select public.versus_host_config();
```

Run it with the Supabase CLI against project `zcwhbejpqcdcfdpfxeza`. Only flip a mode whose Cloudflare port has
shipped in the live pack (today: `duel` only; Group, Duos and Ranked Duos are still being ported). The live clients
pick it up within 30 s.

## Roll back (instant)

```sql
update public.versus_host_config set host = 'supabase', updated_at = now(), note = 'rollback' where mode = 'duel';
```

New rooms go to Supabase within 30 s; Cloudflare rooms already playing finish there and their records land in the
same tables (`versus_matches` / `versus_rounds`), so XP and records stay continuous. Everything back at once:

```sql
update public.versus_host_config set host = 'supabase', updated_at = now(), note = 'rollback all';
```

## Dev and test

- `?versusRoute=duel:cf,group:supabase` (or `*:cf`; `off` clears it) in a dev build or with the Versus test tools on:
  a per-mode override for this tab. `?versusHost=cf` / `cf-live` still sends every mode to Cloudflare, and
  `?versusCfUrl=` picks the Worker.
- `npm test` covers the routing (`packages/ui/src/versus/versusRouter.test.ts`) and the origin list
  (`workers/versus/test/origins.test.ts`).

## Origin allowlist

Default (`workers/versus/wrangler.toml`): `https://ascent-game-web.netlify.app,http://localhost:*,http://127.0.0.1:*`.
To add a custom domain without a code change, deploy with the list in the environment:

```
VERSUS_ALLOWED_ORIGINS="https://ascent-game-web.netlify.app,https://play.example.com,http://localhost:*,http://127.0.0.1:*" npm run release:web -- --versus-cf
```

`deploy.ts` validates each entry (https origins, or http on localhost / 127.0.0.1) and echoes the list.

## Live Games and invites (2026-11-08)

- **Live Games**: a Cloudflare Ranked Duos room writes its team's row itself (`duos:cf:<room>`) through the key-gated
  `versus_cf_live`, only when the listing changes (start, round, phase, end) plus a 2-minute keep-alive; the row stays
  listed 4 minutes past its last write and is removed at the end. The client publishes nothing for a Cloudflare room.
  1v1, Group and Versus Duos are not on Live Games on either backend (Friends "Watch" covers them, with `cf:<room>`).
- **Invites**: the client asks its room for a proof (`invite_proof` on the room socket); the room runs the Supabase
  checks (open, I am in it, they are not) and signs `<exp>.<hmac>` with the sha256 of its writer secret (the value
  `versus_cf_writer_keys` holds, so nothing new to provision); `friends_invite` refuses a `cf:` invite without a valid
  proof (`room_check`). A Worker with no writer secret answers `invites_unavailable`.

## Still open (not in this plumbing)

- **Spectator XP for a Cloudflare match**: `spectate_beat` checks `versus_members` / the match rows, which a Cloudflare
  room does not keep live, so watching a Cloudflare match earns no spectator XP yet.
- **A rollout percentage** (`cf:<percent>` in the design doc) is not built; the switch is all or nothing per mode.
