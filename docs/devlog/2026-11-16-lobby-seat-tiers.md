# 2026-11-16 — Seating: two per player (three when short), two 90+ and two 80s per table

Owner asks from the snapshot deep dive (Mike, 2026-11-16), built as their own PR because they do not depend on the
strength v2 work (`docs/superpowers/specs/2026-11-16-strength-v2-design.md`).

## What changed (`packages/sim/src/lobby`)

- **R-LOBBY-16.** `MAX_SEATS_PER_PLAYER` is 2 (was 4), your own runs included. `MAX_SEATS_PER_PLAYER_SHORT` is 3:
  `seatRunLobby` walks each band step at two per player, then again at three, before the band widens and before
  any generated seat. A run passed over only for the two-seat cap stays a candidate for the second walk; nothing
  else is reconsidered, so the draw stays an unweighted shuffle. `seatableRuns` (the pool fetch's widen check)
  counts three per player so the fetch never widens sooner than seat selection would.
- **R-LOBBY-17.** `STRENGTH_TIER_LIMITS`: at most two seated runs with `pool_runs.strength` 90-100 and two with
  80-89, hard (generated seats fill the rest). It runs on every table; the Bronze / Silver / Gold overall caps
  already exclude those runs, so it binds from Platinum up and in Practice on Platinum or All Ranks. The same rule
  pins that Platinum, Diamond and Ascendant have no band: no rank leans strong.

## Why the third seat exists

The live pool (250 runs, 2026-11-16) comes from 4 accounts with many runs and one with a single run. Two each is 8
recorded seats at best, and a Bronze or Silver band often holds only three or four accounts, so a strict cap of 2
would have put generated seats into ordinary tables.

## Not changed

- Ranked Duos seating (`versus/rankedDuosSeating.ts`): it already caps a player at 2 of the six served seats and
  does not apply the tier limits. Owner call if it should.
- Saved lobbies keep their seats (selection only runs when a table is created).
- Two older tests assumed a table could hold seven top-strength runs; they now use two (the new maximum).

## Verified

`npx vitest run packages/sim/src/lobby packages/sim/src/versus` (704 tests) plus the full gates in the PR.
