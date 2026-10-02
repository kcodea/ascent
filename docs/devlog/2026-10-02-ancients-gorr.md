# 2026-10-02: Ancients × Gorr

Gorr's six Ancient pairings (hero id `gorr`, power **Four Peat**, PASSIVE: "When you buy 3 minions in a turn, get a plain
copy of one of them at random."), in the owner's words. Built in the same PR as Re-Pete
([2026-10-02](2026-10-02-ancients-repete.md)), sharing its buy hook. Still dev-only (the Scene Builder's Set 3 Ancients
flag), so there is no patch note.

What Four Peat already did: the EXACT 3rd minion bought each turn (`gorrBuys` on the run, spells excluded) conjures a
plain copy of one of the three. Every pairing below leaves it alone.

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Avenge (6): Get a copy of a minion you bought last turn." | A hero Avenge (6) on ONE running count of friendly deaths across the Shop and combat (`gorrDeaths`, the Xerox Death shape). Each fire gives a plain copy of a random minion bought LAST turn (wave - 1). In combat it is a live `toHand`. Nothing bought last turn: nothing. Rune of Fury fires it again in combat. The countdown is live and shares the centre disc. |
| Fortune | "The first minion you buy each turn is free." | While no minion has been bought this turn, the next minion offer is free: `offerBuyPrice`'s `freeBuy`, so the coin, the bots and the charge agree. It uses the Freedom rift / First Pick marker. |
| War | "pummel (200): get a copy of a minion in your warband." | A hero Pummel on Albus' lifetime tally (`pummelDealt`, Heavy Hand's share). REPEATING: every multiple of 200 crossed sends a plain copy of a random LIVING friendly minion to hand, mid-fight. Progress is printed live. |
| Genesis | "get a second copy of the first minion you buy each turn" | The first minion bought each turn also puts a plain copy in hand. |
| Time | "End of Turn: Get a random copy of a minion you bought this turn." | A virtual recurring End-of-Turn entry (`ancientGorrEotCopy`, its own beat): a plain copy of a random minion bought this turn. None bought: nothing. |
| Bonds | "When you buy 3 cards, give them +2/+2 and improve this." | Every 3rd card bought (spells too) gives the MINIONS among those 3 buys +X/+X permanently, wherever they are now. X starts at 2 and improves +2 per payout (`gorrBondsGain`). X and the buys left are printed. |

## How it is wired

- **Buy hook**: `ancientOnBuy` (the reducer's post-buy block, every buy path once) runs `gorrOnBuy`. While Ancients are on,
  whatever is picked, it keeps two things, so buys made before the pick count:
  - `gorrBuys`: the bodied minion buys of this turn and last turn.
  - `gorrMinionBuys`: this turn's minion-buy count, the Starform included.

  It then runs Genesis and Bonds. Bonds tracks each buy's body by uid: the new uid holding the bought card after the
  action, which is the golden when the buy completed a triple.
- **Shop death**: `ancientGorrShopDeath` at `fireOnFriendDeath` (beside Xerox and Tradesman).
- **Price**: `ancientGorrFirstFree` folds into `offerBuyPrice`'s `freeBuy` (never for a spell).
- **Combat** (`@game/core`):
  - `QuestCombatMods.ancientGorrAvenge`: an avenge-bus listener on `tick + count`, carrying last turn's ids.
  - `QuestCombatMods.ancientPummelCopy`: inside `noteAncientPummel`, sharing Albus' tally and the `ancientPummelDealt`
    carry-back.
- **Doc Bot**: both new mods are armed in the combat-mod scanner (Avenge (1), Pummel (1)).
- **Oracle**: R-ANCGORR-01..06 in `packages/rules/src/registry/approved/heroes.ts`.
- **Tests**: `packages/sim/src/ancientsGorr.test.ts`.

## Judgement calls (open for the owner)

- **Fortune and Genesis never interact**: a run picks exactly one Ancient.
- **"First minion bought"**: the Starform and a re-bought displaced (held) minion count as minion buys.
  - A held minion keeps its own fixed price (the Robin / Frank precedent), so it is never the free one, but it still
    uses up "first".
  - A spell bought first does not.
  - Fortune shares the one-freebie-per-turn marker with the Freedom rift and First Pick, so holding both is still one
    free minion.
- **Death's "last turn"** is wave - 1 relative to the current wave. In the fight that ends turn N, it is turn N-1's buys.
  The Starform is never in the log.
- **War's "warband"** is your living minions at the moment of the crossing, in combat. It has no once-per-combat cap
  (unlike Albus' text).
- **Bonds**: a spell, the Starform, or a body that was sold or consumed before the payout gets nothing.
- **Plain copies** are the pool body with run-wide card buffs (`grantMinionToHandOrBoard`, the Indy / Robin copy), hand
  only (a full hand gets none).
- **Genesis' copy** is not a buy, so it does not feed Four Peat. A copy that makes a third of a card triples in the same
  action (the post-action triple check that quest rewards use).
- **FX**: no new beats. Time rides its own End-of-Turn beat. Combat copies are normal `toHand` events. The Bonds Shop
  gains use the buff FX capture.
