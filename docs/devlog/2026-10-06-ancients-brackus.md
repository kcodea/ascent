# 2026-10-06: Ancients × Brackus

Brackus's six Ancient pairings (hero id `brackus`, power **Summit**, PASSIVE: "At the start of the game, Discover a Tier 7
minion. It is locked until you spend 70 Gold."), in the owner's words. Still dev-only (the Scene Builder's Set 3 Ancients
flag), so there is no patch note.

What Summit already did: `createRun` queues a fixed-tier Tier 7 Discover with `lockGold: 70`; the pick carries
`lockedUntilGoldSpent: 70`, read against the run's cumulative `goldSpent` by `handCardLocked` (the `play` gate) and the
hand's padlock label. Only the reducer's `spendGold` moves `goldSpent`, so it is the one Gold-spent chokepoint.
**"Summit triggers" = the pick unlocks.**

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Avenge (3) Give all Tier 7 minions +6/+6." (owner: "this works in hand/shop") | A hero Avenge (3) on ONE running count across the Shop and combat (`brackusDeaths`, the Xerox Death shape). Each fire gives every Tier 7 minion +6/+6 permanently: the board, the hand and the Shop offers. In combat the living Tier 7 bodies gain it live (`permaGain` carries it home), and each fire pulses a `questTrigger` that settle counts to pay the hand and the Shop. Rune of Fury fires it again. The countdown is live and shares the centre disc. |
| Fortune | "When you spend 50g, Discover a Tier 7 minion." | Every 50 Gold spent since the pick (`brackusGold`) opens a Tier 7 Discover. Repeats; a 120 Gold spend queues two. Prints the Gold to go. |
| War | "Start of Combat: When you have space, summon a copy of your Tier 7 minion." | An exact copy (`xeroxCopy`) of the left-most living Tier 7. With room it lands at Start of Combat; on a full board it waits in `pendingSummitCopies` and lands the moment a slot opens (flushed after Reclaim's queue). Prints the minion it would copy. |
| Genesis | "Add 40 gold to Summit. When it triggers, it grants or makes your Tier 7 Gilded." (owner: "if it has triggered already, after 30 more gold, the Tier 7 becomes Gilded.") | At the pick: a still-locked Summit pick's lock goes 70 → 110 and it Gilds the moment it unlocks; an unlocked one Gilds after 30 more Gold (`brackusGildAt`). Once. Prints the live lock and the Gold left. |
| Time | "Discover a Tier 7 minion in 3 turns." | The Start of Turn three turns after the pick queues one Tier 7 Discover on its own beat (`brackusTimeWave`). Once. Prints the countdown. |
| Bonds | "Your Tier 7 cards gain +1/+1 per card tier when a card is played." | Every real play (the `play` case, right after the cards-played meter) gives your OTHER Tier 7 minions, board and hand, +1/+1 per tier of the played card. Prints the total so far. |

## How it is wired

- **Registry** (`packages/sim/src/ancients.ts`): a `brackus` block, six new `AncientEffect` variants
  (`avengeBuffTier7`, `goldSpentDiscoverTier7`, `socCopyTier7`, `summitGildTier7`, `discoverTier7InTurns`,
  `playBuffsTier7PerTier`) and the hooks `ancientOnGoldSpent`, `ancientBrackusShopDeath`, `ancientOnCardPlayed`,
  `ancientBrackusAvengeLeft` (plus the internal pick / settle / Start-of-Turn halves).
- **Gold spent**: the reducer's `spendGold` calls `ancientOnGoldSpent` (Fortune's count, Genesis' Gild).
- **Shop death**: `ancientBrackusShopDeath` at `fireOnFriendDeath`, beside Xerox / Tradesman / Gorr.
- **Play**: the reducer's `play` case calls `ancientOnCardPlayed` right after `applyCardsPlayed(s, 1)`, so a Choose One
  counts once, after its choice, and a fizzle (the original state returned) counts nothing.
- **Combat** (`@game/core`): `QuestCombatMods.ancientBrackusAvenge` (an avenge-bus listener) and
  `QuestCombatMods.ancientSummitCopy` (the Start-of-Combat pass, after Xerox's copy).
- **UI**: `StatusBar` shows the hero Avenge disc for `summitLock` too. The hand's padlock already counts down from the
  card's own lock, so Genesis' +40 shows with no UI change.
- **Doc Bot**: both mods armed in the combat-mod scanner. War needs a Tier 7 on the board, so the scanner gained a
  `TIER7_STAGE_KEYS` stage (one Tier 7 body), and the inert pin is unchanged.
- **Oracle**: R-ANCBRACKUS-01..06 in `packages/rules/src/registry/approved/heroes.ts`. **Tests**:
  `packages/sim/src/ancientsBrackus.test.ts`.

## Judgement calls (open for the owner)

- **Death**: the Avenge count is ONE running count that carries across turns and fights (it never resets each turn).
  The Shop share of a COMBAT fire is paid at settle, which is before the next turn's Shop is rolled, so only a frozen
  Shop keeps it. A Tier 7 body that died before a fire misses that fire.
- **Fortune repeats** every 50 Gold, counted from the pick (Gold spent before the pick does not count).
- **War copies ONE minion**: the left-most living Tier 7 at Start of Combat. A second Tier 7 is not copied.
- **Genesis**: "grants" is read as the fallback when there is no Tier 7 to make Gilded. The Summit pick first, then any
  other non-Gilded Tier 7 you hold; holding no Tier 7 at all, a Gilded copy of the Summit pick. Holding only Gilded
  Tier 7s, nothing more happens.
- **Time fires once**, at the Start of Turn three turns after the turn of the pick (picked on turn 3: turn 6).
- **Bonds**: "per card tier" is the PLAYED card's tier (a Tier 4 card gives +4/+4). "Cards" played counts minions, spells
  and Rubies. The played Tier 7 does not buff itself. Shop offers are not "your cards", so they are left out.
- **FX**: no new beats. Time rides its own Start-of-Turn beat; Shop gains use the buff FX capture; combat gains are
  normal `buff` events and the copy is a normal `summon`.
