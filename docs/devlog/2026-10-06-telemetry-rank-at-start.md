# 2026-10-06: Rank at game start in telemetry, and `npm run newcomer:rate`

Owner decision (2026-10-06): yes to "Start recording each player's rank in game telemetry, so we can measure real
newcomers' top-4 rate". The target is that Bronze players place top 4 about 40% of the time. A measurement the same
day found the rank a game was played at stored nowhere readable for analysis: `run_telemetry` (public read) had the
placement and the band asked for, but no rank; `run_history.entry.rank` has it but is authenticated-read only.

Rule: **R-TELEMETRY-RANK-01** (persistence).

## What a rated row now carries

`run_telemetry.derived.rankAtStart` = `{ v: 1, medal, divisionIndex, division, points, rating, seasonId }`
(`packages/sim/src/rankAtStart.ts`). `rating` is `rankScalar` (`100 × divisionIndex + points`, the same number
`profile.rating` holds).

- **Pinned at game start**, not at upload: `pinMedalAtStart` (`ui/src/goldClock.ts`, called by `pickHero` / `newRun`
  beside `runId`) now pins `RunState.rankAtStart` in the same call and under the same gate as `medalAtStart` (#1955),
  so the Bronze clock and the telemetry can never disagree. Plain JSON on the run, so it survives Save & Quit and cloud
  resume and never moves with a rank change mid-game.
- **Stamped at upload** beside `derived.regime` by `rankAtStartForTelemetry(next)`, which answers undefined for
  anything but a rated lobby (Practice, tutorial, Gauntlet, sandbox, unrated all-generated tables), even if a pin
  leaked. A run resumed from a save written before this build stamps `{ v: 1, medal }` from its `medalAtStart`.
- **The regime stamp** (`currentRegime`: `STRENGTH_BANDS_VERSION` + `RUN_STRENGTH_FORMULA`, `earlyLate` /
  `B0-20/e100 ...` since #1956) was already on every lobby row; a test now pins that both fields are always set.
- **No backend change**: `derived` is jsonb.

## Readers

- Balance Report fetch (`remoteBoards.ts`): one more small JSON path, `derived_rank_at_start:derived->rankAtStart`,
  parsed by `parseRankAtStart` (absent or malformed = unknown, never a guessed medal).
- Export (`playerReport.ts`): `runs[].rankAtStart` (null = unknown) and `derived.rankAtStart`, both in the readme.
  The schema version stays 3: a column was added, none redefined.

## `npm run newcomer:rate`

Read-only (anon GETs, paged past 1,000 rows per R-NET-01, via the strength tools' `getAll`). Keeps rated lobby games
with a placement, drops developers (`DEVELOPER_AUTHORS = ['LazerLemon', 'Orangez', 'LEMON']`, matched on the handle before any
`#tag` and widened to every account key those handles uploaded under), keeps games whose rank at start is Bronze, and
prints the top-4 rate with a Wilson 95% interval, games and distinct players, overall and per regime. Rows without a
stamp read as Bronze only from Bronze's band in their band table (`0-30` / `0-20`), labelled approximate; rows with
neither are counted as unknown and left out.

First run (2026-10-06, before any stamped upload, LEMON included): 193 rows, 167 developer games excluded (165 by
handle, 2 by shared account), 26 rated non-developer games: 4 approximate Bronze (3 of 4 top 4, one player), 22 unknown. Nothing to read
yet; the number becomes meaningful as stamped Bronze games from real newcomers come in.

`LEMON` is in the list too (owner 2026-10-06: "LEMON is mine, add it to the list"), which also excludes the LEMON
handle on its second account key.
