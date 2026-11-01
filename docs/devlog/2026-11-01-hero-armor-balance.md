# 2026-11-01 · Hero balance: Armor pass + Tradesman's surcharge

Owner balance list 2026-11-01. Branch `fix/hero-armor-balance-1101`. Every name matched a hero display name in
`packages/sim/src/heroes.ts` ("Kindness" and "Tradesman" are heroes, not power names; "Raysae" is Rayse).

| Hero (id) | Armor before | Armor after |
|---|---|---|
| Guardian (`runeguard`) | 10 | 6 |
| Emerald Warden (`emeraldwarden`) | 8 | 3 |
| Drakko (`drakko`) | 13 | 8 |
| Brackus (`brackus`) | 11 | 8 |
| Hunch (`hunch`) | 10 | 14 |
| Merrin (`merrin`) | 10 | 11 |
| Kindness (`kindness`) | 15 | 11 |
| Rascal (`baggerben`) | 9 | 10 |
| Nadja (`nadja`) | 17 | 15 |
| Rayse (`rayse`) | 14 | 13 |
| Lord of the Risen (`risen`) | 14 | 11 |

Tradesman (`hermithank`, Frugal): Shop upgrades cost **1** more (was 2). The one dial is
`FRUGAL_UPGRADE_SURCHARGE` in `packages/sim/src/ancients.ts`, read by the reducer's `upgradeCostOf` and the Ancient
Time / Bonds discounts (`cutUpgradeCost` caps the eaten surcharge at it, so "down to 0" still holds). Power text now
reads "Shop upgrades cost 1 more"; the Time / Bonds powers already print the live price.

## Notes

- Recorded opponents (`opponentPool.data.ts`, snapshots) were not touched: a lobby seat's starting Armor is read from
  the hero registry at lobby creation (`seatStartingArmor`), so new lobbies use the new values; an in-flight saved
  lobby keeps the Armor it already has.
- The approved hero rules for Tradesman × Time / Bonds (`approved/heroes.ts`) said "+2"; they now say "+1".
- Versus resolves with `@game/sim` content, so the next Worker pack picks up the change.
