# 2026-10-03 — Balance Report export: every field from live data, a regime stamp, and a build filter

Owner: "yes fix these issues" (on the export audit of the same day). Dev / analytics tool only, so no patch note.
Oracle: **R-REPORT-04** (`packages/rules/src/registry/approved/persistence.ts`).

## The bug

The run-end upload built each lobby run's telemetry row with `reconstructRunTelemetry`, which replays
`(seed, actions)` through a plain `createRun`. A lobby run has seats the replay does not attach, so the replay goes
off course from the first combat (`snapshot.ts` already documented this for boards). Only the card streams were
overlaid from the live log (`withLiveTelemetry`, whose comment wrongly claimed the replay got the tier curve, quests
and runes right). So:

- `runs[].wins` came from the replay's history. On content revision `bba0a133` (36 rows) it matched the live combat
  count on **5**. Hero `avgWins` (both aggregators) read it.
- `tierByWave` ran short of or past the live `finalWave` on **32 of 36** rows, so the shop curve dropped late waves
  from short rows and gained a phantom wave from long ones. Quests and runes were truncated the same way.
- Nothing recorded the matchmaking regime (band table + strength formula); one epoch mixed 13 client builds.

## The fix

**Capture live (going forward).** `TelemetryLog` gains OPTIONAL `tierByWave`, `offeredQuests`, `pickedQuests`,
`questTurns`, `questStart`, `offeredRunes`, `pickedRunes` and `liveFromWave` (old saves still load; a log that
lacks them creates them on first use and records the wave it started, so a resumed run is known to be partial).
`recordTelemetryAction` fills them per dispatched action. The store's lobby upload now calls
`lobbyRunTelemetry(log, finalState, heroOffer, fallback)`: `wins` from the run's own history (as `uploadVictory`
does), the tier curve closed to exactly waves 1..final wave, quests and runes from the log. The replay is only called
for a log that started mid-run, and the row's `capture` stamp says which fields were live.

**Regime stamp.** `currentRegime(lobbyPool)` stamps `{ bandsVersion, strengthFormula, band, bandUsed }` into
`derived.regime` (no SQL, like `lobbyPool`). `bandsVersion` = `STRENGTH_BANDS_VERSION`, a string built from
`STRENGTH_BANDS` itself, so a threshold change changes it. `strengthFormula` = `RUN_STRENGTH_FORMULA` in
`boardStrength.ts`, now `'final'` (#1928 landed on main during this work; the merge set it). Change that constant in
the same PR as any change to how run strength is computed. `derived.capture` rides beside it.

**Readers (history improves too).** `reportSources.ts` picks the best source per field per row, and
`applyReportFilters` runs it on every row, so hero `avgWins` (both aggregators), `tierImpact`, the shop curve and
the export all read corrected values:

- wins: live, then `derived.wins`, then a count of `derived.combats`, then the replay.
- tierByWave: live, then rebuilt from the live derived payload (end-of-shop board tier, raised by taken upgrades,
  carried forward), then the replay. Every series is clamped to the live final wave, which removes the phantom wave.
- quests and runes: live, else the replay (flagged; the derived payload never recorded rune or quest ids).
- regime: the stamp, else inferred from the build (`KNOWN_BUILD_ERAS`, measured with `git merge-base
  --is-ancestor` against #1871 and #1890), else from the date against the cut-over merges. Build 842413357 had no
  bands but uploaded rows a day after the bands merged, which is why the build beats the date.

The flat fetch also reads four small JSON paths out of `derived` (`finalWave`, `capture`, `regime`, `lobbyPool`), so
rows past the derived cap still clamp and still know their regime.

**Scope + export.** `ReportScope` gains `regime` and `build`; the panel has two new pickers beside the epoch.
`ExportedRun` gains `build`, `regime` (with its basis) and `sources` (per-field source, stored values, final wave,
flags). `meta.regimes`, `meta.builds` and `meta.quality.sources` are new. Export schema **3** (wins / tierByWave are
redefined, so a new version). The readme labels for `runs.wins`, `heroImpact.avgWins` and `report.avgWins` are
corrected, and the stale hardcoded "91 of 110 on 2026-09-22" is replaced by counts computed from the file.

## Older rows: what stays imperfect (flagged, never mixed in silently)

- `derived.wins` skipped rounds 1 and 2 until #1589 (2026-09-21 01:40 UTC). For those rows the live combat rows
  are counted instead, unless they are stacked.
- Before #1641 (2026-09-23 02:56 UTC) a session's observer could carry an earlier run into the next. The per-wave
  combat dedupe then dropped the new run's early waves, so the combat list can look perfectly ordered while holding
  two runs. Such rows are detected by shape or by any other stacked stream, and keep `derived.wins` flagged
  `winsExcludeCalibration`. On the whole Set 2 ladder (175 rows) that is 41 rows; 53 carry `combatsStacked`.
- Quests and runes before this fix are replay-derived on every row (`choicesReplay`); 32 of the 36 epoch rows are
  also `choicesDiverged` (their replay demonstrably went off course).
- Regimes before this fix are inferred (`inferredFromBuild` / `inferredFromDate`); the date path is the weakest.

## Before / after on live data (read-only anon REST, 2026-10-03, epoch `bba0a133`, 36 rows)

| | before (stored) | after (new readers) |
|---|---|---|
| wins agree with live combat count | 5 / 36 | 36 / 36 |
| tierByWave covers exactly 1..finalWave | 4 / 36 | 36 / 36 |
| T5 reached / avg wave | 30 (83%) / 8.7 | 33 (92%) / 8.8 |
| T6 reached / avg wave / early runs | 15 (42%) / 10.5 / 8 | 18 (50%) / 10.7 / 12 |
| T6 early-group delta | -2.37 | -2.21 |
| won runs on the curve at waves 13 / 14 / 15 | 5 / 4 / 2 | 16 / 14 / 9 |
| won curve, waves 13-16 | 5.80, 5.75, 5.50, 5.50 | 5.75, 5.71, 5.89, 6.00 |

The old late-game "won" curve dipped (5.8 to 5.5) because most winners' replays stopped early and the few left were
off-course replays; read live, winners keep climbing to T6. Hero avgWins rose across the board (Drakko 8.3 to 10,
Indy 7.3 to 9.3, Bram 3 to 8, Soren 4 to 10): the replay undercounted rounds won. The epoch's regimes split 22 no
bands / 9 average-strength bands / 5 weighted-strength bands, all inferred from the build.

## Verification

`reportSources.test.ts` (new, 17 tests): three real lobby runs played to gameover through the live log and the live
derivation; live wins = history wins = derived combat wins; tierByWave covers exactly 1..final wave and equals the
curve rebuilt from the derived payload; rune picks are exactly what the player bought; a resumed partial log falls
back for tier + choices only; readers on fixtures modelled on real rows 183 and 160; stacked and pre-#1589 rows; the
regime stamp, inference and the scope filter; the export's runs/meta/readme. `balanceFetch.test.ts` pins the new
JSON-path scalars. Existing report tests updated for schema 3 and the new quality block.
