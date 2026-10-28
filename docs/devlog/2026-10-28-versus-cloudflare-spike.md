# 2026-10-28 · Versus on Cloudflare: design + 1v1 spike

Owner decision: move live Versus off Supabase SQL functions + Postgres Changes onto Cloudflare Durable Objects (one
object per room, WebSockets with hibernation, the engine resolving inside the object), built in parallel and cut over
later by flag. Design: `docs/design/2026-10-28-versus-cloudflare.md`.

What landed (local only; no Cloudflare account yet, nothing deployed, nothing written to Supabase):

- `workers/versus/` (`@game/versus-cf`, new `workers/*` workspace): Worker, Room DO, Directory DO, the 1v1 rules as a
  pure state machine (`core/roomCore.ts`, a function-by-function port of the 1v1 SQL), JWT auth via JWKS/HS256, a
  persistence outbox to the same Supabase tables (OFF), the protocol and a shared client.
- The round resolves in the object through `handleVersusFinalize` itself (the Edge Function's handler) over an
  in-memory store: one implementation of resolve + damage + pools. `@game/sim/versus/server` gained export-only lines
  (`reportedVitals`, `versusArmorFloorMax`, `versusStartingVitals`, timing constants); versus-resolve's behaviour is
  unchanged.
- `packages/ui/src/versus/versusCfRemote.ts`: the same `VersusRemote` surface over the room socket, selected only in a
  dev tab with `?versusHost=cf`. Supabase stays the default and its code path is unchanged.
- Tests: 21 fake-clock rule tests incl. parity with `simulate()` (root `npm test`), 6 workerd integration tests
  (`npm run versus:cf:test`, Node 22+).

Local numbers (`npm run versus:cf:measure`): last End Turn → fight on both clients median 5.7 ms (Supabase: 1.7-2.7 s
resolve); 0:00 → fight ~290 ms incl. the 250 ms grace (Supabase Duos median 4.8 s); disconnect known in ~3 ms, paused
at 3.0 s by design; blip reconnect 120 ms with no pause; reconnect → full state 7-18 ms.

Two traps found and fixed while building, worth remembering for phases 2-4:

- **Alarm spin.** A "next alarm" that included already-passed times (a disconnect grace that had run out) re-armed
  "now" forever: thousands of wakes a second, which starved the local runtime until connects hung. `nextAlarm(now)`
  only returns future times; a test pins it.
- **Closing handshake.** The hibernation `webSocketClose` handler must close the socket back at once. Without it the
  client waited ~5 s for the close frame and the half-closed socket still read as OPEN, so a later real disconnect was
  hidden behind it ("another socket is still open") and the match never paused.

Rebased on #2360/#2362/#2363 the same day: the room now starts the 3-2-1 itself when the paused player's socket comes
back (R-VERSUS-AUTO-RESUME-01), ends a round it cannot resolve as `void` (R-VERSUS-RESOLVE-TIMEOUT-01) and logs the
`versus_events` kinds; the close-once, lease, sweep and Realtime-heal machinery has no counterpart (design section 13).
