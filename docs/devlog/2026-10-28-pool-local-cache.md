# 2026-10-28 — Supabase cleanup P1.5: the opponent pool cached on the device, by run

Owner ruling 2026-10-28 on the pool delta (scope doc §3.1a, open question 1): **"yes, cache them"**. Owner bar (2026-10-17,
R-LOBBY-08): snapshots served on exactly the right turn with exactly the recorded state, never reaching forward.

`pool_runs_sample` was ~2/3 of all API egress: up to 150 WHOLE runs (~24 KB each, ~3.45 MB a call) on every session start
and every between-runs refresh, ~13.4 GB in 16 days, plus ~13 GB of temp spill, for a pool of ~411 runs (9.9 MB total).

## What changed

- Migration **`supabase/migrations/2026-11-08-pool-runs-delta.sql`** (NOT applied; additive, idempotent, rollback block):
  - `pool_runs__pick(...)`: the picking block of `pool_runs_sample` (2026-10-17 body) VERBATIM, returning the ids.
  - `pool_run__rev(author, hero, seed)`: md5 of the run's servable board rows as `id:xmin` in serving order. `xmin` moves
    on every UPDATE, so any insert / update / delete of the run's boards moves `rev`.
  - `pool_runs_sample_keys(...)`: the same parameters and draw as the sample; rows carry `run_id`, strengths and `rev`,
    no boards.
  - `pool_runs_boards(p_ids)`: boards aggregated exactly as the sample does (same filter and order) + their `rev`, at
    most 300 ids, `work_mem` 16 MB.
  - `pool_runs_sample` is unchanged (older clients, and the fallback).
- Client `packages/ui/src/opponentPool/poolRunCache.ts`: `cachedSample` answers the pool fetch's `PoolApi.sample(args)`
  call: keys -> cache lookup by run key + rev -> `pool_runs_boards` for the rest (chunks of 100) -> rows in the keys
  order with fresh strengths. Cached boards are stored as the server's JSON text and parsed fresh per call (no shared
  objects). IndexedDB `ascent.poolruns`, at most 600 runs, LRU by `usedAt`, `POOL_RUN_CACHE_VERSION` drops everything.
  A server without the SQL answers "function not found" and the session calls `pool_runs_sample` as before. A failed
  read returns its error, so the loader's retry policy is unchanged. `fetchPoolRuns`, the loader, the last-good pool
  cache, registration and seat selection are untouched.
- `remoteBoards.ts poolApi` wires it; DEV `window.__ascentPoolCache` counts calls / hits / downloads / fallbacks.

## Proof of identical serving

- `packages/sim/src/lobby/poolRunsDelta.db.test.ts` (PGlite, the whole pool chain + this file, 40 runs incl. empty wave-1
  boards and a synthetic run): the picking block text equals the sample's; 45 seeded parameter sets (3 seeds x limits
  150 / 12 / 3, i.e. both the shuffle and the rejection branch, x plain / band / early weight / cap) give the same run
  keys in the same order with the same wave counts and strengths; `pool_runs_boards` boards are byte-identical
  (`jsonb::text`) to the sample's; `rev` moves on an update, a no-op update, an insert and a delete of THAT run only;
  >300 ids refused; idempotent.
- `packages/ui/src/opponentPool/poolRunCache.test.ts`: two worlds over the same server and draw sequence; 20 fetches
  (5 sessions x 4, plain and banded) with runs growing and being re-uploaded between calls: every answer JSON-identical
  to `pool_runs_sample`'s, and `fetchPoolRuns` (what registration + seat selection consume) identical with band
  widening; a moved rev re-downloads exactly those runs; callers mutating their boards never reach the cache; trimming
  keeps answers exact; wrong-version / wrong-rev records miss; missing SQL falls back for the session; errors propagate.

## Measured (fake server, 411 runs of 6-17 seven-minion boards, ~21.5 KB a run)

20 pool fetches on one device: `pool_runs_sample` **64.5 MB** -> keys 0.48 MB + boards 9.3 MB = **9.8 MB (-84.8%)**;
2,565 of 3,000 runs served from the cache. Once a device holds the pool, a fetch costs the keys (~24 KB for 150 runs)
plus only new or changed runs, instead of ~3.2 MB. Prod projection: ~13.4 GB / 16 days -> ~0.1-0.4 GB (each device
downloads each new run once). The temp spill goes with it (the boards read sorts per chunk in 16 MB).

Rule: R-EGRESS-05 (foundation). Lead: apply the migration (any time; the client works before and after). No Edge
Function redeploy. No patch note (nothing player-visible).
