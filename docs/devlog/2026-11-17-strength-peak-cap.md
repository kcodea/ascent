# 2026-11-17: the peak cap (strength v2, Plan 3 of 3)

Plan: `docs/superpowers/plans/2026-11-16-strength-v2-peak-cap.md`. Design:
`docs/superpowers/specs/2026-11-16-strength-v2-design.md`, section 6.C and ruling 2 (Mike 2026-11-16: "90 for
all"). Branch `feat/strength-v2-peak-cap`, stacked on `feat/strength-v2-scoring` (Plan 2). Rule: R-LOBBY-21.

## What it does

A Bronze, Silver or Gold table never seats a recorded run whose best board from round 3 on ranks above 90, however
ordinary the rest of that game was. One runaway board is what a new player remembers.

- **The peak** is a per-run number, `pool_runs.strength_peak`: the highest percentile among the run's real boards
  from round 3 on. `pool_strength_refresh` writes it from the same per-round percentiles as the other ratings;
  `runPeakOf` is the TypeScript definition and `strengthPeak.db.test.ts` holds the two equal.
- **The cap** is `StrengthBand.peakCap` (90 on Bronze, Silver, Gold). It behaves like the overall cap: sent to the
  server draw (`p_peak_cap`), ported to the hub's draw, re-checked at seat selection, and never widened away.
- **Practice** set to one of those ranks inherits it. **Ranked Duos**: solo runs at a Duos table are capped at seat
  selection; recorded duo teams are never scored and have no peak.

## Decisions made while building (each departs from, or adds to, the plan)

1. **A run delivered without a peak is let through** (the plan said: refused). Once the SQL is applied every scored
   run has a peak, and unscored runs are already out by the strength check. A missing peak therefore means the row
   came from a server, hub or cache from before the SQL, where no run has one. Refusing those would fill every
   Bronze, Silver and Gold table with generated seats if the client shipped before the SQL. Cost: until the SQL is
   applied the cap is not applied at all.
2. **The hub does the same on an index synced before the SQL**: no row has a peak, so it ignores `p_peak_cap` and
   its keys rows carry no peak, as that database would answer. After the SQL it matches the database exactly
   (`sessionCf.db.test.ts`, 81 parameter sets).
3. **`cachedSample` hands a "function not found" back when the call carried `p_peak_cap`** instead of deciding
   the keys read is missing. Otherwise a client on a server without the peak SQL would fall back to the 3 MB
   whole-run sample for the rest of the session.
4. **Ranked Duos does not send the cap to its solo draw** (`versus_cf_ranked` is unchanged). The solo rows carry
   their peak and the cap holds at seat selection. Cost: a Duos solo sample may hold a few over-cap runs that are
   passed over.
5. **`ops.pool_digest` passes `p_peak_cap` to the draw but reports no per-medal count** of runs over 90 (the plan
   asked for one). The band table lives only in TypeScript; copying it into SQL would be a second source of truth.
   `npm run strength -- measure --v2` reports it.
6. **The three older ten-argument signatures of the draw are dropped** in the migration. Two overloads would make an
   older client's ten-argument call ambiguous; with one signature it resolves through the default.
7. **A new report era, `bandsPeakCap`**, because the band version string changed (`/p90`).
8. **`schema.sql` is not appended**, as for the two migrations before it.

## Found on the way: a Plan 2 defect (fixed on the Plan 2 branch)

Plan 2 made an unscored run fall outside every band and applied that to Ranked Duos' recorded duo teams as well.
Duo teams are never scored, so every Bronze, Silver and Gold Duos table would have filled with solo pairs and
generated seats. The design's non-goals keep duo teams on the old rule. `duoRunInStrengthBand` restores it
(`rankedDuos.test.ts`); R-LOBBY-20 now states the exception. Never shipped.

## Not verified

- Nothing is applied to the live database and nothing is shipped.
- The count of runs each medal keeps under the cap was measured on 2026-11-16 (38 Bronze, 51 Silver, 83 Gold); it
  has not been re-measured since.

## Rollout (owners), after Plan 2's rollout or together with it

1. Apply `supabase/migrations/2026-11-24-strength-peak-cap.sql` (after `2026-11-23-strength-v2.sql`). It re-rates
   the pool itself, so every live run gets its peak.
2. `npm run strength -- measure --v2`: confirm each medal still seats 7 under the cap.
3. "Ship Ascent" (Mike or Kevin). An older client or hub does not send or apply the cap; nothing breaks.
