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

## Known limits

- Join latency up to one heartbeat (15 s) before the player starts publishing; the persisted keyframe covers the
  screen meanwhile if one exists.
- Perf 0 vs 1 spectator on the prod build waits on the migration being applied.

## Deploy

Apply `supabase/migrations/2026-10-15-lobby-live.sql`. No Edge Function and no content revision change.
