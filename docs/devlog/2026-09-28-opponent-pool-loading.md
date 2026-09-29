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

## Open owner decision

Whether an all-generated lobby should be unrated. Unchanged: "Play anyway" (only offered after the retries
fail) builds the lobby with generated seats and it stays rated, exactly as before.

## Notes

- Background registration can land mid-run (like the existing between-runs refresh can land during a fresh
  run's first seconds). A live lobby is unaffected: seat drivers are built once and cached, and non-lobby runs
  pin their served boards.
