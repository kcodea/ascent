# 2026-11-16 — Strength v2, step 1: measurement tooling (no game change)

Mike asked for a deep dive on snapshot strength and on what a player can face. The design is
`docs/superpowers/specs/2026-11-16-strength-v2-design.md` (approved 2026-11-16); this is step 1 of 3 and changes
nothing in the game. Plan: `docs/superpowers/plans/2026-11-16-strength-v2-tooling.md`.

## What shipped

- `packages/sim/src/lobby/strengthV2.ts`: the v2 rules as pure functions (a run must reach round 7; fielded
  rounds = real rounds plus the final board carried forward; EARLY = rounds 1-9, LATE = rounds 10-15; peak = best
  real board from round 3 on). **Nothing in the game calls it yet.** The tools do, so the measurement and the
  later game change share one definition.
- `npm run strength -- ref --v2`: builds a CANDIDATE v2 reference from the live window (40 boards per round: 28
  evenly spaced + 12 in the top 20%, 4 fights each, at most 10 per player) into `packages/tools/.cache`. It is not
  committed and the game never reads it. Step 2 generates and commits the real one just before rollout.
- `npm run strength -- measure --v2`: the live window under the v2 rules (carry-forward ranking, drift alarm,
  today's bands on v2 ratings, the peak-cap table, what each medal can face per round).
- `npm run strength -- validate`: v2 board percentiles against real `lobby_fights` (who actually won).
- The tools now read `pool_runs.live` (the rolling window); a cache fetched before that flag refuses with a clear
  "fetch first" message. Plain `ref` / `measure` / `backfill` (v1) are unchanged.

## Measured 2026-11-16 (250 live runs; 592,640 fights, 0.87 ms each)

- The 7-round floor drops no live run today.
- The live window reaches 15 reference rounds (round 16 has fewer than 40 real boards, so it folds into 15).
- The 250 live runs come from **5 accounts** (LEMON and LazerLemon are one account, Rooks and BraveLynx12 another; the fifth holds one run), so no table can seat more than
  17 recorded runs from the whole pool, and Bronze and Silver top out at 16.
- Candidate reference: the median real board wins 26-44% against it and the 90th percentile 68-88%, so nothing
  sits at the ceiling any more (v1: medians 55-69%, 90th percentile 92-97%). Round 1 still has only 32 distinct
  scores.
- EARLY vs LATE correlation 0.34, and every run now has a LATE rating.
- Today's bands on v2 ratings: Bronze 39 runs, Silver 54, Gold 106.
- Peak caps (runs left / removed / seats left under the 4-per-player cap):

  | Medal | cap 60 | cap 70 | cap 80 | cap 90 | cap 95 |
  |---|---|---|---|---|---|
  | Bronze (39) | 16 / 23 / 10 | 27 / 12 / 14 | 33 / 6 / 16 | 38 / 1 / 16 | 39 / 0 / 16 |
  | Silver (54) | 11 / 43 / 8 | 24 / 30 / 12 | 37 / 17 / 16 | 51 / 3 / 16 | 52 / 2 / 16 |
  | Gold (106) | 12 / 94 / 9 | 31 / 75 / 13 | 56 / 50 / 16 | 83 / 23 / 16 | 97 / 9 / 17 |

- Strongest single board in band today, by round (no peak cap): Bronze 65-92, Silver 79-99, Gold 93-100.
- `validate`: of 20,346 recorded fights, 1,603 are between two live runs (the rest name a run outside the live window, 30 a generated seat). The stronger board won 65% at a gap of
  0-10 percentile points, 84% at 10-20, 90% at 20-30, 95% at 30-50, 98%+ beyond. EARLY rating vs real early win
  rate over the 19 runs with 20+ fights: correlation 0.77. Only one run has 20+ late fights, so the late check has
  no sample yet. Caveat: the real fights and the test fights use the same combat engine, so this checks that the
  percentile ordering holds on real pairings, not that the engine is right.

## Review

One independent whole-branch review. Two findings fixed test-first: rounds past the last reference round were
joining round 15's ranking population (a run that reached round 17 counted three times there), and `validate`
labelled a live run fielded past round 15 as "outside the pool". Deferred minors: the "disagree most" list compares a
rank with a win rate (different scales); the score cache is keyed only by the reference file, not the engine
version (delete `packages/tools/.cache/strength-scores-v2.json` after a balance change); an empty pool cache
builds an empty reference instead of refusing.

## Follow-ups

- Mike sets the three peak caps from the table (design section 9).
- Step 2 (v2 scoring in the game, carry-forward, the 7-round floor, unscored runs out of banded lobbies, the
  "Calculating Score" lock) and step 3 (peak caps) get their own plans. Step 2 touches SQL, the hub Worker and
  needs a Ship Ascent.
- `docs/board-pool.md` describes the older per-wave pool and has no strength-tool section; the command list lives
  in the header of `packages/tools/src/strength/cli.ts`.
