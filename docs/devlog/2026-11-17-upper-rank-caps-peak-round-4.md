# Platinum 80 and Diamond 90 caps; the peak counts from round 4 (2026-11-17)

Two owner rulings, made the same afternoon the strength v2 and peak cap SQL went live. Rules R-LOBBY-22 (new) and
R-LOBBY-21 (amended).

## 1. Platinum and Diamond get an overall cap (R-LOBBY-22)

Mike: "i want to make some differentiation between plat diamond and ascendant. can we cap game strength boards in plat
to 80, and diamond boards to 90? then ascendant is fully open?" Asked whether that reads a run's overall Game strength
or its best board: "Game strength (overall cap)".

Since 2026-10-06 the three top medals drew from the whole pool, so climbing from Platinum to Ascendant did not change
who you met. Now:

| Medal | Band | Overall cap | Peak cap |
|---|---|---|---|
| Platinum | none | 80 | none |
| Diamond | none | 90 | none |
| Ascendant | none (no band at all) | none | none |

- `STRENGTH_BANDS.Platinum = { min: 0, max: 100, overallCap: 80 }`, Diamond the same with 90. No early weight, so the
  band reads the weighted strength, and min..max is fully open: only the cap filters.
- **No SQL and no Worker change.** The draw already takes `p_strength_cap`, the hub ports it, and seat selection
  re-checks the cap on every delivered run.
- `STRENGTH_BANDS_VERSION` ends `P0-100/c80 D0-100/c90 A*`; the Balance Report has a new era, `bandsUpperCaps`.
- Practice set to Platinum carries the cap (it reads the ranked table).

Consequences worth knowing:

- **A capped medal is a band, so unscored runs are no longer met in Platinum or Diamond** (R-LOBBY-20), only in
  Ascendant. Nobody asked for this by name; it follows from how a band works.
- **A cap alone has nothing to widen.** A Platinum table the capped runs cannot fill takes generated seats.
- **Not measured.** On the live window of 2026-11-17 (250 runs, 5 players, 2 seats per player) a cap of 80 keeps
  roughly 200 runs and a cap of 90 roughly 225, by the definition of a percentile; how many SEATS that leaves each
  medal depends on whose runs they are and was not measured. `npm run strength -- measure --v2` prints it once the
  band table is on main. Note the tool counts seats at 3 per player; the game seats 2 (3 only on a short table).
- The limit of two runs in the 80s and two in the 90s per table (R-LOBBY-17) still holds. In Platinum only runs at
  exactly 80 are left in those tiers.

## 2. The peak counts from round 4 (R-LOBBY-21 amended)

Mike: "best board should not include win rates for boards on rounds 1, 2, or 3". The peak (a run's best real board,
which the cap of 90 on Bronze, Silver and Gold reads) counted from round 3; it now counts from round 4.

- `PEAK_FROM_ROUND = 4` in `packages/sim/src/lobby/strengthV2.ts` (`runPeakOf`, and the tools through it).
- `supabase/migrations/2026-11-25-strength-peak-from-round-4.sql`: `pool_strength_refresh` with that one number
  changed (the rest is a copy of the 2026-11-24 function), then a refresh so every live run's peak is rewritten.
  `strengthPeak.db.test.ts` holds the database equal to `runPeakOf` and covers a run whose only boards above 90 are
  on rounds 2 and 3.
- The client never computes a peak for seating; it re-checks the cap on the peak the server delivers. So the rule
  changes when the SQL is applied, not when the client ships, and the two can go in either order.

**Re-apply hazard:** re-applying `2026-11-24-strength-peak-cap.sql` alone puts the round-3 refresh back. Re-apply
the 2026-11-25 file straight after it. (And, as before, never re-apply 11-08, 11-22, 11-23 or
`strength-v2-apply.sql` on their own.)

## Rollout (Mike or Kevin)

1. Apply `supabase/migrations/2026-11-25-strength-peak-from-round-4.sql` (SQL editor or `npm run db:apply`).
2. `npm run strength -- measure --v2` on main: check the seats each medal keeps, Platinum and Diamond included.
3. "Ship Ascent": the Platinum and Diamond caps travel with the client and hub.

## Not verified

- Nothing here is applied to the live database or shipped.
- The seats a Platinum or Diamond table keeps under its cap (see above).
- Not looked at in the running game.
