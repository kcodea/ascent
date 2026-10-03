# 2026-10-03 · Game strength is the final board, bands retuned, and no backend read is cut at 1,000 rows

Owner report (2026-10-03), on Rooks's Albus game (12-1, a final board of seven small minions) showing **Game strength
83**: *"that board in my mind should not even be close to an 83 unless that number is different from our snapshot
selecting board strength number?"* Owner decision after the audit: *"fix the bug, and make it so we never run into
similar situations like this and the client always downloads full game snapshots etc. also, i think we basically only
care about the final board strength as an indicator for matchmaking. can we try swapping out our algorithm for simply
caring about the snapshots final round board strength?"* Rules: **R-LOBBY-12** (new), **R-NET-01** (new), R-LOBBY-09
(amended). Follows [2026-09-30-board-strength.md](2026-09-30-board-strength.md) and
[2026-09-30-weighted-strength.md](2026-09-30-weighted-strength.md).

## What the audit found

- **The 83 was computed correctly, by the formula of the day.** Recomputed from the live data (anon reads) it matched
  the server exactly. Rooks's per-round percentiles were 48, 74, 93, 90, 82, 98, 93, 77, 73, 51, 27, 45 and **12** (the
  final board wins 17% of its reference fights). The groups gave 77, 85 and 34, so the weighted average was 61, and
  ranking 61 among the run averages (p75 57, p90 70) stretched it to 83. The per-board scorer agreed with the owner
  about that board; summing the run up over the whole game produced the 83.
- **Display and matchmaking are one formula, two copies.** Matchmaking reads `pool_runs.strength`, which the server
  computes. The display number is computed on the client when the game ends and then frozen. For Rooks both were 83.
- **A real bug: the client's strength histogram was cut at 1,000 rows.** `board_strength_histogram` returns one row
  per (wave, raw score): 1,070 rows. PostgREST's `max-rows` (1,000) cut it silently, so every client had wave 14 only
  up to raw 0.7 (its strongest boards missing) and no wave 15. A round-14 board scored too high (90 became 100 on an
  Orangez run), and round 15+ was dropped from the frozen number. Matchmaking was unaffected (the server computes it in SQL).
- **The same cap elsewhere.** The Hall own-game ledger (`lobby_fights`, `limit(2000)`), the per-author board list
  (`limit(2000)`), the board-record reads (`limit(10000)` and `limit(8000)`) and the Hall history read (`limit(2000)`)
  all asked for more than 1,000 rows and got 1,000. The pool fallback listing stopped at 20 pages. The per-user
  progression reads (cosmetics, titles, loadouts, crates, achievements, the catalogs) and the Gauntlet read had no bound
  at all. The tools' live-pool fetch asked for `limit=5000`.

## What shipped

1. **`fetchAllRows`** (`packages/ui/src/supabaseRows.ts`): pages a query with `.range()` until a short page. Pages are
   at most 1,000 rows. A failed page fails the whole read, so a partial table is never presented as whole. A
   deliberate `maxRows` is reported as `truncated`. Every unbounded list read now goes through it, with a stable
   order on a unique key.
2. **The guard** (`supabaseRows.guard.test.ts`): it scans every Supabase call in `packages/ui/src`, `apps/web/src`,
   `supabase/functions` and `packages/tools/src`. It fails on a list read that is not paged, not explicitly bounded at
   or below 1,000 (a `.limit` constant is resolved and checked), and not annotated `// rows: <why>`. It also fails on
   a REST `limit=` above 1,000.
3. **Run strength is the final board** (TS `runFinalStrengthOf` / `finalFromSum`, SQL `board_strength_final` in
   `pool_strength_refresh`). The run's latest scored board's percentile is used directly. It is not averaged and not
   ranked among runs. Two boards for that round are averaged (half up). An unscored last round falls back to the
   latest scored one. The same number drives the bands and the display. `strength_avg` keeps the weighted average as
   a diagnostic, and `run_strength_histogram` still answers for clients deployed before this change. The new client no
   longer fetches it.
4. **Wording.** The Game strength tip now reads: "How strong the final board was, compared with everyone else's boards
   at that round."

## Decisions I made (flag any to change)

- **Used directly, not re-ranked.** Ranking a round-6 death's final board against runs that reached round 15 mixes
  scales. The direct number means one thing everywhere: "beat N% of the boards seen at that round".
- **Band thresholds retuned by the owner** (same day, below): *"make gold 15-65, platinum 15-100, diamond 25-100, and
  ascendant 35-100"*. Bronze 0-30 and Silver 10-40 are unchanged. The bands live only in TS (`STRENGTH_BANDS`): the
  client sends the band to `pool_runs_sample` as `p_strength_min` / `p_strength_max`, so no SQL changes for them.
- **Old frozen numbers stay.** Match history rows keep the number they were frozen with.

## Live pool, before and after (anon reads, `npm run strength -- measure`, 170 eligible set-2 runs)

Final-board strength: min 1, p10 4, p25 13, **median 32**, p75 62, p90 79, max 99. Runs per decile: 33 36 13 17 17 10
16 15 6 7. Final boards sit low because a run usually ends on the board that lost.

| Run | Before (weighted, ranked) | After (final board) |
|---|---|---|
| Rooks / Albus (13 rounds) | 82-83 | **12** |
| Orangez / Drakko 932453328 (15) | 98 | 98 |
| Orangez / Keshi 129045060 (14) | 87 | 84 |
| Orangez / Gildmaster (14) | 89 | 49 |
| Orangez / Indy (16) | 92 | 67 |

With the OLD thresholds (Bronze 0-30, Silver 10-40, Gold 20-65, Platinum uncapped, Diamond 10-100, Ascendant
20-100), final-board strength gave mean seats of 12.3, 22.1, 41.2, **37.3**, 45.2 and 55.1, so Platinum averaged below
Gold. I proposed raising the upper floors. The owner picked: **Gold 15-65, Platinum 15-100, Diamond 25-100, Ascendant
35-100**.

Final bands on the live pool (170 eligible runs, final-board strength, 200 simulated lobbies per medal):

| Band | Runs in band | Players | Fillable seats (4-cap) | Mean seat | Strongest / weakest seat | Widenings |
|---|---|---|---|---|---|---|
| Bronze 0-30 | 82 | 10 | 24 | 12.3 | 23.5 / 2.4 | 0 of 200 |
| Silver 10-40 | 68 | 7 | 17 | 22.1 | 35.3 / 12.1 | 0 of 200 |
| Gold 15-65 | 87 | 7 | 17 | 36.2 | 58.2 / 17.5 | 0 of 200 |
| Platinum 15-100 | 123 | 8 | 19 | 49.4 | 83.3 / 19.7 | 0 of 200 |
| Diamond 25-100 | 95 | 7 | 15 | 58.2 | 86.7 / 32.6 | 0 of 200 |
| Ascendant 35-100 | 83 | 7 | 14 | 61.8 | 88.1 / 38.6 | 0 of 200 |

The ladder is monotone again, and every band fills a table with no widening and no generated seats. Widening steps:
Gold 15-65, 5-75, 0-85, 0-95, uncapped. Platinum 15-100, 5-100, uncapped. Diamond 25-100, 15-100, 5-100, uncapped.
Ascendant 35-100, 25-100, 15-100, 5-100, uncapped.

## Owner runbook

1. Supabase dashboard, SQL Editor, New query: paste all of `supabase/migrations/2026-10-03-final-board-strength.sql`,
   Run (after the two 2026-09-30 strength migrations). It takes the `pool_runs` and `boards` locks, replaces
   `pool_strength_refresh`, adds `board_strength_final`, and recomputes every run once. Idempotent. The same block is
   appended to `schema.sql`.
2. Verify (read-only):

   ```sql
   select strength, strength_avg from public.pool_runs where author = 'Rooks' and seed = 1018031655; -- expect ~12 / 61
   select count(*) filter (where strength <= 30) as bronze, count(*) filter (where strength between 20 and 65) as gold,
          percentile_disc(0.5) within group (order by strength) as median
   from public.pool_runs where eligible and set_id = 'set2';                                         -- expect ~82 / ~69 / ~32
   -- (that `gold` column counts the old 20-65 window; the new Gold band 15-65 holds ~87)
   ```

3. No Edge Function deploy is needed (only comments changed there). Ship a fresh web build so players get the paged
   histogram and the final-board freeze; until then old clients keep freezing the old formula on their own games.

## Where it lives

- `packages/ui/src/supabaseRows.ts` (+ `.guard.test.ts`), `remoteBoards.ts`, `progression/progressionRemote.ts`,
  `gauntlet/gauntletRemote.ts`, `opponentPool/poolFetch.ts`, `store.ts`, `matchDetails/matchDetailsText.ts`.
- `packages/sim/src/lobby/boardStrength.ts` (+ tests, PGlite parity on the live pool).
- `supabase/migrations/2026-10-03-final-board-strength.sql`, `schema.sql`.
- `packages/tools/src/strength/cli.ts` (measure prints before and after), `livePool.ts` (paged).
