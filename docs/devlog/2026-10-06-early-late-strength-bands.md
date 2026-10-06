# 2026-10-06 · Split early / late matchmaking bands by medal (R-LOBBY-13)

Owner design (2026-10-06), verbatim: *"perhaps we have multiple ratings like the weighted system / and we lean into
those different ratings depending on the rank / and then open it up to anything goes after a certain rank / like early
on i feel like we should focus on making sure the early game boards are weak / in bronze / ima just break it down
between early and late / early is 1-9 / late is 10+ / for bronze we should have a near 100% focus on making sure that
the early board strength stat is 0-20 or w/e / then silver is like 10-30 with an 80% weight / etc / then gold is 10-50
with 60% weight"*. Follow-ups: *"Blend, then band"* and *"Open from Platinum"*.

## The rule

- Each pool run gets two matchmaking ratings next to its weighted `strength` (R-LOBBY-12, unchanged):
  **EARLY** = the plain mean of its board percentiles in rounds 1-9, **LATE** = the same for rounds 10+, each rounded
  half up and then ranked among the set's runs (the tie-halving 1..100 rule of `runPercentileOf`). LATE is null for a
  run with no scored board at round 10+.
- A run's score for a medal = `w x EARLY + (1 - w) x LATE`; EARLY alone when LATE is null; a run with neither is
  unscored and inside every band.
- Bands: **Bronze** w 1.0, 0-20 · **Silver** w 0.8, 10-30 · **Gold** w 0.6, 10-50 · **Platinum, Diamond, Ascendant**
  no band. The widening rule (+10 per capped side, logged, before generated seats) and the 4-seats-per-player cap are
  unchanged. Practice and the tutorial have no band.
- "Game strength" (Career / Recent Games / Match details and the run-end freeze) stays the weighted number.

## What changed

- **`packages/sim/src/lobby/boardStrength.ts`**: `earlyLateStrengthOf` (rounds -> early / late means), `rankAmongRuns`
  (the ranking), `meanFromSum` (SQL twin `board_strength_mean`), `EARLY_LAST_ROUND = 9`. `RUN_STRENGTH_FORMULA` is
  `'earlyLate'`: the regime stamp names the score matchmaking filters on.
- **`strengthBands.ts`**: `StrengthBand.earlyWeight`, the new `STRENGTH_BANDS` table (`STRENGTH_BANDS_VERSION` =
  `B0-20/e100 S10-30/e80 G10-50/e60 P* D* A*`), `matchScoreOf(run, weight)` (SQL twin `pool_match_score`),
  `runInStrengthBand` (exact integer comparison, score x 100, so 0.8 x 30 + 0.2 x 30 is never 30.000000000000004),
  widening keeps the weight, `sameBand` compares it. `matchScoreOf` lives here rather than in boardStrength.ts because
  boardStrength.ts sits in an import cycle with runLobby.ts (a module-init call blew up).
- **Seat selection** (`runLobby.ts createRunLobby`) filters `runInStrengthBand(run, band)`; `PlayerRun` carries
  `early` / `late` from the boards' new `runStrengthEarly` / `runStrengthLate` stamps.
- **Pool fetch** (`ui/src/opponentPool/poolFetch.ts`): a split band is sent as `p_early_weight` + `p_strength_min` /
  `p_strength_max`; the sample rows' `strength_early` / `strength_late` ride on `PoolRun.early` / `late` and are stamped
  on every board at registration (`poolLoader.ts`).
- **SQL**: new `supabase/migrations/2026-10-06-early-late-strength.sql` (appended verbatim to `schema.sql`): columns
  `pool_runs.strength_early_avg`, `strength_late_avg`, `strength_early`, `strength_late`; `board_strength_mean`;
  `pool_match_score`; `pool_strength_refresh` computes the two new averages and ranks them (strength / strength_avg
  exactly as before); `pool_runs_sample` gains `p_early_weight` and returns the two ratings. Same locking pattern as
  2026-10-06-weighted-strength-again.sql, idempotent, ends with a full recompute.
- **Balance Report**: new era `bandsEarlyLate` (`EARLY_LATE_AT`, approximate) with `BANDS_V3`; the tripwire expects
  `[BANDS_V3, 'earlyLate']`.
- **`npm run strength -- measure`** prints the EARLY / LATE distributions, their correlation, and per medal the runs,
  players and seats under the cap each split band holds beside the weighted-era bands, plus the simulated lobbies'
  mean seat EARLY rating and match score.
- Rules: **R-LOBBY-13** (new), R-LOBBY-09 and R-LOBBY-12 amended so the registry doesn't contradict itself.
  GAME-RULES board-strength section, the ascent-lobby skill, and the 2026-10-06 patch note (the same-day "picked the
  way they were before October 3" entry was replaced, since this supersedes it).

## Before the owner runs the SQL (fallback)

The RPC does not know `p_early_weight`, so PostgREST answers "function not found" (PGRST202). `fetchPoolRuns` then sets
`session.splitBandsMissing` and re-asks with the same min/max and no weight, which filters the WEIGHTED strength (the
2026-09-30 behaviour). Those rows carry no `strength_early` / `strength_late`, so seat selection's `matchScoreOf` falls
back to the weighted strength too: client and server agree. Net effect until the SQL runs: Bronze 0-20, Silver 10-30,
Gold 10-50 on the weighted strength, open from Platinum. Clients deployed BEFORE this change keep working against the
new SQL: they never send a weight, and without one the band filters `strength` as before.

## Live-pool audit (anon GETs only, 2026-10-06)

`npm run strength -- fetch && npm run strength -- measure`: 189 runs, 2,259 boards, 181 eligible and scored. 41 of the
181 ended before round 10 (no LATE). EARLY vs LATE correlation over the 140 runs with both: 0.26.

| Medal | Split band | Runs | Players | Seats (cap 4) | Widenings | Mean EARLY of in-band runs | Weighted-era band | Runs | Seats | Mean EARLY |
|---|---|---|---|---|---|---|---|---|---|---|
| Bronze | 0-20 @ 100% | 38 | 9 | 20 | 0 | 10.6 | 0-30 | 58 | 23 | 22.4 |
| Silver | 10-30 @ 80% | 33 | 6 | 17 | 0 | 20.1 | 10-40 | 57 | 20 | 33.3 |
| Gold | 10-50 @ 60% | 76 | 7 | 21 | 0 | 34.1 | 20-65 | 88 | 21 | 48.4 |
| Platinum / Diamond / Ascendant | none | 181 | 10 | 28 | 0 | 50.5 | (P none, D 10-100, A 20-100) | 181 / 164 / 147 | 28 / 25 / 23 | 50.5 / 54.5 / 58.8 |

200 simulated lobbies per medal (`createRunLobby` on the live pool): no widening and no generated seat in any medal;
mean seat EARLY rating Bronze 10.9, Silver 20.1, Gold 33.2, Platinum+ 50.0.

Against the strength column the live pool stores TODAY (read back from `pool_runs.strength`, which already holds the
weighted numbers): Bronze 0-30 draws 60 runs with a mean EARLY rating of 23.7 (mean early board percentile 35.0); the
split Bronze band draws 38 with 10.6 (27.3). The coordinator's earlier audit quoted "~47 -> ~10" for Bronze; ~47 is
not reproduced on today's pool (it matches the final-board era's strength column), so the honest before/after on
today's numbers is ~24 -> ~11 (ranked early rating).

Concentration to watch: the in-band runs are mostly two players (Bronze: LazerLemon 14, Orangez 13 of 38); the 4-seat
cap holds each to 4 seats, so a Bronze table is still mostly those two. A thin pool, not a rule problem.

## Owner action

**Run `supabase/migrations/2026-10-06-early-late-strength.sql` in the Supabase SQL Editor** (paste, Run). Idempotent;
takes both pool tables in one transaction and ends with a full recompute.

Check after running: `select count(*) filter (where strength_early is not null) as early, count(*) filter (where
strength_late is not null) as late, count(*) filter (where strength is not null) as weighted from pool_runs;` (early ~=
weighted, late lower: runs that ended before round 10 have none).

## Verification

- `boardStrength.db.test.ts` (PGlite, every migration in order incl. the new one): `board_strength_mean` =
  `meanFromSum`, `pool_match_score` = `matchScoreOf` over every rating shape and weight, early / late averages and ranks
  equal the TS numbers on synthetic runs AND the real live-pool fixture (weighted strength untouched), the sample
  filters the blended score with a weight (exact at the 30 / 30.8 / 29.6 boundary) and the weighted strength without
  one, idempotent.
- `strengthBands.test.ts` (table, blend, widening, seat selection by blend, pre-SQL fallback), `boardStrength.test.ts`
  (ui: lobby band per medal, `p_early_weight` sent, the drop-only-the-weight fallback, the loader stamps),
  `reportSources.test.ts` (new era).
