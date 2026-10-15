# Live games: spectating ranked lobby games (2026-10-15)

Owner-approved: live spectating for normal RANKED lobby games, reusing the Versus spectator stack. Opt-in by
default (a hide setting is a later seam), ranked only, no delay, list sorted by rank. Rules: GAME-RULES "Live games";
oracle R-LIVE-01..03.

## Shape

- **SQL** `supabase/migrations/2026-10-15-lobby-live.sql` (additive). `lobby_live_games` (the public listing,
  read policy = seen in the last 60 s), `lobby_live_watchers` (no read policy), `lobby_live_frames` (the latest
  keyframe per game, authenticated read). RPCs: `lobby_live_heartbeat` (rank and rating come from the caller's own
  `profiles` row, never the client; prunes stale games and watchers; one game per player; returns the watcher count),
  `lobby_live_end` (placement, or null = abandon = delete), `lobby_live_publish_frame` (owner only, newer seq only),
  `lobby_live_watch` (cap 20, never your own game) and `lobby_live_unwatch`. PGlite tests:
  `packages/sim/src/lobby/lobbyLive.db.test.ts`.
- **Player side** `packages/ui/src/live/livePublisher.ts`. One store subscription. `liveEligible` is the one gate.
  Heartbeat every 15 s plus on each round/phase change. Only when it reports watchers: the `lobbylive:<game>` broadcast
  channel opens, the spectator tap (actions + cursor) turns on and the Versus projection publishes through the idle
  deferred writer (250 ms coalescing), with the lobby fight result attached in combat. Keyframes are also persisted for
  joiners. End/abandon reported from the subscription.
- **Watcher side** `live/liveWatch.ts` + `live/LiveGames.tsx` + `live/LiveWatchBar.tsx`. The menu page (sidebar item
  "Live Games") lists rows ranked best first. Watch installs the spectate IO and drives `versus/spectate.ts` through
  `liveSync(gameId)`; the screen is the existing render-only replay mode. A 5 s poll keeps the watcher seat warm and
  follows the row; on `end` the placement panel shows for 6 s, then the list.
- **Shared spectate changes** (`versus/spectate.ts`): optional `returnTo` on the IO (Live returns to the list),
  `name` override for the watched name, the lobby `fight` riding on messages, `lastCombat` stripped outside combat,
  and the game's own end screen never drawn for a spectator (its buttons would act on the store; the watch chrome
  shows the placement instead).

## Found by the FX parity harness

- A run parked under the TITLE screen (a saved Continue loaded at boot) was listed as live: `liveEligible` now
  requires the player to be in the game (`!showTitle`), and the subscription re-checks when the title opens or
  closes (back to the menu delists with an abandon-style end; Continue lists again).
- The fight rode EVERY combat message as a fresh object, so a watcher's replay restarted on each delta: it now rides
  keyframes only, and the watcher keeps the object when the same fight is re-sent.
- Spectator FX/sound/animation parity (all modes): see `2026-10-15-spectator-fx-parity.md`.

## Known limits

- (Fixed) Join latency: the player's client joins its game's channel to LISTEN when the game is listed; a joining
  watcher's key request triggers an immediate heartbeat, so publishing starts in about a second (measured live:
  745 ms from Watch to the first frame), not on the next 15 s beat.
- The watched seat is labelled with the watched player's name on the rail (it was "You").
- Live E2E (2026-10-15, after the migration): a real ranked game on one anonymous identity watched from a second:
  list, shop, combat, the end placement and the return to the list all worked.
- Player perf 0 vs 1 spectator (prod build, busy late turn): p95 2.8 vs 2.8 ms, p99 5.5 vs 5.3 ms, about 0.6% of
  frames over 6.25 ms in both; no measurable cost.

## Deploy

Apply `supabase/migrations/2026-10-15-lobby-live.sql`. No Edge Function and no content revision change.
