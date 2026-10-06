# 2026-10-06: Ancients × Ayse

Ayse's six Ancient pairings (hero id `cia`, power **Lucky Seat**, PASSIVE: "Buy 3 Enchanted cards for a reward."), in
the owner's words. Same shape as Robin's ([2026-10-02](2026-10-02-ancients-robin.md)) and Gorr's
([2026-10-02](2026-10-02-ancients-gorr.md)). The Ancients themselves are still dev-only (the Scene Builder's Set 3
Ancients flag), so they have no patch note; the spell-slot fix below is live play and has one.

What Lucky Seat already did: every Shop roll gives each offer (the minion row AND the right-hand spell slot) a 20% chance
of the Enchanted mark (`ShopCard.enchanted`, `rollCiaEnchants`). The mark does nothing to the card; buying one ticks
`ciaEnchantedBought`, and the 3rd pays the queued suit (`ciaBuyEnchanted`). "Completing" or "triggering" Lucky Seat is
that 3rd buy.

## A live bug found on the way (R-LUCKYSEAT-01)

Since 2026-08-22 the spell slot rolls for the mark, but its buy path never called `ciaBuyEnchanted` (the 2026-08-22
commit believed it did; it meant the spell offered *in the row*). So an Enchanted slot spell could be bought and never
counted. The slot now calls it, after the spell lands in hand. Three pairings (Genesis, Time, Bonds) stand on that count,
so the fix ships with them.

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Echo cards are always enchanted." | Every Shop offer that prints an Echo wears the mark. `ancientSyncEchoEnchants` runs in the reducer's every-action `sync*` block, so any path that puts an offer in the Shop is covered, and the RNG stream is untouched. "Prints an Echo" = the shared `hasDeathrattle`, or a printed `**Echo:**` (four Echo minions use factories not named `deathrattle*`). A friend-death watcher (Brood Matron) is not an Echo. |
| Fortune | "Enchanted cards cost 2g" | An Enchanted card costs at most 2 Gold, never raised. Minions: a cap in `offerBuyPrice` (beside Frank's Time and Robin's Bonds). Spells: an extra cut, `ancientEnchantedSpellCut`, on both spell buy paths, the UI's spell coins and the bots' view. Discounts apply on top. |
| War | "When you buy an Enchanted minion, give it +3/+3 and improve this." | The bought body gains +X/+X permanently; X starts at 3 and improves +3 per trigger, across turns (`ayseWarGain`). Spells and the Starform: nothing, no improve. Printed live. |
| Genesis | "When you complete Lucky Seat, get a copy of one of the minions purchased." | The completing buy also gives a plain copy of a random minion among that cycle's Enchanted buys (`ayseWindow`), hand first. Spells are never copied. |
| Time | "End of Turn: Give your minions +3/+3 for every Enchanted card purchased this turn." | A virtual recurring End-of-Turn entry (`ancientAyseTime`): +3/+3 to every board minion per Enchanted card bought this turn (`ayseBuys`, spells included), one itemized step per card. Prints the count and the grant. |
| Bonds | "Triggering Lucky Seat grants your left and right-most minions +5/+6." | Each Lucky Seat trigger gives the left-most and right-most board minions +5/+6 permanently (once when they are the same minion). |

## How it is wired

- **One buy hook**: `ancientOnEnchantedBuy`, called from the reducer's post-buy block (after the bought card has landed,
  so the hand cap is honest) whenever the bought offer was Enchanted. It gets the body, whether this buy completed
  Lucky Seat (`ciaEnchantedBought + 1 >= 3` read off the pre-action state), and `wishboneReps`. The per-turn count and
  the cycle window tick while Ancients are on, whatever is picked, so buys before the pick count.
- **Registry** (`packages/sim/src/ancients.ts`): a `cia` block, six new `AncientEffect` variants (`echoAlwaysEnchanted`,
  `enchantedCost`, `enchantedBuyBuffImproves`, `luckySeatCopyPurchased`, `eotBuffPerEnchantedBuy`,
  `luckySeatBuffsEdges`), new `AncientsState` fields `ayseBuys`, `ayseWindow`, `ayseWarGain`.
- **No combat half**: nothing is bought in combat, so all six are Shop / End of Turn (R-PHASE-01 has no combat path
  to cover). No `@game/core` change, no Doc Bot combat-mod arm.
- **Oracle**: R-LUCKYSEAT-01 and R-ANCAYSE-01..06 in `packages/rules/src/registry/approved/heroes.ts`. **Tests**:
  `packages/sim/src/ancientsAyse.test.ts` (the slot test fails without the fix).

## Judgement calls (open for the owner)

- **Fortune is a cap, not a set price**: a 1 Gold spell stays 1 Gold; other discounts still come off the 2. A held
  (displaced) minion keeps its flat price (the Frank / Gorr precedent).
- **War improves only when a minion was buffed**, and the improvement is kept across turns (Gorr's Bonds, Re-Pete's War).
- **Genesis copies a random one** (seeded), not a Discover; a plain copy; minions only.
- **Rune of the Wishbone** ("Your Hero Power triggers twice") doubles the Genesis copy (re-picked) and the Bonds grant.
- **Time counts every Enchanted card**, spells and the Starform included ("card", not "minion").
- **Death only marks Shop offers** (there is nowhere else a card can be Enchanted).
- **FX**: no new beats. Time rides its own End-of-Turn beat; War and Bonds use the Shop buff FX capture.
