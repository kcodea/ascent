# 2026-11-19: Gildmaster and Cindy x Death carry over; Cassen x Death is Avenge (5)

Owner decision after #2793 made every hero Avenge (N) per combat:

- **Gildmaster x Death**: "When 17 friendly minions die, get a Goldcrafter." (was Avenge (17)).
- **Cindy x Death**: "When 15 friendly minions die, give your teammate a Goldcrafter." (was Avenge (15)).
- **Cassen x Death**: Avenge (5) (was 7), still per combat.

Oracle: R-ANCIENT-CARRYOVER-01 / -02 (heroes.ts); R-ANCPASS2-08 superseded, R-ANCCINDY-01 and R-ANCCASSEN-01 partly.

## How

The carry-over kind reuses Braum x Death's counter, no new primitive:

- `avengeGrantCard` / `avengeTeammateGetsCard` take an optional `carry: true` (only Gildmaster's and Cindy's entries
  set it; Robin's and Juggler's `avengeGrantCard` stay per combat).
- The combat mods (`ancientGorrAvenge`, `ancientMateGiftAvenge`) carry `carry`. In `simulate`, a carried mod tests
  `carriedDue(every, tick, count)` (the Braum test, now a shared helper that Braum uses too), and Rune of Fury does not
  repeat it, because "when N die" is not an Avenge (Braum's rule).
- `ancientAvengeReset` keeps `gildDeaths` / `cindyDeaths` when the pairing is the carried kind. Settle adds the fight's
  friendly deaths again (`batch5AfterCombat`, `cindyAfterCombat`), as Braum's settle does.
- Cindy's text now prints "(N more to go)" (`{cdLeft}`), matching Braum's and Gildmaster's.

## Reachability (why only these two)

On the set2-v2 strength reference (40 recorded boards per round, rounds 1-15, every pair both ways), rounds 6+ have a
median of 7 friendly deaths per fight (p90 12 to 19). Every per-combat threshold of 6 or less is reached in 69% or more
of late fights; 15 and 17 were reached in 9% and 6%. The full table is in the PR body.
