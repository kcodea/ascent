# 2026-10-26 — Practice: dev-only Set picker (bots on the chosen set)

Owner ask: "can you add a dev only practice option in sandbox to select the set to practice with? this would then just
use the bot runs for that sandbox test environment."

## What it does

- **A `Set` row on the Practice screen (Sandbox Mode), DEV builds only** (`import.meta.env.DEV`). It lists every set in
  `SETS` by display name (the live one marked "(live)"), default = the live set. Picking a set re-scopes the Tribes row
  to that set's tribes and, for a non-live set, benches the Opponent Rank row (it has no say: there are no recorded
  runs to band). God Mode ignores the pick and plays the live set (`godPracticeConfig` drops it).
- **The pick is pinned on the run at creation.** `PracticeConfig.setId` -> `practiceSetOf(cfg)` -> `createLobbyRun`
  pins it through `createRun`, so `poolOf(state)` returns it for the whole run (save, Continue, replays). Heroes,
  tribes, shop, Discovers, spells, runes, quests and the Runeforge all already read the run's pinned set or its tribes.
  `activeSet()` and the `enabled` flags are never touched.
- **Opponents for a non-live set are generated bots on that set.** `LobbySeatOptions.setScopedBots` seats no recorded
  run at all and stamps each generated (`hybrid`) seat with `LobbySeatState.setId`. Picking the live set is ordinary
  Practice (recorded player runs, Opponent Rank honoured), seat for seat.
- **A dev-set game writes nothing.** `createLobbyRun` keeps `practiceConfig.setId` on the run ONLY when the set is not
  the live one, and `isPracticeDevSetRun(run)` gates the store's Practice end-of-run block: no `practice_games` row, no
  replay upload, no XP. Practice never wrote ranked data (boards, `board_results`, history, telemetry, rating, Hall,
  live broadcast are all gated on `mode === 'lobby'`), so nothing else needed a gate. The run still takes the local save
  slot (and its cloud copy, as every Practice save does), so Continue works.
- **Player builds can never reach it.** The row is not rendered, and the store strips any `setId` from the draft at load,
  at confirm and at the hero pick (`devPracticeSet` / `practiceDraftForRun`).

## The latent bug it exposed

Generated seats always played the LIVE set: `driverFor` built `hybridSeat` / `botSeat` / `autoplayRun` with no set, so
`createRun` defaulted to `activeSet()` even inside a lobby pinned to another set. It never bit, because only the live
set seated generated seats (the Scene Builder uses authored bot seats). The set now threads through `hybridSeat`,
`botSeat`, `recordRun`, `recordingFieldsBoard` and `autoplayRun` from the seat's `setId`, and the recording cache keys
on it (`seed|hero|set`) so a set-scoped recording never answers for a live-set seat. Unstamped seats key exactly as
before (`seed|hero`), so every existing save's stored recordings still prime and serve.

## Tests

`packages/sim/src/lobby/practiceDevSet.test.ts` (pinning, shop/tribes/heroes from the set, generated-only seats whose
boards are the set's cards even with a recorded run of that set in the pool, the save round trip with the set, live
switch untouched, live pick = ordinary Practice, God Mode drops it) and `packages/ui/src/PracticeOptionsSet.test.tsx`
(the row, its effect on Tribes / Opponent Rank, absent in a player build, no tooltip / em dash, the store carrying the
pick onto the run in DEV and dropping it in a player build).

No oracle rule (a dev tool, owner convention) and no patch note (not player-facing).
