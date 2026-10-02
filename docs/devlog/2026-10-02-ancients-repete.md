# 2026-10-02: Ancients × Re-Pete

Re-Pete's six Ancient pairings (hero id `repete`, power **Second Hand**, PASSIVE: "At the end of every 3rd turn, get a
plain copy of the left-most card in your hand."), in the owner's words. Still dev-only (the Scene Builder's Set 3 Ancients
flag), so there is no patch note.

What Second Hand already did: at the End of Turn on turns 3, 6, 9 (`wave % 3 === 0`), it conjured a PLAIN copy (base
stats, no pool take) of the left-most HAND card. That card can be a spell. Rune of the Wishbone adds copies. It has its
own hero beat (`heroBeat('secondHand')`).

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Get a copy of the last minion that died in combat" | When a fight ends, a plain copy of the LAST friendly minion that died in it flies to hand (`QuestCombatMods.ancientLastDeathCopy`: the avenge bus remembers the last death, and `grantToHand` pays it below the attack loop). No death, or a full hand: nothing. |
| Fortune | "When you buy 6 cards, discover one of them. It's locked in your hand for 1 turn." | Every card bought counts, spells and the Starform included (`repeteBuys`, one running count). Every 6th buy opens a Discover of up to 3 distinct cards from those 6, **spells offered too**. The Starform is never offered. The pick is locked until next turn (`lockedUntilWave`), padlocked, and unplayable (a spell can't be cast). The power prints the buys left. |
| War | "Copied cards gain +10/+10. Improve this every time Second Hand triggers." | Each MINION copy gains the current +X/+X permanently, then X improves +10, once per trigger (`repeteWarGain`). The first trigger gives +10, the next +20. A spell copy gains nothing, but its trigger still improves X. X is printed live. |
| Genesis | "Copied minions are now exact copies" | Second Hand's copy is `exactBoardCopy` (current stats, buffs, keywords, gilding). |
| Time | "second hand triggers every 2 turns instead" | Fires on turns 2, 4, 6 instead of 3, 6, 9. The power prints the next trigger turn. |
| Bonds | "Second hand copies the Left and Right-most minions on board instead." | Copies the left-most AND right-most BOARD minions (plain) instead of the left-most hand card. One minion is both ends: one copy. An empty board: nothing. |

## How it is wired

- **Second Hand** (reducer `endRecruitTurn`) now reads four hooks:
  - `ancientSecondHandEvery`: the cadence.
  - `ancientSecondHandSources`: what it copies.
  - `ancientSecondHandIsExact` / `ancientSecondHandExactCopy`: how it copies.
  - `ancientAfterSecondHand`: what the copies gain.

  Without Ancients the result is unchanged. `conjurePlainCopy` now returns the card it made. Each source's last copy
  emits its `cardGranted` (Bonds' two edges each get one). A full hand emits nothing; before, it emitted for the last
  existing card.
- **One buy hook**: the reducer's post-buy block (every successful buy: a Shop minion, a held minion, the spell slot, a
  spell in the minion row, the Starform) calls `ancientOnBuy(state, cardId, starform, body)`. The spell slot is read from
  `state.spell`, since it is not in the Shop row.
- **Pool Discover**: `DiscoverSpec` `kind: 'pool'` grew `spells` (offer spells in `ids`) and `lockWave` (the Hourglass
  Reserve lock, which the pool branch used to clear).
- **Combat** (`@game/core`): `QuestCombatMods.ancientLastDeathCopy`. Player-only, never snapshotted.
- **Oracle**: R-ANCREPETE-01..06 in `packages/rules/src/registry/approved/heroes.ts`.
- **Tests**: `packages/sim/src/ancientsRepete.test.ts`.

## Owner rulings and judgement calls

- **Death is friendly-only** (owner 2026-10-02: "Yours only (as built)"). A body that died and then Rose or Rebirthed
  still died. A token counts.
- **Fortune offers spells** (owner 2026-10-02: "Offer spells too"). The Discover draws 3 distinct ids from the window,
  the pool Discover's draw.
- **War order**: the copy takes the current X, then X improves. Wishbone's extra copies all take the same X, and X
  improves once per trigger.
- **War on a spell copy**: nothing to grow, but the trigger still counts.
- **FX**: no new beats. Death rides a normal `toHand`. Second Hand keeps its own hero beat.
