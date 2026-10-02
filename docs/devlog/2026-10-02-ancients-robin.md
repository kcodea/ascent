# 2026-10-02: Ancients × Robin

Robin's six Ancient pairings (hero id `robin`, power **Spoils**, PASSIVE: "For each minion you sell, gain 1 Gold next
turn."), in the owner's words. Built on the Soren branch ([2026-10-02](2026-10-02-ancients-soren.md)) because every
Ancients PR edits `packages/sim/src/ancients.ts`. Still dev-only (the Scene Builder's Set 3 Ancients flag), so there is
no patch note.

What Spoils already did: every sale banks +1 Gold into the next-turn bucket (`bonusEmbersNextTurn`). It banked in three
places: `settleMinionSale` (the manual sale and Dissipate) plus the two spells that sell on their own path (Fodder
Treatment, Feed the Alpha). There was no "Spoils this turn" tally. **A Spoils count is one sale.**

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Summoned minions gain +3/+2 for every count of Spoils this turn." | Every friendly summon gains +3/+2 per sale this turn (`AncientsState.robinSpoils`, keyed on the wave). Shop: the `onSummon` fire chokepoint (a play from hand, a token summon), permanent, after the card auras (Den Marker's spot). Combat: `QuestCombatMods.ancientSummonGain` at `summonEntryEffects` (a token, a Rise, a resummon), a combat buff. The power prints the count and the gain. |
| Fortune | "Every 2 minions sold also grants a free refresh." | One running sale count; every 2nd sale banks a free Refresh (`RunState.freeRolls`, the Tradesman bank) right then. Prints the sales left. |
| War | "Give your left-most minion +2/+3 every time you sell a minion." | Each sale (board or hand) gives the left-most board minion, read after the sale, +2/+3 permanently. |
| Genesis | "When you sell 7 minions, get a copy of one of them." | A sale window (`robinWindow`); every 7th sale gives a PLAIN copy of one of the seven, picked with the run RNG, hand first, the board when the hand is full. Repeats. Prints the sales left. |
| Time | "End of Turn: Increase your max gold by 1" | A virtual recurring End-of-Turn entry (`ancientRobinMaxGold`) adds 1 to `maxGoldBonus` (the Gold Font / Shop License channel: above the natural 10, **no cap**). Prints the total. |
| Bonds | "Selling a minion makes the next of its tribe cost 2g." | A sale marks the sold minion's type(s) (`robinBonds`). The next minion bought of a marked type is capped at 2 Gold in `offerBuyPrice` (so the cost coin agrees); the buy (a normal buy or the Starform) spends that mark. |

## How it is wired

- **One sale hook**: recruit's new `bankSpoils(state, sold)` replaces the three inline Spoils lines and calls
  `ancientOnRobinSale`, so every sale path ticks the Spoils count and the sale pairings exactly once.
- **Registry** (`packages/sim/src/ancients.ts`): a `robin` block, six new `AncientEffect` variants
  (`summonGainPerSpoils`, `sellsGrantFreeRefresh`, `saleBuffsLeftmost`, `sellsGetCopy`, `eotMaxGold`,
  `saleDiscountsTribe`) and the hooks `ancientOnRobinSale`, `ancientOnShopSummon`, `ancientRobinBondsPrice` /
  `ancientSpendRobinBonds`, `ancientRobinMaxGoldLive` / `ancientRunRobinMaxGold`. New `AncientsState` fields:
  `robinSpoils`, `robinSales`, `robinWindow`, `robinMaxGold`, `robinBonds`.
- **Price**: `offerBuyPrice` folds the Bonds cap with Frank's Time cap (`min` of the caps and the offer's own price), then
  the regular discounts. `Recruit.tsx`'s shop memo now lists `run.ancients` among its deps.
- **Combat** (`@game/core`): one mod, `ancientSummonGain`, read at the summon-entry chokepoint after the onSummon
  watchers. Nothing is sold mid-fight, so the amount is fixed for the fight.
- **Doc Bot**: `ancientSummonGain` is armed in the combat-mod scanner. The staged fight's Echo summons take it, so the
  inert pin stays at 102.
- **Oracle**: R-ANCROBIN-01..06 in `packages/rules/src/registry/approved/heroes.ts`. **Tests**:
  `packages/sim/src/ancientsRobin.test.ts`.

## Judgement calls (open for the owner)

- **Death, "summoned" in the Shop** includes playing a minion from hand (the codebase's `onSummon` meaning; Den Marker
  agrees). The count is ticked while Ancients are on, whatever is picked, so sales made earlier in the turn of the pick
  count.
- **Fortune and Genesis count from the pick**, across turns (one running count each).
- **Genesis gives a random plain copy**, not a Discover of the seven (the Warden Genesis shape). The copy is the pool body
  with run-wide card buffs (`grantMinionToHandOrBoard`, Indy's Fortune copy).
- **Bonds lasts until used**, across turns, one mark per type. Not "this turn only": FLAGGED for the owner.
  - A dual-type sale marks both types.
  - An All-types sale marks "any type", which the next typed minion spends.
  - A typeless (neutral) sale marks nothing, and neutral minions never match a mark.
  - An All-types buy matches any mark and spends the first.
  - A free or already-cheap buy of a matching minion still spends the mark ("the next of its tribe").
  - A re-bought displaced (held) minion uses its own fixed price and does not spend a mark.
- **Time has no cap**: `maxGoldBonus` has no ceiling anywhere in the code.
- **FX**: no new beats. Time rides its own End-of-Turn beat (the recurring entry). Death and War Shop gains use the buff
  FX capture. Death's combat gain is a normal `buff` event.
