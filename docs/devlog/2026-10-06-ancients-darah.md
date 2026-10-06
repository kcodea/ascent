# 2026-10-06: Ancients × Darah

Darah's six Ancient pairings (hero id `darah`, power **Swap**, kind `displace`: "Swap a friendly minion with a random
minion in the Shop."), in the owner's words. Still dev-only (the Scene Builder's Set 3 Ancients flag), so there is no
patch note.

What Swap already did: free, once per turn, targeted. `swapWithTavern` (shared with the Displacement spell) puts a random
Shop MINION on the board in the friendly minion's slot (a placement, no Shout) and parks the friendly minion in the Shop
as a HELD offer (`ShopCard.held`, its whole body kept), which buys back at the flat minion price, never discounted. A
golden target, or a Shop with no minion, is a no-op that keeps the charge.

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Swapping an Echo minion triggers its effect first." | Before the swap, a target with an Echo fires it through the Shop Echo ritual (`fireShopEchoOf`: Echo multipliers, the Echo tally). Its summons stay. A swap that then fails discards the whole action, Echo included. |
| Fortune | "Swapped minions are free." | The held offer Swap creates is stamped `swapFree`; `heldOfferPrice` (the reducer's held re-buy AND the UI cost coin) reads 0 Gold. |
| War | "Pummel (140): Get a charge of Swap. (Once per combat.)" | A hero Pummel on Albus' lifetime tally (`pummelDealt`), Albus' once-per-combat latch. The payout is a flagged `questTrigger` (`ANCIENT_SWAP_CHARGE_FLAG`, live in the power text and the hero-power spark); settle banks it in `darahCharges`. The reducer's `swapChargeUse` spends one once the turn's own Swap is used (Frank's stack shape); the red uses badge and "N uses left" line read it. |
| Genesis | "Swap grants a copy of the minion swapped with." | A plain copy of the Shop minion Swap brought in, hand first, the board when the hand is full. |
| Time | "End of Turn: Get a copy of the minion you swapped." | The last friendly minion Swap sent away this turn is recorded (`darahSwapped`); a virtual recurring End-of-Turn entry (`ancientDarahEotCopy`, its own beat) gives a plain copy to hand. The power prints which minion. |
| Bonds | "Swapped minions gain each others stats." | The incoming minion gains the outgoing's Attack/Health; the held body gains the incoming's. Both read before either gain. |

## How it is wired

- **Two hooks around the one swap**: `ancientBeforeSwap` / `ancientAfterSwap` in the reducer's `displace` branch. The after
  hook finds both bodies by the swap FX uids `swapWithTavern` already sets. The Displacement spell is not Swap and hears none
  of this.
- **Registry** (`packages/sim/src/ancients.ts`): a `darah` block, six `AncientEffect` variants (`swapEchoFirst`, `swapFree`,
  `pummelSwapCharge`, `swapCopyIncoming`, `eotCopySwapped`, `swapExchangeStats`), `AncientsState.darahCharges` /
  `darahSwapped`, `ShopCard.swapFree`.
- **Combat** (`@game/core`): one mod, `ancientPummelCharge`, read in `noteAncientPummel`; the tally carries back through the
  existing `ancientPummelDealt`. No new carry-back field: settle counts the flags (the Tradesman War shape).
- **UI**: the live charge count rides `combatQuestDelta.swapCharges`; the StatusBar arms the button on a banked charge.
- **Doc Bot**: `ancientPummelCharge` armed in the combat-mod scanner. **Oracle**: R-ANCDARAH-01..06. **Tests**:
  `packages/sim/src/ancientsDarah.test.ts`.

## Judgement calls (open for the owner)

- **Death**: "its effect" = its Echo, fired once (multipliers apply), while it is still on the board.
- **Fortune**: "swapped minions" = the minion sent to the Shop costs 0 to buy back (Swap was already free).
- **War**: every friendly minion's landed damage counts; the tally is lifetime; a charge carries across turns until used.
- **Genesis**: "the minion swapped with" = the Shop minion brought in; the copy is plain.
- **Time**: "the minion you swapped" = the friendly minion sent away; plain copy, hand only; this turn's last Swap only.
- **Bonds**: stats are ADDED both ways, not exchanged.
