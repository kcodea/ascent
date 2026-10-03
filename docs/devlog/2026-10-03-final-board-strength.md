# 2026-10-03 · Game strength is the final board, and no backend read is cut at 1,000 rows

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
- **Band thresholds unchanged** (Bronze 0-30, Silver 10-40, Gold 20-65, Platinum uncapped, Diamond 10-100, Ascendant
  20-100). On the live pool this inverts Gold and Platinum (below). A change is proposed, not made.
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

| Band | Runs before | Runs after | Mean seat after (200 lobbies) |
|---|---|---|---|
| Bronze 0-30 | 50 | 82 | 12.3 |
| Silver 10-40 | 57 | 68 | 22.1 |
| Gold 20-65 | 78 | 69 | 41.2 |
| Platinum uncapped | 170 | 170 | **37.3** |
| Diamond 10-100 | 158 | 139 | 45.2 |
| Ascendant 20-100 | 137 | 105 | 55.1 |

No band needs widening (0 widenings, 0 generated seats, every medal). **Platinum now averages below Gold.** Proposed
for the owner:

- **B (recommended): raise the upper floors.** Platinum 15-100, Diamond 25-100, Ascendant 35-100; Bronze, Silver and
  Gold unchanged. On the live pool the upper medals then average about 49, 58 and 63, close to the owner's "~50, ~55,
  ~60" of 2026-09-30, and the ladder is monotone again.
- **A: map every threshold by share** (each band keeps the share of runs it had). Bronze 0-15, Silver 4-20, Gold
  12-46, Platinum uncapped, Diamond 4-100, Ascendant 12-100. This gives the same table mix as before, but the numbers
  stop meaning what the owner set them to mean.

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
   ```

3. No Edge Function deploy is needed (only comments changed there). Ship a fresh web build so players get the paged
   histogram and the final-board freeze; until then old clients keep freezing the old formula on their own games.

## Where it lives

- `packages/ui/src/supabaseRows.ts` (+ `.guard.test.ts`), `remoteBoards.ts`, `progression/progressionRemote.ts`,
  `gauntlet/gauntletRemote.ts`, `opponentPool/poolFetch.ts`, `store.ts`, `matchDetails/matchDetailsText.ts`.
- `packages/sim/src/lobby/boardStrength.ts` (+ tests, PGlite parity on the live pool).
- `supabase/migrations/2026-10-03-final-board-strength.sql`, `schema.sql`.
- `packages/tools/src/strength/cli.ts` (measure prints before and after), `livePool.ts` (paged).
