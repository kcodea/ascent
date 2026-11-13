# 2026-11-13: Set 2 rune batch, Basic neutral (9 runes)

One slice of the 40-rune Set 2 batch (owner review 2026-11-12, design doc `docs/design/2026-11-12-set2-rune-batch.md`).
Branch `feat/set2-runes-basic-neutral`. All nine are `sets: ['set2']`, no tribe gate, in `RUNES` (Basic), appended after
the Duos-only Basics. Names and texts are the doc's, verbatim. No rune art wired.

| Rune | Cost | Built from |
|---|---|---|
| Piggy Bank (`rune_piggy_bank`) | 2 | `recurringEndOfTurn` effect `runePiggyBank` (REPEAT form, `recurringTickCount` = 1 + unspent Gold) + `piggyBankCarry` at the end of `endRecruitTurn` (into `bonusEmbersNextTurn`) |
| Hazard Pay (`rune_hazard_pay`) | 0 | combat flag `runeHazardPay`; `hazardPayTurnStart` in `advanceCombat` after the Gold refill, inside `recordSotBeat` |
| Second Opinion (`rune_second_opinion`) | 3 | reward `discover` (exact Shop Tier) + `discoverOptionCount` (3 + copies) at every Discover builder |
| Shield Wall (`rune_shield_wall`) | 2 | combat flag; `runRuneStartOfCombat` (Twilight-repeated) + `socRuneReplaysOf` (Combat Prowess) |
| Shatterproof (`rune_shatterproof`) | 2 | combat flag; `registerShatterproof` on `onLoseDivineShield`, `permaGain` carry |
| Warm-Up (`rune_warm_up`) | 2 | combat flag; `noteWarmUp` beside the hero Pummel in `noteDamageDealt`; lifetime tally `RunState.runeWarmUpDealt` <-> `QuestCombatMods.runeWarmUpDealt` / `ShoutCarry.warmUpDealt` |
| Golden Handshake (`rune_golden_handshake`) | 1 | combat flag; Shop: `noteGilded` (the gild chokepoint); combat: `goldenHandshakeCombat` (Ancient of Time gild + new `CombatContext.onGilded` from `battlecryGildTarget`) |
| Late Bloomer (`rune_late_bloomer`) | 2 | combat flag; `lateBloomerOnUpgrade` at `upgrade`, `upgradeShopTier` and the Citadel commission |
| Loyal Customer (`rune_loyal_customer`) | 3 | combat flag; `loyalCustomerArmed` folds into `offerBuyPrice` (`loyalFree`), `noteLoyalCustomerBuy` on both buy paths |

Shop halves: `packages/sim/src/set2RunesBasicNeutral.ts`. Numbers: `SET2_BASIC_NEUTRAL` (`packages/core/src/set2RunesBasicNeutral.ts`).
Badges: Piggy Bank `xN`, Loyal Customer `N/4`, Warm-Up `N/150` (`runeTally`). Oracle: R-SET2-RUNES-BN-01..05. Tests:
`packages/sim/src/set2RunesBasicNeutral.test.ts`.

## Readings (flag to the owner)

- **Piggy Bank:** "a minion" = a random friendly minion, re-rolled per tick. The carry is banked after the End of Turn
  effects run, so it is the same Gold the repeat count read. A second copy runs the End of Turn half again; the carry is once.
- **Hazard Pay:** a draw is not a loss. Paid as the next Shop opens (Gold you could not spend after combat anyway), as its
  own Start of Turn beat. The free Refresh is banked (`freeRolls`), so it keeps past that turn.
- **Second Opinion:** the extra option applies to every Discover, including the hero-power ones (Underdweller, the
  upgrade-offer power, the Hearts suit). Archive's per-tribe Discover is not a random "N options" draw and is unchanged.
- **Shatterproof:** Ward is only ever lost in combat, so it is combat-only by construction. A re-formed Ward (Unbroken
  Scales, Bastion) that breaks again pays again.
- **Warm-Up:** a side-wide meter over every friendly minion's landed damage (the Pummel keyword's hits). Its tally is a
  lifetime count carried across fights, like the keyword's own. Rune of the Heavy Hand doubles it.
- **Golden Handshake:** "Gild" is the one chokepoint `noteGilded`: a triple, a Gild effect, and also a Gilded card
  granted to hand or a Gilded Discover pick. Combat Gilds give a combat-only +2/+2 (R-BUFF-PERM).
- **Late Bloomer:** a free Tier step (Summit Passage, Citadel) is an upgrade too, and pays per step.
- **Loyal Customer:** counts minions bought since the rune was taken, the Starform included; a displaced (held) re-buy is
  not counted. If the 4th buy was already free for another reason (Freedom rift, Festival Wages), the count still moves
  and Loyal Customer's free buy is not saved. A duplicate pays the sweetener (it cannot stack).

## Pins moved

`runes.test.ts` RUNES 207 -> 216; `set3RuneRoster.test.ts` Set 2 Basic 127 -> 136; `ruinousRune1010.test.ts` (Ruinous is
now last before the Duos block, not last overall); strategy package census (rune affinity counts); text-oracle economy
skip cap 8 -> 11; `tallyCoverage.test.ts`; `runeWiringAudit.test.ts` reads the new Shop module; combat-mod lane INERT pin.
