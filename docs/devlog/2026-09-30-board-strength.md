# 2026-09-30 · Board strength: a 1-100 percentile, rank bands, and the number in match history

Owner design (2026-09-30), agreed in chat: *"can we build an algorithm for board strength to get as good of an idea of
how strong a snapshot's run is, and assign it a 1-100 value? we can probably get an 'average' strength to measure
against as well, and then serve for example 0-30 for bronze, 10-40 in silver, 20-65 in gold, and then uncap plat?"*,
*"can we show that score to the player too maybe? like maybe that is shown in match history?"*, *"72 would basically
mean like... a 72/100 aka 72nd percentile"*. Not now: a separate Ancients / Platinum+ pool (*"dont worry about the
ancients and plat separation just yet ... keep it all in the same bracket"*), but the selection takes a pool id so a
second pool is a small change later. Upper ranks, decided the same day: *"maybe plat should be 50 and then diamond is like 55 average and ascendant is 60 average? i dont want every game to just be insanely sweaty and unwinnable"*. Rule: **R-LOBBY-09**.

## The rules as built

1. **Raw score (per board).** Win rate (win 1, draw 0.5) against a frozen, versioned **reference set**: up to 30 real
   boards per wave from the live pool, weakest to strongest, `packages/sim/src/lobby/strengthReference.v1.json`
   (version `set2-v1`). Two seeded fights per reference board, the scored board on the player side in one and on the
   enemy side in the other, so the first-attacker edge cancels. Both sides fight through `sideFromSnapshot` with
   `opponentBoard`, the same builder a recorded lobby seat fights the player with (hero rune mods, auras, spell
   power, every run-level scaler). Seeds depend only on (reference version, wave, reference index, fight), so two
   boards meet identical dice. Deterministic, stored permanently (`boards.strength_raw`, `strength_ref`,
   `strength_wave`), rounded to 4 decimals.
2. **Percentile (per board).** `100 * (below + equal / 2) / n` over every scored board at the same reference wave and
   version, the board itself counted in `equal`, rounded half up, clamped to 1..100, computed in integer arithmetic
   so TS (`pctFromCounts`) and SQL (`board_strength_pct`) cannot round differently. Derived, never stored on a board.
3. **Run strength: a true percentile among RUNS** (owner-approved follow-up, same day). First the run's AVERAGE of its
   per-board percentiles, rounded (`pool_runs.strength_avg`, `runAverageOf`); then that average RANKED against every
   other run's average in the set with the same tie-halving 1..100 rule (`pool_runs.strength`, `runPercentileOf`), so
   30 means the bottom 30% of runs and each band holds about its nominal share. Averages are refreshed for the
   uploaded runs on every scored upload (every run when the oldest stamp is over 10 minutes old); every run's rank is
   recomputed on every refresh (one window over `pool_runs`, only changed rows written). Why: averaging percentiles
   pulls toward 50 (a run is rarely the weakest in every round), so the plain average spread only 9-83 and Bronze
   0-30 held 13% of runs while Gold 20-65 held 82%.
4. **Bands.** Bronze 0-30, Silver 10-40, Gold 20-65, Platinum uncapped (average opponent ~50), Diamond 10-100 (~55),
   Ascendant 20-100 (~60); every division of a medal shares the medal's band (`STRENGTH_BANDS`,
   `strengthBandForDivision`). RATED lobbies only; Practice and the tutorial have no
   band. Inside the band: the same uniform seeded shuffle, whole runs, at most 4 seats per player, never your own runs.
5. **Unscored runs** (no score yet, not backfilled) are **inside every band**. Before the SQL and the backfill nothing
   is scored, so selection is exactly R-LOBBY-08's, seat for seat (pinned by a test).
6. **Widening.** When a band cannot fill the table it widens by 10 on each capped side, one step at a time (Bronze
   0-30, 0-40, ... 0-90, uncapped; Gold 20-65, 10-75, 0-85, 0-95, uncapped; Ascendant 20-100, 10-100, uncapped: a
   floor-only band just lowers its floor). Two places widen: the pool FETCH (the
   server sample is asked again with the wider band while the runs it holds cannot seat 7 under the 4-per-player
   cap) and SEAT SELECTION (a second pass over the same shuffle with the wider band; runs considered once are never
   reconsidered, so every run keeps its equal chance inside each step). Only after the band is uncapped do generated
   seats fill the rest. Both are logged: `lobbyPool.strengthBand`, `strengthBandUsed`, `bandWidenings`,
   `poolFetchWidenings` in the lobby telemetry row.
7. **Showing it.** Career rows and Recent Games rows print **"Board strength 72"** (the run's strength, the percentile
   among runs); Match details shows it per seat (each opponent's run strength, as the pool delivered it) and your own
   per-round numbers (those stay BOARD percentiles: each round's board against the pool's boards of that wave). The
   number is FROZEN when the game ends: `run_history.entry.boardStrength`, `replay.v2.result.boardStrength`, and the
   Match details seats. A game that was not scored shows nothing (no placeholder).

## Decisions I made (flag any to change)

- **The player's own numbers are computed on the client**, from two server histograms fetched at startup and between
  runs: `board_strength_histogram` (per-round percentiles, the fresh board counted as if already in the pool) and
  `run_strength_histogram` (the pool's run averages; the finished game's average is ranked against them, counted as
  if already in). Without the run histogram the per-round numbers still freeze but the run shows no strength. That is what lets the number be frozen in the history row at insert time: `run_history` is insert-only
  for clients, and the history insert must not wait on a network call (it goes out ahead of the rank request).
- **Scoring is incremental**, not after the game: each board is queued the moment it is captured (End Turn) and
  scored in idle slices (`requestIdleCallback`, 4 fights per uninterruptible step, continue only while the deadline
  has 4 ms left, 250 ms rIC timeout). By the time a game ends, every board but the last was scored rounds ago and the
  last one during its own combat animation. The run-end uploads wait for the scores (`settled`), normally zero time,
  never more than 1.5 s, then go without the missing ones. No Web Worker: the idle slices measure well under a frame
  (below), and a worker would ship a second copy of the engine.
- **Only rated lobby boards are scored** (the boards that go into the pool). Practice games show no board strength.
- **Reference waves.** 15 reference waves; a wave with fewer than 20 eligible boards is merged with every later wave
  into the last reference wave (live: waves 15-18 = 60 boards, so wave 16+ boards are scored against wave 15's
  set). Percentiles are bucketed by that reference wave too.
- **Population.** Boards: every board with a score (both copies agree): only boards with minions are ever scored, and
  synthetic boards never, so the count is an index-only scan and never reads a snapshot. Runs: every `pool_runs` row
  of the set with an average (eligible or not; 5 of 158 today are ineligible).
- **Monotonicity.** A flat +3/+3 on every minion never costs more than 2 of 60 fights and on average only helps; a
  flat +40/+40 never scores lower. It is not strictly monotone per board because the fights are seeded, not
  scripted: a buffed minion survives a hit, later random targets differ, one fight flips. Worth knowing: the wave-13
  Indy board (Sunmane, Echohorn, two Manasabers, T-Rex, Hawkus, Solaris) with DOUBLED stats loses to its own
  original 163-129 over 300 seeds (188-104 without its runes). More stats is not always stronger in this game; I
  did not dig into which card causes it.
- **Client trust.** Scores are client-computed and uploaded (friends and family). The backfill is computed locally
  from the committed reference, so anyone can recompute any score.

## The reference set

Generated once by `npm run strength -- ref` from the live pool (read-only GETs, 2026-09-30: 158 runs, 153 eligible,
1,856 boards). Per wave: every eligible board (one per run) plays a seeded round robin inside its wave (56 s in all),
and 30 boards at evenly spaced ranks, weakest to strongest, become the reference. Display-only fields are stripped.
651 KB of JSON, **79 KB gzipped**, loaded lazily (`loadStrengthReference`, its own chunk): the menu, shop and
combat never pay for it until the first capture of a rated game.

## Cost (node, the live pool, all 1,856 boards)

| | |
|---|---|
| Per fight | 0.41 ms on average (0.6-0.9 ms in the busiest middle waves) |
| Per board (60 fights) | median 22 ms, p95 53 ms, max 123 ms, spread over idle slices |
| Per 4-fight step (the uninterruptible unit) | median 1.4 ms, p99 6 ms, max 25 ms (the first steps, JIT warm-up) |
| Per game (~15 boards) | ~0.4 s of idle-time work across the whole game |
| Run end | waits 0 ms when the last board finished during its combat; capped at 1.5 s |
| Whole pool (backfill) | 111,360 fights in 46 s |

For comparison, the odds probe already runs 200 sims per combat in 10-sim steps (7-44 ms per combat).

## Measured against the live pool (read-only, 2026-09-30)

Raw win rates spread well inside every wave (p10 ~0.13, median ~0.5, p90 ~0.86; 24 to 88 distinct values per wave).
The run AVERAGES of board percentiles (153 eligible runs, all scored) squeeze toward 50: min 9, p10 30, median 48,
p90 68, max 83. Ranked among runs, the run STRENGTH spans the scale: min 1, p10 12, p25 27, **median 50**, p75 75,
p90 91, max 99; per decile (1-10 ... 91-100): 15, 17, 14, 15, 17, 12, 17, 18, 12, 16.

| Band | Runs in band (share) | Players | Seats it can fill (4-cap) | Widening needed |
|---|---|---|---|---|
| Bronze 0-30 | 46 (30%) | 9 (LazerLemon 17, Orangez 17, Rooks 6, ...) | 22 | never |
| Silver 10-40 | 47 (31%) | 7 | 20 | never |
| Gold 20-65 | 72 (47%) | 7 (LazerLemon 36, Orangez 27, ...) | 17 | never |
| Platinum (uncapped) | 153 | 10 | 28 | n/a |
| Diamond 10-100 | 139 (91%) | 9 | 25 | never |
| Ascendant 20-100 | 125 (82%) | 9 | 23 | never |

Real lobbies (`createRunLobby` over the live pool with every run's strength stamped, 200 lobbies per medal): **0
widenings and 0 generated seats in every case**, as a newcomer, as LazerLemon and as Orangez (their own runs
excluded). Seated-run strength per medal: the mean over all seats, and the mean of each table's strongest and weakest
seat (newcomer; LazerLemon / Orangez in brackets):

| Medal | Mean seat | Strongest seat | Weakest seat |
|---|---|---|---|
| Bronze | 15.1 (16.1 / 14.1) | 26.7 (27.0 / 27.2) | 3.6 (4.7 / 2.5) |
| Silver | 25.2 (22.6 / 24.8) | 37.2 (34.4 / 37.4) | 13.5 (12.8 / 12.4) |
| Gold | 41.2 (36.9 / 39.6) | 58.7 (58.0 / 58.7) | 23.9 (21.7 / 22.8) |
| Platinum | 49.9 (46.3 / 45.2) | 88.2 (87.9 / 84.3) | 11.7 (9.2 / 8.8) |
| Diamond | 54.3 (50.7 / 50.4) | 89.7 (88.7 / 85.6) | 20.0 (15.7 / 16.5) |
| Ascendant | 59.3 (58.0 / 56.2) | 90.7 (90.7 / 87.2) | 28.3 (25.1 / 25.6) |

The upper medals land on the owner's targets (~50 / ~55 / ~60) for a newcomer; the two big authors see a little less
because their own (often strong) runs are excluded.

(Before the ranking change the same lobbies averaged Bronze 22.9, Silver 30.6, Gold 45.6, uncapped 48.0: Gold was
barely easier than uncapped.)

SQL parity on the real data: the live boards loaded into PGlite, both migrations and the backfill run: `pool_runs.strength`
equals the TS computation on **158 of 158** runs; the backfill took 386 ms, a full refresh 52 ms; the Bronze, Silver
and Gold samples return 46, 47 and 72 runs, the same as the TS count.

**Worth knowing.** The pool is mostly two authors, so every band is mostly LazerLemon and Orangez runs (Bronze: 17 +
17 + Rooks 6); fine for filling tables, thin for variety. The backfill file does not depend on the ranking (it only
writes each board's raw score; the ranks are derived), so it did not change.

## Owner runbook

1. **Refresh the backfill** so it covers every board uploaded up to now (read-only GETs; takes ~1 minute):
   `npm run strength -- fetch` then `npm run strength -- backfill`. This rewrites
   `supabase/backfill/2026-09-30-board-strength-backfill.sql` (the committed copy covers the pool as of 2026-09-30).
2. Supabase dashboard, SQL Editor, New query: paste all of `supabase/migrations/2026-09-30-board-strength.sql`, Run.
   Safe to re-run. It adds the columns, the refresh functions and triggers, the histogram RPC and the banded sample.
3. New query: paste all of `supabase/backfill/2026-09-30-board-strength-backfill.sql`, Run. Idempotent (fills only
   boards without a score).
4. Verify (read-only):

   ```sql
   select count(*) filter (where strength_raw is not null) as scored, count(*) as boards from public.boards;
   select count(*) as runs, count(*) filter (where strength is not null) as scored,
          min(strength), percentile_disc(0.5) within group (order by strength) as median, max(strength)
   from public.pool_runs where eligible;
   select count(*) from public.pool_runs_sample(300, 'set2', '0.1.0+', null, 'check', 0, 30);
   ```

   Expect about 1,856 scored boards, ~153 scored eligible runs, median near 50, and ~46 runs in the Bronze sample.
5. Anon check (any terminal; URL and anon key in `apps/web/.env`):

   ```sh
   curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/rpc/board_strength_histogram" \
     -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" -d '{"p_ref":"set2-v1"}' | head -c 300
   curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/rpc/run_strength_histogram" \
     -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" -d '{"p_set":"set2"}' | head -c 300
   ```

Nothing else. Deployed clients switch on by themselves: the pool fetch starts sending the band (it had dropped it for
the session while the RPC did not take one), uploads start filling the score columns (they fell back to the old
insert until then), and games start freezing a Board strength once the histogram answers.

Repair: `select public.pool_strength_refresh();` recomputes every run's strength (owner only).

## Where it lives

- Sim: `packages/sim/src/lobby/boardStrength.ts` (scoring, percentile, run average, run percentile), `strengthBands.ts` (bands,
  widening, seat estimate), `strengthReference.v1.json`, `runLobby.ts` (`LobbySeatOptions.strengthBand`,
  `poolAtStart.band`), `snapshotSeats.ts` (`PlayerRun.strength`), `matchDetails.ts` (`MatchSeat.strength`,
  `roundStrength`), `snapshot.ts` (`BoardSnapshot.runStrength`, stamped at pool load, never uploaded).
- UI: `packages/ui/src/boardStrength/` (the idle-slice scorer, the rank band), `opponentPool/poolFetch.ts` +
  `poolLoader.ts` (band, widening, feature detection, strength stamp), `remoteBoards.ts` (score columns, histogram,
  selects), `store.ts` (capture queue, run-end freeze), `Career.tsx`, `RecentGames.tsx`, `matchDetails/`.
- SQL: `supabase/migrations/2026-09-30-board-strength.sql` (appended to `schema.sql`), the backfill file.
- Tools: `npm run strength -- fetch | ref | backfill | measure` (`packages/tools/src/strength/`).
- Tests: `boardStrength.test.ts`, `boardStrength.db.test.ts` (PGlite), `strengthBands.test.ts`,
  `matchDetails.test.ts` (sim); `boardStrength/boardStrength.test.ts`, `boardStrength/runEndStrength.test.ts`,
  `Career.test.tsx`, `ladderPages.test.tsx`, `careerData.test.ts`, `matchDetails.test.tsx` (ui).
