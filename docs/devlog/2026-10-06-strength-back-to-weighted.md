# 2026-10-06 · Game strength back to the round-weighted number (the final-board formula reverted)

Owner decision (2026-10-06), verbatim: *"matchmaking algorithm -> backtrack to the weighted version."* This reverts the
strength half of [#1928](2026-10-03-final-board-strength.md): a run's strength (the matchmaking bands and the "Game
strength" a player sees) goes back to the **round-weighted average of its board percentiles, ranked among runs**
(#1890, [2026-09-30-weighted-strength.md](2026-09-30-weighted-strength.md)), and the rank bands go back to the #1871
table. #1928's other half, **R-NET-01** (no backend read cut at 1,000 rows), is kept untouched. Rules: **R-LOBBY-12**
amended (it now pins the weighted rule and records the three-day final-board era), **R-LOBBY-09** band text amended.

## Why: the live-pool audit

Measured on the live pool this session, comparing each run's strength with how strong its boards actually were round
by round:

- Under the **final-board** formula a run's strength correlated only **~0.03-0.19** with its board percentile in rounds
  **3-7**. Under the **weighted** version the same correlation is **0.26-0.62**. Matchmaking deals a seat's board
  round by round, so a strength that says nothing about rounds 3-7 picks opponents who are effectively random for most
  of a game.
- The symptom players saw: **Bronze lobbies were dealing round-7 boards at the 88th percentile labelled "Game
  strength 2"**. A run that ended weak (one bad final board) read as a 2 even though it had been one of the strongest
  runs in the pool for most of its game, so it landed in the lowest band.

The final board was chosen on 2026-10-03 after the Rooks / Albus report (a 12th-percentile final board showing 83).
That complaint is real but the cure cost more than the disease; the owner chose the weighted version.

## What changed

- **`packages/sim/src/lobby/boardStrength.ts`**: `runStrengthFromScores(scores, hist, runs)` again returns the weighted
  `average` and `value = runPercentileOf(average, runs)` (null without the run histogram), exactly as #1890 had it.
  `RUN_STRENGTH_FORMULA` is `'weighted'` (the Balance Report regime stamp). `runFinalStrengthOf` / `finalFromSum` stay
  exported as diagnostics (the measure tool prints the final-board number beside the weighted one; the DB parity test
  still checks the unused SQL twin).
- **`strengthBands.ts`**: Bronze 0-30, Silver 10-40, Gold 20-65, Platinum uncapped, Diamond 10-100, Ascendant 20-100
  (`STRENGTH_BANDS_VERSION` = `B0-30 S10-40 G20-65 P* D10-100 A20-100`, i.e. `BANDS_V1`).
- **Client run-end freeze** (`packages/ui/src/store.ts`): passes `runStrengthHistogram()` again.
  `packages/ui/src/remoteBoards.ts` fetches `run_strength_histogram(p_set)` again alongside the board histogram, now
  paged through `fetchAllRows` (`fetchRunStrengthHistogramRows`) so it obeys R-NET-01 like every other list read (it
  is at most 100 rows, one per whole average, but nothing is exempt). The RPC never left the database: #1928 kept it
  for older clients.
- **Hover tip** (`GAME_STRENGTH_TIP`): back to *"How strong your board was across the whole game, compared with
  everyone else's. Later rounds count more."*
- **Balance Report regime** (`reportSources.ts`): a new era `bandsWeightedAgain` (`WEIGHTED_AGAIN_AT`, approximate:
  this PR's merge day) mapping to the same weighted + `BANDS_V1` regime, so its filter key equals the 2026-10-01 era's.
  Only unstamped rows read it; every build since #1938 stamps its rows. The tripwire in `reportSources.test.ts` now
  expects `[BANDS_V1, 'weighted']`.
- **`npm run strength -- measure`**: prints "weighted (current)" beside "final board (retired 2026-10-06)".
- **SQL**: new `supabase/migrations/2026-10-06-weighted-strength-again.sql` (appended verbatim to `schema.sql`)
  restores the 2026-09-30 weighted `pool_strength_refresh` (average per run, then the rank window over every run of the
  set) and recomputes every run. `board_strength_final` stays in the database, unused.
- Docs: GAME-RULES board-strength section; patch note dated 2026-10-06.

## Owner action

**Run `supabase/migrations/2026-10-06-weighted-strength-again.sql` in the Supabase SQL Editor** (paste, Run). It is
idempotent, takes both pool tables in one transaction (as the earlier strength migrations did) and ends with a full
recompute, so the bands flip the moment it finishes. Until it runs, the shipped client filters the pool's
**final-board** strengths through the restored **weighted-era** bands (and freezes the weighted number on new games),
so run it as soon as the PR merges.

Check after running: `select count(*), min(strength), max(strength), percentile_cont(0.5) within group (order by
strength) from pool_runs where strength is not null;` should span roughly 1-100 with a median near 50 (ranked).

## Verification

- `boardStrength.db.test.ts` (PGlite): every migration in order including the new one; on the REAL live-pool fixture
  the 2026-10-03 SQL produces exactly the TS final-board numbers, the two formulas disagree on more than 50 runs, and
  then the 2026-10-06 SQL flips every run to exactly the TS weighted-and-ranked number; idempotent on re-run.
- `boardStrength.test.ts`, `strengthBands.test.ts`, `runEndStrength.test.ts` (the real store freezes the ranked
  number), `supabaseRows.guard.test.ts` (the run histogram is paged), `reportSources.test.ts` (new era).
- Gates: typecheck, lint, test, build:web, `npx vitest run packages/rules`, `npm run docbot:report -- --check`.

## Follow-ups

- The Rooks / Albus shape (dominant early, weak final board) reads high again by design. If the owner wants the final
  board to matter more, the lever is the round weights (20/35/45), not a switch of formula.
- Numbers frozen in match history between 2026-10-03 and the deploy are final-board numbers and stay that way.
