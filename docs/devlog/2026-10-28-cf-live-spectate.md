# 2026-10-28 · Lobby and Practice spectating on Cloudflare; spectator XP for every Cloudflare watch

Owner 2026-10-29: "build the cloudflare spectating for lobby and practice too so it's all uniform". Versus already
relays its spectators over the room's Durable Object; solo lobby and Practice games still went through Supabase (a 15 s
heartbeat RPC, a Realtime broadcast channel, `lobby_live_frames` keyframe rows, watcher RPCs polled every 5 s, and the
watcher's own `spectate_beat` every 10 s).

**The live game object (R-LIVE-CF-01).** `VersusLiveGame` (`workers/versus/src/liveGame.ts`; rules in
`core/liveCore.ts`, wire in `liveProtocol.ts`) is one Durable Object per live game on the same Worker (binding `LIVE`,
DO migration `v2`), at `GET /live/<game>/ws`. Same auth (Supabase JWT, ES256 JWKS), same ping auto-response, same rate
limit (now shared in `rate.ts`), same client (`VersusCfClient` gained `path` / `hello` / `onHello`, and a refused live
hello now fails the connect instead of hanging; a room's behaviour is unchanged). The first publisher owns the game; up
to 20 watchers; the keyframe is cached in memory only; the stands are PUSHED to the player, so it still publishes only
while watched, now without any polling. The object writes the Live Games row through the key-gated `lobby_live_cf`
(the room's `LiveSlot`, made generic) with `live_host = cf:<content revision>`; no frame ever reaches Postgres.

**The switch.** `versus_host_config` gained `lobby_live` (default `supabase`). The host is chosen once per game at its
start (the switch as last read, never a network wait), kept for life, and the player falls back to Supabase if the Worker
does not answer within 6 s (the heartbeat takes the row back: it now clears `live_host`). A watcher follows the row:
Live Games passes the row; a friend's Watch tries Supabase, which answers `other_host` for a Cloudflare game, then reads
the row. An older client trying to watch a Cloudflare game gets refused instead of waiting on a silent channel.

**Spectator XP everywhere on Cloudflare (R-LIVE-CF-XP-01).** The runbook's open gap ("watching a Cloudflare match earns
no spectator XP": `spectate_beat` checks `versus_members`, which a Cloudflare room does not keep) is closed: the object
the spectator is connected to is the witness. Both the Versus room (any mode; `core/roomWatch.ts`) and the live game
object beat their stands through the key-gated `spectate_cf_beat`, which applies `spectate_beat`'s exact accrual rule
per beat, so `settle_progression` is untouched. One call per object every 30 s for all its watchers, plus one soon after
an arrival / departure and one at the end; a room stops 45 s after its match completed. A live game pushes `end` only
after its last beat was written (bounded 4 s), so the settlement never races the record. The client marks a Cloudflare
watch `server` (`markServerRecordedWatch`) and sends no beat for it.

**Measured** (`packages/ui/src/live/liveCf.test.ts`, a 10-minute game with one watcher): before, 53 player RPCs + 1
keyframe write + 11 Realtime broadcasts from the player and ~220 RPCs from the watcher; after, zero from either client,
and ~21 row writes + ~22 watch-record calls from the object (the record calls cover every watcher at once).

Tests: `workers/versus/test/liveCore.test.ts` (rules, beat cadence vs the 45 s window, room stands, rate limit),
`workers/versus/test/cfLiveSpectate.db.test.ts` (PGlite: `lobby_live_cf`, `other_host`, heartbeat takeback,
`spectate_cf_beat` accrual and presence), `workers/versus/test/it/live.it.ts` (workerd: publish / watch / cap /
reconnect / end-after-beat / leave beat / rate limit / a room beating its stands), `packages/ui/src/live/liveCf.test.ts`
(publisher, fallback, watcher, parity of the reconstructed view for an early and a late watcher, the measurement).

Migration (write only): `supabase/migrations/2026-11-10-lobby-live-cf.sql`. Cutover steps: `docs/versus-cf-cutover.md`.
