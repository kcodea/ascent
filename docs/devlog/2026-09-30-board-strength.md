# 2026-09-30 · Board strength: a 1-100 percentile, rank bands, and the number in match history

Owner design (2026-09-30), agreed in chat: *"can we build an algorithm for board strength to get as good of an idea of
how strong a snapshot's run is, and assign it a 1-100 value? we can probably get an 'average' strength to measure
against as well, and then serve for example 0-30 for bronze, 10-40 in silver, 20-65 in gold, and then uncap plat?"*,
*"can we show that score to the player too maybe? like maybe that is shown in match history?"*, *"72 would basically
mean like... a 72/100 aka 72nd percentile"*. Not now: a separate Ancients / Platinum+ pool (*"dont worry about the
ancients and plat separation just yet ... keep it all in the same bracket"*), but the selection takes a pool id so a
second pool is a small change later. Rule: **R-LOBBY-09**.

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
3. **Run strength.** The average of the run's per-board percentiles, rounded (`pool_runs.strength`). Refreshed for the
   uploaded runs on every scored upload, and for every run whenever the oldest stamp is over 10 minutes old.
4. **Bands.** Bronze 0-30, Silver 10-40, Gold 20-65, Platinum and above uncapped; every division of a medal shares the
   medal's band (`STRENGTH_BANDS`, `strengthBandForDivision`). RATED lobbies only; Practice and the tutorial have no
   band. Inside the band: the same uniform seeded shuffle, whole runs, at most 4 seats per player, never your own runs.
5. **Unscored runs** (no score yet, not backfilled) are **inside every band**. Before the SQL and the backfill nothing
   is scored, so selection is exactly R-LOBBY-08's, seat for seat (pinned by a test).
6. **Widening.** When a band cannot fill the table it widens by 10 on each capped side, one step at a time (Bronze
   0-30, 0-40, ... 0-90, uncapped; Gold 20-65, 10-75, 0-85, 0-95, uncapped). Two places widen: the pool FETCH (the
   server sample is asked again with the wider band while the runs it holds cannot seat 7 under the 4-per-player
   cap) and SEAT SELECTION (a second pass over the same shuffle with the wider band; runs considered once are never
   reconsidered, so every run keeps its equal chance inside each step). Only after the band is uncapped do generated
   seats fill the rest. Both are logged: `lobbyPool.strengthBand`, `strengthBandUsed`, `bandWidenings`,
   `poolFetchWidenings` in the lobby telemetry row.
7. **Showing it.** Career rows and Recent Games rows print **"Board strength 72"**; Match details shows it per seat
   (each opponent's run strength, as the pool delivered it) and your own strength by round. The number is FROZEN
   when the game ends: `run_history.entry.boardStrength`, `replay.v2.result.boardStrength`, and the Match details
   seats. A game that was not scored shows nothing (no placeholder).

## Decisions I made (flag any to change)

- **The player's own percentile is computed on the client**, from the server's histogram
  (`board_strength_histogram`, fetched at startup and between runs), with the fresh board counted as if already in
  the pool. That is what lets the number be frozen in the history row at insert time: `run_history` is insert-only
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
- **Population.** Every board with a score (both copies agree): only boards with minions are ever scored, and
  synthetic boards never, so the count is an index-only scan and never reads a snapshot.
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

Run strength (153 eligible runs, all scored): min 9, p10 30, p25 38, **median 48**, p75 59, p90 68, max 83. Per
decile (1-10 ... 91-100): 1, 6, 13, 27, 38, 35, 20, 11, 2, 0. Raw win rates spread well inside every wave (p10 ~0.13,
median ~0.5, p90 ~0.86; 24 to 88 distinct values per wave).

| Band | Runs in band | Players | Seats it can fill (4-cap) | Widening needed |
|---|---|---|---|---|
| Bronze 0-30 | 20 | 7 (LazerLemon 8, Orangez 5, Rooks 4, 3 others 1 each) | 16 | never |
| Silver 10-40 | 46 | 9 | 22 | never |
| Gold 20-65 | 126 | 9 | 25 | never |
| Platinum+ (uncapped) | 153 | 10 | 28 | n/a |

Real lobbies (`createRunLobby` over the live pool with every run's strength stamped, 200 lobbies per medal, as a
newcomer, as LazerLemon and as Orangez with their own runs excluded): **0 widenings and 0 generated seats in every
case**. Mean strength of the seated runs: Bronze 22.9, Silver 30.6, Gold 45.6, uncapped 48.0 (newcomer).

SQL parity on the real data: the live boards loaded into PGlite, both migrations and the backfill run: `pool_runs.strength`
equals the TS computation on **158 of 158** runs; the backfill took 254 ms, a full refresh 29 ms; a Bronze sample
returns the same 20 runs.

**Two things to look at.** (1) An average of per-wave percentiles pulls toward 50 (a run is rarely weakest in every
round), so run strengths spread 9-83, not 1-100: the Bronze band holds 13% of runs, not 30%, and **the Gold band
(20-65) holds 82% of runs**, so Gold lobbies are barely easier than uncapped ones today (45.6 vs 48.0). If you want
the bands to cut the pool in the proportions their numbers suggest, the fix is to rank the run averages into a
percentile among runs; one line in SQL and TS. (2) The pool is mostly two authors, so Bronze is 8 LazerLemon + 5
Orangez + 4 Rooks runs; fine for filling tables, thin for variety.

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

   Expect about 1,856 scored boards, ~153 scored eligible runs, median near 48, and ~20 runs in the Bronze sample.
5. Anon check (any terminal; URL and anon key in `apps/web/.env`):

   ```sh
   curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/rpc/board_strength_histogram" \
     -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" -d '{"p_ref":"set2-v1"}' | head -c 300
   ```

Nothing else. Deployed clients switch on by themselves: the pool fetch starts sending the band (it had dropped it for
the session while the RPC did not take one), uploads start filling the score columns (they fell back to the old
insert until then), and games start freezing a Board strength once the histogram answers.

Repair: `select public.pool_strength_refresh();` recomputes every run's strength (owner only).

## Where it lives

- Sim: `packages/sim/src/lobby/boardStrength.ts` (scoring, percentile, run strength), `strengthBands.ts` (bands,
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
