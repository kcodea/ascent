# 2026-11-13: Gold for Grub, End of Quarter and Drunk Shopkeeper (three Set 2 Basic runes)

Owner designs. Rules R-SET2-RUNE-GOLDFORGRUB-01, R-SET2-RUNE-ENDOFQUARTER-01 and R-SET2-RUNE-DRUNKSHOPKEEPER-01; tests
in `packages/sim/src/set2ShopRunesGrubQuarterDrunk.test.ts`.

## Gold for Grub (Demon, 4)
"When you spend **7** Gold, a random **Demon** consumes a minion in the Shop."

First drafted as "Infernal" at 6 Gold; the owner renamed it and moved it to 7 before it merged (id `rune_gold_for_grub`).

- Data on the existing `runeThreshold` engine (Dragon Hoard's `gold` meter: remainder carried, Big Spender heard,
  one meter per copy) with one new payload, `demonConsumeShop`. The bite (`grubBite`, recruit.ts) draws a random
  friendly Demon, then a random edible Shop minion, off the run cursor, and eats through `consumeShopMinion`, so every
  consume watcher, the `shopEaten` FX and the Shop Madness refill come for free.
- **Choice: no Demon or no Shop minion = the Gold still counts and the meter resets**, but nothing is eaten and the
  rune does not fire (no proc, no beat).
- **Refresh ordering:** a Refresh pays its Gold before the row rolls. A bite earned by that Gold is deferred
  (`RunState.grubBitesDeferred`, set only around the Refresh's charge) and flushed after `applyShopRefreshed`, so
  it eats from the new row. Same rule Hellrider follows.

## End of Quarter (neutral, 3, Shop-only)
"Every card in your Shop has a **30%** chance to cost **1** less."

- `rollEndOfQuarter` (shop.ts) runs from `stampNewShopOffers` (every path that serves a new offer) and at the three
  spell-slot assignments. Stamps `ShopCard.quarterCut` (Gold off) and `quarterRolls` (copies that have rolled).
- **Choice: two copies roll separately** (a card can cost 2 less; about 51% get at least 1 off). A second copy taken
  later rolls only its own roll for the cards already there. The cards in the Shop when the rune is taken roll then.
- The roll is seeded from `mixSeed(run seed, uid hash, copy index)`, NOT the shared cursor, so taking the rune never
  shifts any other draw (pinned by a test comparing rows with and without it) and frozen cards never re-roll.
- Prices: `offerBuyPrice` (minions, stacked after Wholesale, floored at 0, skipped by a free buy), both spell buy paths,
  the UI's `spellCostMod`, the production bots' visible price. The coin goes green the usual way.
- Held (Displacement) offers and the Starform never roll (they keep their own prices).

## Drunk Shopkeeper (Dwarf, 2, Shop-only)
"When you cast an **Ale**, give minions in your Shop **+1/+1** permanently."

- `drunkShopkeeperOnCast` (set2RunesBasicTribal.ts), called from `castSpell` beside Star Tap and Flamekeeper, so it
  hears every Shop Ale cast and every repetition of a multiplied one. Bakes +1/+1 per copy onto each minion offer
  standing in the row (`buffThisShopOffers`, Apples' "this shop" channel), NOT the run-wide Shop buff Staff of Guel
  uses: the owner wants later arrivals unbuffed and frozen cards to keep it.
- **Choice: an Ale cast in combat does nothing for it** (a fight has no Shop to buff).

Art: the owner's masters (GoldForGrub.png, EndOfQuarter.png, DrunkShopkeeper.png) are wired untouched through
`npm run optimize-art` (resize + WebP only, no toning).
