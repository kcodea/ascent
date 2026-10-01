# 2026-09-29 · The opponent pool is made of whole runs, drawn at random

Owner asks (2026-09-29): "isnt it just replaying snapshots from the player's game?", then "build the full fix for
the snapshot issue. make sure this is firmly fixed and will be scalable and a non issue moving forward", then "i want
opponent snapshots to be completely random but i want them to be accurate. i dont want more recent boards to show up
just cause they are recent. i want them random from all snapshots in the pool", then "let's have a cap of 4 snapshots
from a player i guess, so it's not literally like 7 of me always or something". Rule: R-LOBBY-08. Follows
[2026-09-29-pool-snapshot-guard](2026-09-29-pool-snapshot-guard.md) (R-LOBBY-07, the symptom guard, kept).

## The root cause

The client downloaded the newest 120 boards PER WAVE and glued them back into runs. Early waves hold more boards than
late ones (every run has a wave 5, few reach wave 13), so an older run kept its late waves and lost its early ones,
and `boardAt` fell through to "the earliest board it has": a friend met a wave-10 board on round 5.

## What shipped

**Server (`supabase/migrations/2026-09-29-pool-whole-runs.sql`, appended to `schema.sql`).**

- `pool_runs`: one row per run (`author|hero|seed`, the client's run key), with its shape (distinct waves, first and
  last wave, largest hole, plausible tiers), its owner (`user_id`), set, build version and `eligible` (the R-LOBBY-07
  rule: 4+ waves, first at wave 1 or 2, at most one wave missing in a row, plausible tiers). Kept current by
  STATEMENT-level triggers on `boards` (one recompute per upload, since a run's boards arrive in one insert; also on
  delete and update). A trigger failure is caught and logged, so an upload is never lost to the index.
- `pool_runs_sample(p_limit, p_set, p_patch_prefix, p_exclude_user, p_seed)`: a uniform random sample of eligible
  runs, returned ONE ROW PER RUN with all of that run's boards as a jsonb array. A run is present whole or absent.
  At most 300 rows, so PostgREST's 1,000-row cap can never truncate it.

**Why the sample scales.** `pool_runs.id` is a dense bigserial. Each draw picks a uniform integer in the id range of the
eligible runs for the set and version (min/max from a partial index, two probes), looks it up by primary key, and keeps
it if it is eligible, matches, is not the caller's and was not already picked; otherwise it draws again. That is plain
rejection sampling, so the result is EXACTLY uniform without replacement, and every draw is O(log n) index work
whatever the pool size: no scan, no `order by random()`. A pool smaller than 4x the request is shuffled whole. The
cost of a sample is flat in pool size (the db test times 2,000 vs 200,000 runs). Rejections cost only time and are
capped at 64 draws per requested run; ids stay dense because a run row is inserted once, when its upload lands.
Re-running the migration's backfill (or `pool_runs_rebuild()`) burns ids through `on conflict`, which lowers the
density a little; the verification query below prints it.

Why this and not the alternatives: a random key column plus "next key >= r" picks each run with probability
proportional to the gap before it (not uniform, and the same runs cluster); `tablesample system_rows` samples pages,
not runs; `order by random()` sorts the whole table on every call. A materialised per-run view would need refreshing;
the trigger-maintained table is always current.

**Client.**

- `opponentPool/poolFetch.ts`: calls the RPC for `POOL_SAMPLE_RUNS` (150) runs. Feature-detected: if the RPC does not
  exist yet ("Could not find the function", PGRST202), it falls back for the rest of the session to a path that also
  only yields whole runs: list the pool's board identities (no snapshots, paged), group into runs, keep the eligible
  ones, sample 150 uniformly, then download those runs' boards BY RUN (`seed in (...)`, no per-wave or per-run limit).
  The fallback lists at most 20 pages (20,000 boards); past that it is a sample of the first 20,000 rows, which is
  fine as a stopgap and irrelevant once the SQL is run.
- `opponentPool/poolLoader.ts`: the unit is the run. Each delivered run is checked (`isWholeRun`: every board is the
  run's, has minions, and the distinct waves equal the server's count) and refused whole if not. Retry, timeout,
  background retry, `ensure()` and the lobby gate are unchanged in behaviour. The IndexedDB cache is now version 2:
  whole runs keyed by run key; the old per-wave record is ignored and overwritten. Telemetry `poolSource` records
  `rpc`, `fallback` or `cache`.
- `registerOpponentRuns` (sim): all-or-nothing per run. A run with one board this build cannot serve (a removed card)
  is refused whole instead of losing that wave.
- `boardAt` (sim): a seat's board for round N is its own wave-N board. One missing wave may borrow the previous board
  (an empty board is not uploaded); a run starting at wave 2 lends that board to round 1. Nothing further ahead, ever:
  a recording with nothing that early now serves an empty board rather than null (null made the lobby serve the
  FINAL board). Past the run's end the lobby's `repeatFinal` serves the final board (the owner's stale-final-board
  ruling), the only place a later board appears.
- Seat selection (`createRunLobby`): the seeded uniform shuffle is unchanged; a run whose player already holds
  `MAX_SEATS_PER_PLAYER` (4) seats is passed over for the next, and the player's own runs are skipped
  (`excludeOwnerId`, from the store). A player is their account id (stamped on the boards from `boards.user_id`),
  else their display name. When the pool lacks enough players, generated seats fill the rest.

**Rules.** The client's rule (`snapshotSeats.ts`) and the SQL agree; `poolRuns.db.test.ts` runs the migration in
PGlite and checks eligibility on every shape, the tier bound wave by wave, whole-run delivery on the 146/112 bug
shape, uniformity (per-run frequency and chi-square, both sampler paths), exclusion, flat cost, the triggers, the
idempotent backfill and the grants.

## Measured against the live pool (anon REST GETs only, 2026-09-29)

| | Old per-wave pull | New (fallback, live now) | New (RPC, after the SQL) |
|---|---|---|---|
| Requests | 17 | 7 | 1 |
| Payload (uncompressed JSON) | 2.73 MB | 3.24 MB | 2.59 MB (live boards run through the migration in PGlite) |
| Runs whole | 119 of 152 (33 cut or missing) | 147 of 147 fetched | 147 of 147 |
| `Orangez|soren|1129878061` | waves 10 to 17 | waves 2 to 17 | waves 2 to 17 |

147 of the 152 live runs are eligible, the same count in the SQL and in the client rule. No live board fails the tier
bound. The pool load stays off the render path (as before); the RPC is one request instead of seventeen.

With no per-player cap in the fetch (the owner asked for plain uniform randomness), a prolific player's share of the
pool equals their share of the runs: today LazerLemon 69 and Orangez 55 of 147. The seat cap of 4 is what keeps a
lobby varied.

## Owner runbook

1. Supabase dashboard, SQL Editor, New query: paste all of `supabase/migrations/2026-09-29-pool-whole-runs.sql`,
   Run. It creates `pool_runs`, the triggers and the RPC, and backfills from `boards`. Safe to re-run.
2. Verify (read-only), in the SQL Editor:

   ```sql
   select count(*) as runs, count(*) filter (where eligible) as eligible,
          count(*) filter (where not tiers_ok) as bad_tier,
          round(count(*)::numeric / nullif(max(id) - min(id) + 1, 0), 2) as id_density
   from public.pool_runs;
   select run_key, wave_count, jsonb_array_length(boards) as boards
   from public.pool_runs_sample(5, 'set2', '0.1.0+', null, 'check');
   ```

   Expect about 152 runs, 147 eligible, 0 bad_tier, density near 1.00, and 5 rows whose `boards` count is at least
   `wave_count`.
3. Confirm the anon key can call it (any terminal; the URL and anon key are in `apps/web/.env`):

   ```sh
   curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/rpc/pool_runs_sample" \
     -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" -d '{"p_limit":3,"p_set":"set2","p_patch_prefix":"0.1.0+"}' | head -c 300
   ```

   Before the SQL this answers `PGRST202` (the client then uses the fallback); after it, three runs with their boards.
4. Nothing else. Clients already deployed switch from the fallback to the RPC on their next pool load; no redeploy
   is needed for that.

Repair, if `pool_runs` is ever in doubt: `select public.pool_runs_rebuild();` (owner only; anon cannot call it).

## Open for the owner

- The per-player cap counts a player by account id, and falls back to the display name for boards without one.
  Two different accounts with the same display name and no id would share a cap (none in the live pool).
- "Your own runs never sit at your table" is new with this change (it was not a rule before). Tell me if solo testing
  against your own runs should stay possible.
- "The pool" is still scoped to the live set and the build version (`0.1.0+`), as the old fetch was.
