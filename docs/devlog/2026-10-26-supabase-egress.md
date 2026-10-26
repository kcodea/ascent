# 2026-10-26 — Supabase egress: measured, then cut (perf/supabase-egress-audit)

**Why.** The project went over the Free plan's 5 GB/month egress with ~4 casual players (owner moved to Pro for now),
and the Postgres log showed an error spike (~3,662 in one hour) with `permission denied for table profiles` (42501)
every few seconds and bursts of `deadlock detected` (40P01) on one `versus_group_matches` row.

**How it was measured.** A DEV / measurement-build meter (`packages/ui/src/net/egressMeter.ts`, `window.__egress`,
built only with `VITE_EGRESS_METER=1`) plus a headless probe (`scripts/egress-probe.mjs`) that drives scripted sessions
against the live backend and counts WIRE bytes per account and per endpoint (gzip, headers and Realtime frames
included). Live identities Claudebot5 (host), Claudebot6-8 (in-tab bots), Claudebot9 (guest / spectator).

## Before / after (this client's wire bytes)

| Activity | Before | After | |
|---|---|---|---|
| App launch, warm cache | 437 KB | 185 KB | board-results window + Recent Games feed now incremental (first boot after the change reads them whole once, 450 KB) |
| Versus 1v1, 150 s of match (human) | 355 KB | 217 KB | -39% |
| Spectating a 1v1, 90 s | 183 KB | 105 KB | -43% |
| Duos with 3 bots, 120 s (human / whole tab) | 425 / 1,594 KB | 298 / 965 KB | -30% / -39% (before the pass-backstop throttle) |
| A tab left on a paused match | 165 KB/min (2 reconciles/s, forever) | 62 KB/min now; ~26 KB/min once `2026-10-27-versus-egress.sql` is applied | the `seen` field replaces the paused-room re-read |
| Room browser / room idle | ~25 / ~38 KB/min | ~16 / ~24 KB/min | |

## What changed

- **Loops back off and stop (R-NET-BACKOFF-01).** `net/backoff.ts` keyed gates: a new situation (match revision, round,
  gate deadline) is asked at the old 500 ms pace for the first tries (deadlines still land on the same tick), then the
  wait doubles to 15 s (finalize 30 s); hidden tabs have a floor. Spectators never reconcile or finalize (they took the
  match row lock for nothing). The heartbeat stops the session on `not_a_member` / `no_room`. The test-bot driver backs
  off after failures, answers `done` when its membership is gone (an orphaned bot used to heartbeat `not_a_member` every
  4 s forever), and its Duos pass poll is event-driven (5 s fallback). Room list: 5 s visible, 30 s hidden. Live Games:
  nothing while hidden, 20/40/60 s after failures. Live watch: backoff, and a missing `lobby_live_watch_as` is
  remembered. Spectate beat: 30 s while hidden (inside the 45 s window, so spectator XP is unchanged).
- **No member heartbeats over Realtime (R-NET-REALTIME-01).** The client no longer subscribes to `versus_members`; the
  room revision is the wake-up. `2026-10-27-versus-egress.sql`: a member back after a lapsed lease bumps the room (the
  "is back" notice stays instant), and the heartbeat answers `seen` while the match is paused. Until it is applied the
  client re-reads the room once per beat while paused (measured live: "is back" within one beat).
- **Rounds only once committed (R-NET-ROUNDS-01).** `committedRound`: no rounds reads during the shop.
- **Launch caches (R-NET-CACHE-01).** IndexedDB (`net/idbKv.ts`) for the board-results window and the Recent Games
  feed; only newer rows are read, the whole window again once a day.
- **Room-list prune off the read path.** At most once per 30 s across all callers, SKIP LOCKED, and it bumps the rooms it
  pruned.
- **Errors.** `2026-10-26-profiles-avatar-grant.sql` grants `profiles.avatar` (every avatar read was a 42501 and other
  players' portraits never showed; guarded by `profilesGrant.test.ts`). `2026-10-26-versus-lock-order.sql` puts every
  Versus RPC on one lock order (match, room, members), proved statically by `versusLockOrder.test.ts`
  (R-VERSUS-LOCK-ORDER-01); PGlite runs one connection, so a true parallel test needs a real Postgres.

## Live behaviour checks (headless, two real accounts)

Guest closed its browser mid-shop: the host showed "disconnected" ~14 s later (12 s lease + one beat, as before), the
30-second reconnect countdown ran 30 -> 1, then "has not come back"; the guest reopened, the host showed "is back"
on the guest's first beat, the guest pressed Unpause, 3-2-1, play resumed. 1v1 and Duos matches with bots played
through fights normally; a spectator watched a whole 1v1 stretch with frames and fights.

## Not changed (follow-ups, each needs an owner call)

- `pool_runs_sample` (~150 KB per boot and per run end): caching or trimming it changes which opponents are served.
- Match-row change events (~3.2 KB each, ~7 per minute): Realtime cannot filter columns; a `realtime.send` broadcast
  wake-up would replace them.
- The 1v1 match GET after each match event could use the event's own row (timestamp-format check needed first).
- Merging the heartbeat and its reconcile into one call (lock-order care needed: reconcile reads the caller's own beat).
