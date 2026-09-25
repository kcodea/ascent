# 2026-09-25 — Fight Recap condensed (owner ask)

Follow-up to [2026-09-24-fight-recap](2026-09-24-fight-recap.md). The owner wanted the recap more to the point:

- **Header:** the two "You dealt / You took" tiles flanking the foe became ONE line under the foe portrait —
  `You dealt X` (green) on a win, `You took X` (red) on a loss, `No damage` otherwise. The Armor / Resolve split
  only shows when Armor actually absorbed part of the hit.
- **Odds:** the "You had X% chance to win" line and "A loss here usually costs N damage" are gone. The section is
  titled **Fight outcome odds**, and the bar is flanked by the rounded **average damage a win deals** (left, green)
  and **a loss costs** (right, red); `–` when that outcome never happened in the sims.
- **Stars of the fight removed**, and `fightStars` / `starStatLabel` / `articleFor` deleted with it.

## New odds field

`CombatResult.odds.avgWinDamage` (`packages/core/src/types.ts`, additive + optional): the mean of
`min(enemyDamage, lossDamageCap(wave))` over the winning sims, computed in `createOddsProbe`
(`packages/sim/src/odds.ts`) — the same cap the recap's real "You dealt" uses. Odds recorded before it existed
(saved runs, old replays) show `–` on the win side. `lossDamageRange` is still produced but no longer displayed.
