# 2026-10-30 — Live games are Cloudflare only (no Supabase fallback)

Owner: "Remove fallback for spectating. I want us to make cloudflare work as our source for live information and action
like spectating". Rule: R-LIVE-CF-ONLY-01 (amends R-LIVE-CF-01). Branch `chore/cf-only-live-spectate`.

## What changed in the client

- **Publishing** (`live/livePublisher.ts`): a lobby / Practice game opens its socket to this build's Worker and nothing
  else. The Supabase heartbeat, the `lobbylive:<game>` broadcast channel, the `lobby_live_frames` keyframe write, the
  watcher-identity read and `lobby_live_end` are gone. A Worker that does not answer within 6 s is retried in the
  background (`liveRetryDelay`: 5, 10, 20, 40 s, then every 60 s) for as long as the game lasts, with one console line.
  Until then the game is not watchable; the game itself never notices. The Hero Select `bad_phase` latch (a Supabase
  server without the hero migration) went with it.
- **Watching** (`live/liveWatch.ts`): only the Cloudflare watch remains. The Supabase join, the 5 s watch poll, the
  fellow-watchers read, the client `spectate_beat` for lobby watches and `lobby_live_unwatch` are gone. A friend's Watch
  (no row in hand) used to try the Supabase join first and be sent on by `other_host`; it now reads the listing row for
  its `live_host`, and with no row yet tries this build's own Worker. A lobby row with no `live_host` (an older build on
  the retired path) says "That game is on an older version. It cannot be watched."
- **`live/liveRemote.ts`** keeps reads only: the listing page, the glow count, one row, and the seat recordings (boards).
- Tests moved onto one shared in-memory object (`live/liveFakeObject.ts`); the Supabase-path cases were ported to it or
  dropped where they only pinned the Supabase path (the old-server "plain Spectator", `p_status` refusal, the hero-phase
  refusal, the before/after cost measurement).

Nothing on the Worker changed, so nothing to deploy beyond the next pack.

## The server half

`supabase/migrations/2026-11-17-retire-supabase-live.sql` (run about 24 hours after the first pack with this change is
live; check query at the top). It refuses the Supabase writes with `live_moved`, makes the Supabase watch answer
`other_host` for any listed game (so an old tab's friend Watch still reaches the Worker), and clears the transient rows
(Supabase-hosted lobby rows, every keyframe and watcher row). No table is dropped. Pinned by
`packages/sim/src/lobby/lobbyLiveRetire.db.test.ts`.

**An old tab after the migration:** its game is not listed (its heartbeat error is swallowed, the game plays on); its
Live Games Watch already went to the Worker; its friend Watch follows `other_host` to the Worker; nothing else changes.

## What still reads Supabase (follow-up)

The Live Games list, its glow count and a friend's Watch row lookup still read `lobby_live_games`, which only the Worker
writes. Moving the list itself needs a version-independent directory on the `ascent-hub` Worker (the Versus Worker is
per content revision, its directory sees only its own revision), plus the sort, team names and friends-only visibility
SQL does today. `friends_beat` and the invite Realtime wake-up are the other live paths left on Supabase. The audit table
and the proposal are in `docs/versus-cf-cutover.md`, "What still reads Supabase for live information".
