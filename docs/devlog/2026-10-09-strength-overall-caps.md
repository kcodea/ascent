# 2026-10-09 · Overall strength caps per medal (R-LOBBY-15)

Owner ask (2026-10-09), verbatim: *"we want to add overall board strength caps on TOP of the existing early rating
strength matching. if a boards overall strength is over 40, it should n ever be in bronze. if a boards overall stength
is over 60 it should never be in silver. if a boards overall strength is over 75 it should never be in gold. from
there, theres no additional cap"*.

## The rule

- "Overall strength" = the run's WEIGHTED strength (`pool_runs.strength`, the "Game strength" number; R-LOBBY-12), not
  the early / late blend of R-LOBBY-13.
- A recorded run is eligible for a medal's lobby only if BOTH hold: it passes the medal's early / late band
  (unchanged: Bronze w 1.0, 0-20 · Silver w 0.8, 10-30 · Gold w 0.6, 10-50), AND its overall strength is at or under
  the medal's cap: **Bronze 40 · Silver 60 · Gold 75**. "Over 40" is excluded, so exactly 40 is in.
- Platinum, Diamond, Ascendant: no cap, no band (unchanged). Practice / tutorial: nothing (unchanged).
- **Hard caps.** The widening (+10 per capped side when a band cannot fill the table) widens ONLY the early / late band.
  The cap never widens; a capped band's last widening step is the cap alone. If the table still cannot fill, generated
  seats fill the rest exactly as before.
- A run with no overall strength yet (unscored) stays eligible ("unscored runs are in every band").

## What changed

- **`packages/sim/src/lobby/strengthBands.ts`**: `StrengthBand.overallCap`; `STRENGTH_BANDS` Bronze/Silver/Gold carry
  40/60/75; `runUnderOverallCap(run, band)` (the cap check: weighted `strength` <= cap, unscored passes);
  `runInStrengthBand` requires it before the early / late check. `widenBand` carries the cap and, for a capped band,
  stops at `{ min: 0, max: 100, earlyWeight, overallCap }` instead of null; `bandSteps` never lists a null after a
  capped band. `sameBand` compares the cap (so a band cached before today refetches). `bandVersionLabel` adds `/cN`:
  `STRENGTH_BANDS_VERSION` = `B0-20/e100/c40 S10-30/e80/c60 G10-50/e60/c75 P* D* A*`.
- **Seat selection** (`runLobby.ts createRunLobby`) is unchanged in shape: it already walks `bandSteps` and filters with
  `runInStrengthBand`, so the cap now holds at every step. The telemetry band labels keep their `min-max` form (the
  last capped step reads `0-100`, not `uncapped`), so `bronzeBandOf` / medal inference keep working.
- **Pool fetch** (`ui/src/opponentPool/poolFetch.ts`): a capped band also sends `p_strength_cap`. The seat estimate that
  decides whether to widen counts only delivered runs under the cap.
- **SQL**: new `supabase/migrations/2026-10-09-strength-overall-caps.sql` (appended verbatim to `schema.sql`):
  `pool_runs_sample` gains `p_strength_cap numeric default null` (null = no cap) and drops runs with
  `strength > p_strength_cap` (a null strength passes). Drops the 9-argument (and any 8-argument) signature and creates
  the 10-argument one in ONE transaction with the 2026-10-06 locking pattern (both pool tables, access exclusive),
  re-grants execute to anon / authenticated. Idempotent; no column, no recompute.
- **Balance Report**: new era `bandsCapped` (`CAPS_AT`, approximate) with `BANDS_V4`; the tripwire expects
  `[BANDS_V4, 'earlyLate']`.
- **`npm run strength -- measure`** prints an OVERALL CAPS block: per medal, the split band without the cap -> with it
  (runs / players / seats under the 4-per-player cap), the widening needed to seat 7, and the overall strengths removed.
- Rules: **R-LOBBY-15** (new); R-LOBBY-09, R-LOBBY-12 and R-LOBBY-13 amended to mention the cap. GAME-RULES band table,
  the ascent-lobby skill, and a 2026-10-09 patch note.

## Before the owner runs the SQL (fallback)

The live RPC does not know `p_strength_cap`, so PostgREST answers "function not found" (PGRST202). `fetchPoolRuns` sets
`session.capsMissing` and re-asks for the SAME band (min / max / early weight) without the cap, and never sends it again
that session. The cap still holds, client-side: every sample row carries its `strength`, the loader stamps it on each
board as `runStrength`, and seat selection's `runInStrengthBand` refuses a run over the cap at every widening step. The
widening decision counts only under-cap runs, so a sample padded with over-cap runs still widens. Net effect before the
SQL: identical seats; the server just also sends a few runs the client then ignores. Clients deployed BEFORE this
change keep working against the new SQL: they never send a cap, and without one the sample is the 2026-10-06 one.

## Live-pool numbers (anon reads only, 2026-10-09)

Coordinator's check (anon read of `pool_runs.strength` / `strength_early` / `strength_late`, 208 eligible scored runs):

| Medal | Band runs without cap -> with cap | Seatable (cap 4/player) | Overall strengths removed |
|---|---|---|---|
| Bronze | 41 -> 36 | 18 | 75, 60, 59, 53, 44 |
| Silver | 38 -> 37 | 17 | 75 |
| Gold | 93 -> 91 | 22 | 77, 77 |

`npm run strength -- fetch && npm run strength -- measure` in this PR (220 runs, 2,693 boards; 212 eligible, scored
locally against the frozen reference, so it differs slightly from the server's stored numbers):

| Medal | Runs without cap -> with cap | Players | Seats (cap 4) | Widenings to seat 7 | Overall strengths removed |
|---|---|---|---|---|---|
| Bronze (c40) | 44 -> 38 | 9 -> 9 | 20 -> 20 | 0 | 77, 75, 60, 60, 53, 43 |
| Silver (c60) | 39 -> 38 | 6 -> 6 | 17 -> 17 | 0 | 75 |
| Gold (c75) | 97 -> 95 | 7 -> 7 | 21 -> 21 | 0 | 77, 77 |
| Platinum / Diamond / Ascendant | 212 -> 212 | 10 | 28 | 0 | none |

200 simulated lobbies per medal on the live pool: no widening and no generated seat in any medal; strongest seat on
average Bronze 29.1, Silver 42.6, Gold 55.1 (overall strength). No band needs to widen.

## Owner action

**Run `supabase/migrations/2026-10-09-strength-overall-caps.sql` in the Supabase SQL Editor** (paste, Run). Idempotent;
takes both pool tables in one transaction. Run it after 2026-10-06-early-late-strength.sql.

Check after running: `select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'pool_runs_sample';`
(one row, ending in `p_early_weight numeric, p_strength_cap numeric`).

## Verification

- `strengthBands.test.ts`: the table and version string; the cap boundary (40 in, 40.1 and 41 out; 60 / 60.1; 75 / 76);
  unscored passes; widening keeps the cap and ends on the cap alone; seat selection never seats an over-cap run through
  eight widenings (generated seats fill); Platinum uncapped; runs delivered by a pre-SQL server are refused client-side.
- `boardStrength.test.ts` (ui): the medal bands carry their caps; `p_strength_cap` sent on every widening step; the
  pre-SQL fallback drops only the cap, keeps the strengths, counts only under-cap runs for widening; end to end, a
  server without the cap + the real loader + a Bronze lobby never seats a run over 40.
- `boardStrength.db.test.ts` (PGlite, every migration in order incl. the new one): `pool_runs_sample` with the cap
  equals the TS `runInStrengthBand` for every capped band and widening step, on both the small-pool and the
  rejection-sampling paths; 40 / 40.1, 60 / 60.5, 75 / 75.5 boundaries; no cap = the 2026-10-06 sample; old call shapes
  still resolve; idempotent, one `pool_runs_sample` after re-runs.
- `reportSources.test.ts`: the new era.
