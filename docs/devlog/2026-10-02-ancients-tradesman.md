# 2026-10-02: Ancients × Tradesman

Tradesman's six Ancient pairings (hero id `hermithank`, power **Frugal**, PASSIVE: "Shop minions cost 2 Gold. Shop
upgrades cost 2 more, and rerolls cost 2 Gold."), in the owner's words. Built on the Ancients proof of concept and
stacked on the Xerox set ([2026-10-02](2026-10-02-ancients-xerox.md)). Frugal is passive, so every pairing is
"{base} + addendum". Still dev-only (the Scene Builder's Set 3 Ancients flag), so there is no patch note.

"A Refresh" is every Shop refresh the Ancients meter already counts (the reducer's `refreshTavern` with `hold` off):
a paid roll, a free roll, a power's refresh (Clearance, Buyout). The turn-start roll is the new Shop, not a Refresh.

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Avenge (3): Gain a free Refresh" | A hero Avenge (3) on ONE running count of friendly deaths across Shop and combat (`AncientsState.tradesDeaths`, the Xerox Death convention). Every 3rd death banks a free Refresh (`RunState.freeRolls`) right then. Combat banks through `grantFreeRolls` (the Gryphon carry-back), usable from the next Shop. Rune of Fury fires the combat half again. |
| Fortune | "When you buy a minion, gain a free Refresh" | Every minion bought from the Shop (a normal buy, the Starform, a displaced body re-bought) banks a free Refresh immediately. Spells, Discovers and generated cards do not count. Changed the same day: see the section at the end. |
| War | "Your minions gain Rally: Gain 1g next turn" | Every friendly minion carries the Rally keyword and a grafted `rallyGoldNextTurn`. Every Rally trigger banks 1 Gold next turn, uncapped: a swing, a Rally multiplier repeat, a free or Shop Rally. |
| Genesis | "Every 2 Refreshes, cast Lasso." | A running Refresh count since the pick (`tradesRefreshes`, free ones included). Every 2nd casts Lasso through `castSpell` right after the new row is in, so it steals from the fresh Shop. The beam leaves the hero power. |
| Time | "End of Turn: Reduce the cost of upgrading the Shop by 3." | A virtual recurring End-of-Turn entry (`ancientTradesUpgrade`) knocks 3 off the FINAL upgrade price, Frugal's +2 included, down to 0 (owner ruling: "Yes, down to 0"). |
| Bonds | "Refreshing the shop reduces the cost of upgrading the Shop by 1." | Every Refresh knocks 1 off the FINAL upgrade price, Frugal's +2 included, down to 0, real time. |

## How it is wired

- **Registry** (`packages/sim/src/ancients.ts`): a `hermithank` block, six new `AncientEffect` variants and the Tradesman
  hooks (`ancientTradesShopDeath`, `ancientTradesBuy`, `ancientRallyGoldGraft` + `rallyGoldGraftEffect`,
  `ancientAfterRefresh`, `ancientRunTradesUpgrade`). New `AncientsState` fields: `tradesDeaths`, `tradesRefreshes`,
  `tradesRallyGold`.
- **Refresh hook**: `refreshTavern` is now a thin wrapper (`rollTavern` + `ancientAfterRefresh` when not `hold`), so
  every caller shares one place, and Lasso resolves after the row is rolled.
- **War graft**: the Shop half rides `applyRuneGrafts` (board + hand, every arrival path, plus the reducer's per-action
  sweep); combat summons get it through `QuestCombatMods.ancientRallyGold` in `graftBatch3Runes`. The effect body is a
  new `ARENA_EFFECTS.rallyGoldNextTurn` with a new arena capability `grantGoldNextTurn` (combat: `grantBonusGold`;
  Shop: `bonusEmbersNextTurn`). Registered in the `EffectFactoryId` union, the schema whitelist and the presentation
  policy registry (`factory:rallyGoldNextTurn:onAttack`, own beat, rally family). `fixed: true`, so a Gilded minion
  gives the same 1 Gold (the rune-graft rule).
- **Combat** (`@game/core`): `QuestCombatMods.ancientRefreshAvenge` (avenge-bus listener on `tick + count`, emits a
  `questTrigger` per Refresh) and `ancientRallyGold`. No new carry-back field: free Refreshes come home through
  `playerFreeRolls` and Gold through `playerBonusGold`; settle counts the War flags for the live text and advances the
  Death count from `playerDeaths`.
- **Upgrade discount (Time / Bonds)**: the running `upgradeCost` goes first (the Rune of Shopkeep mechanism, floored at
  `CONFIG.upgradeCostFloor`); the overflow eats into Frugal's surcharge for the CURRENT tier
  (`AncientsState.tradesSurchargeOff`, capped at `FRUGAL_UPGRADE_SURCHARGE`, ignored once the tier changes, so every
  tier-up path restores the full +2 by construction). `upgradeCostOf` subtracts it, so the button, bots and charge agree.
- **Live text**: `{tDeathLeft}` + `{freeRolls}` (Death; the replay's flags fold in mid-fight), `{rallyGold}` (War: Gold
  banked for next turn, live through a fight), `{lassoLeft}` (Genesis), `{upgradeNow}` (Time / Bonds: the price an
  upgrade charges right now, Frugal's +2 included; `tradesUpgradeCost` restates `upgradeCostOf`, pinned equal by a
  test). Death's countdown also takes the shared centre disc (`ancientAvengeCountdown`, now including Frugal).
- **Doc Bot**: the combat-mod scanner arms `ancientRefreshAvenge` (Avenge 1) and `ancientRallyGold`; both act in the
  staged fight, so the inert pin stays at 101.
- **Oracle**: R-ANCTRADES-01..06 in `packages/rules/src/registry/approved/heroes.ts`. **Tests**:
  `packages/sim/src/ancientsTradesman.test.ts`.

## Judgement calls (open for the owner)

Owner rulings on PR #1905 (2026-10-02): War, a Gilded minion: "Always 1 (as built)". Time / Bonds floor: "Yes, down to
0" (changed: the discounts eat Frugal's +2). Fortune: "All minion buys (as built)". Genesis: "Yes, every refresh (as
built)". Time FX: kept as built.

Still open:

- **Death counts one running total across Shop and combat** (the Xerox ruling), not a per-fight Avenge.
- **War is a graft, not a hero listener**, so Rally multipliers, free Rallies and Shop Rallies all pay. Minions in HAND
  carry it too (they arrive with it). The Gold is uncapped (the next-turn bank has no cap).
- **Genesis counts from the pick**, across turns. A full hand or an empty Shop makes Lasso steal nothing (the count
  still resets).
- **FX**: no new beats. The Time cut rides its own End-of-Turn beat (the recurring entry) but emits no
  `resourceChanged` consequence (the Rune of Shopkeep one does); the Genesis Lasso uses the existing lasso beam from
  the hero-power button (new `'hero'` origin).

## 2026-10-02 change: Fortune is "your next Refresh costs 0"

Owner: "change tradesman's fortune ancient to 'when you buy a minion, your next refresh costs 0' this way it doesn't
stack up multiple free refreshes."

- A minion buy now sets ONE pending flag (`AncientsState.tradesNextRefreshFree`, effect `buyNextRefreshFree`). More
  buys while it is set do nothing. It no longer touches the `freeRolls` bank.
- The `roll` branch spends it FIRST, before a banked free Refresh (Death, runes) or Window Shopping, so the bank is
  kept for later. Window Shopping still counts that Refresh toward its 3, as it already does for banked free rolls.
- It carries across turns until used, and survives save / restore (plain data on `AncientsState`).
- `refreshCostOf` returns 0 while it is pending, so the Refresh button (`nextRefreshCostOf`) and both bot price reads
  agree. The power text prints "Next Refresh free: Yes / No". The Genesis / Bonds refresh hooks count the free Refresh
  like any other (they run on every `refreshTavern`).
- Oracle R-ANCTRADES-02 updated; tests in `ancientsTradesman.test.ts`.
