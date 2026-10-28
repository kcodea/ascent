# 2026-10-28 — Supabase cleanup P1.4: board_results archived, never read

Owner ruling 2026-10-28 on `board_results` (scope doc §3.1d, open question 2): **"archive and stop reading it"**.

The table is the retired course mode's per-board fight ledger. Nothing has written it since 2026-10-14 (R-LEDGER-01), yet
every boot and every run end still read it (`fetchAndRegisterBoardRecords`: up to 8,000 rows, ~250 KB on a cold cache,
16,458 seq scans in 16 days because `created_at` has no index) to weight the course-mode `pickOpponent`, which no live
mode fights.

## What changed

- `remoteBoards.ts`: removed `fetchAndRegisterBoardRecords` (boot + between-runs), and the dead `fetchBoardStats` /
  `fetchPlayerRoundBoards` (no callers) with their tally helpers. `refreshOpponentPoolAndRecords` keeps its name (many
  test mocks use it) and now refreshes the pool + histogram only. The IndexedDB window the old read kept
  (`boardResults` in the `ascent.netcache` IndexedDB) is deleted once per session (`kvDel`, new in `net/idbKv.ts`).
- `store.ts`: the startup read is gone.
- `@game/sim` is untouched: `registerBoardRecords` still exists; with nothing registered the weighting sits at the
  neutral prior (same rng draw count). No lobby / Versus serving path reads it.
- `scripts/supabase/export-board-results.mjs` (`npm run db:export:board-results`): READ-ONLY. One SELECT through the
  Supabase CLI (`db query --linked -o json`) that returns the whole table as one json value plus the server's own row
  count, max id and md5 of that value; the script verifies all three and writes `exports/board_results-<date>.json` and
  `.csv` (`exports/` is gitignored). `--input <file>` parses a saved answer offline (used to test it).
- `docs/board-backend.md` marks the win-tracking section archived; R-NET-CACHE-01 notes its board-results half is gone.

## Measured

Before: one `board_results` read at boot + one per run end (cold: up to 8,000 rows / ~250 KB; warm: an incremental
`id > max` page). After: **0 requests, 0 bytes** (`boardResultsArchived.test.ts`: no source queries the table; the
startup pool fetch and the refresh send no request to it). Prod 16-day figure avoided: ~0.8 GB and ~16.5k seq scans.

Rule: R-EGRESS-04 (persistence). No migration (dropping the table is a later phase, after the export). No patch note.
