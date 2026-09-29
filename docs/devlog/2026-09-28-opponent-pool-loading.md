# 2026-09-28 · The opponent pool loads reliably, and a lobby waits for it

Owner ask (2026-09-28): "build the fix so this does not re-occur." Rule: R-LOBBY-06.

## The bug

A rated lobby (player Rooks, lobby seed 309102059, 2026-09-29 02:06 UTC) sat seven generated `bot:hybrid:*`
seats (lobby strength 25%) while the live Set 2 pool held 34 to 120 real boards per wave. Headless: with no
pool registered `createLobbyRun` for that seed yields exactly those seven hybrids; with the pool it seats seven
real runs. 1 of 24 rated lobbies since 2026-09-23. Not caused by #1812.

Root cause, in the client's startup pull (`fetchAndRegisterPool`):

1. 17 per-wave requests raced AS A WHOLE against one 4 s timer, so any slow wave discarded the entire pool
   (about 2.6 MB; each request is normally 0.25 to 0.37 s).
2. No retry: the next attempt was the between-runs refresh when a run ended.
3. Nothing awaited the pool before `createLobbyRun`, so an empty pool silently seated every seat with hybrids.

## What shipped

- **`packages/ui/src/opponentPool/poolLoader.ts`**: per-request timeout (6 s at startup) with a per-wave retry
  (AbortController cancels the timed-out request). Each wave registers the moment it lands, so partial results
  are kept. Missing waves retry in the background (5 s, 15 s, 45 s, 2 min, 5 min) and at once on the browser's
  `online` event. Pure orchestration over injected deps, so the tests need no network or real clock.
- **Cache** (`poolCache.ts`): the last good pool for the LIVE set only, one IndexedDB record per set, capped at
  120 boards per wave, stamped with the build-version prefix and a time. Used only for waves the network could
  not supply, only for the same version, and only up to a week old. Written at most every 30 minutes.
- **The gate** (`poolGate.ts` + `PoolWaitPanel.tsx`, wired in `HeroLaunchCurtain`): under the launch cover and
  before `pickHero()`, a rated lobby or Practice vs players calls `lobbyPoolGate.run()`. Ready pool: instant, no
  UI. Otherwise "Finding opponents..." (fades in after 350 ms so a short wait never flashes) with Cancel, while
  `ensure()` retries on the gate budget (10 s per request, 3 attempts). A genuine failure shows "Couldn't reach
  other players' boards." with Retry / Play anyway / Back to menu. Practice vs bots, the tutorial and builds
  without a backend pass straight through.
- **Telemetry**: `RunLobby.poolAtStart` (sim, pure count at creation: boards, runs, boards by wave; no RNG, so
  determinism is untouched) plus the client's pool `source` (network / cache / mixed / none).
  `lobbyPoolTelemetryOf(lobby)` adds the seat mix (recorded / hybrid / bot / authored) and `allGenerated`. The
  ranked upload stamps it as `lobbyPool` on the telemetry and inside the `derived` jsonb of `run_telemetry`
  (no SQL). Query: `derived->'lobbyPool'->>'allGenerated' = 'true'`.

## Offline = unrated (owner decision, same day)

Owner, verbatim: "offline = unrated". A lobby with no recorded player run at the table is unrated.

- **Sim**: `createRunLobby` stamps `RunLobby.unrated = 'all-generated'` when every opponent seat is hybrid or
  bot. `lobbyIsUnrated(lobby)` reads the stamp OR derives it from the seats, so a save from before the stamp and
  any other route to an all-bot table are covered. `allFightKeysGenerated(keys)` is the client copy of the
  server rule.
- **Client**: `rankedRunIdForFinish` (`rank/ratedRun.ts`) returns null for such a run, so no rank request is
  queued and no Ranked progression is begun. The end screen shows "Unrated · No opponents reached"
  (`unratedReasonOf`); the failure panel says "your opponents will be bots and the game won't be rated". The
  history row carries `entry.unrated = 'all-generated'`, boards upload with `unrated: true`, a Hall row carries
  `unrated: true`, and telemetry's `lobbyPool.unrated` is true. If the server answers `unrated_all_generated`
  (an item queued before this build), the store shows Unrated, not a failure.
- **Server**: `submit-rating` checks `allSeatsGenerated(seatKeys)` (in `_shared/lobbyRating.ts`) BEFORE
  `settle_rank` and answers `200 { status: 'unrated', error: 'unrated_all_generated' }`, writing nothing. Every
  client maps a 200 with an `error` string to `rejected`, which leaves the durable rank queue, so an old client
  gets no rating change and no retry loop. No SQL change. Needs the Edge Function redeployed.
- **XP / achievements**: none for an unrated lobby. The spec's default was "counts like Practice", but Practice
  XP is server-verified against a `practice_games` row and Ranked XP against an accepted rank result; an unrated
  lobby has neither, so paying it would need a new trusted source. Flagged for the owner.
- **Known limits**: a request with NO seat keys (only items queued before 2026-09-22) still settles; the
  server cannot verify that the keys sent are the seats the client really faced.

### Owner steps

1. `npx supabase functions deploy submit-rating --project-ref zcwhbejpqcdcfdpfxeza`
2. No SQL.

## Notes

- Background registration can land mid-run (like the existing between-runs refresh can land during a fresh
  run's first seconds). A live lobby is unaffected: seat drivers are built once and cached, and non-lobby runs
  pin their served boards.
