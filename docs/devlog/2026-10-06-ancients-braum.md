# 2026-10-06: Ancients × Braum

Braum's six Ancient pairings (hero id `bram`, power **Investment**, 1 Gold, once per turn: "Invest 1 Gold. After
investing 5, get a random Gilded minion, then reset."), in the owner's words. Still dev-only (the Scene Builder's Set 3
Ancients flag), so there is no patch note.

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Investment becomes: When 16 friendly minions die, get a random Gilded minion." | Investment turns passive. ONE running count of friendly deaths across the Shop and combat (`bramDeaths`) pays Investment's own payout (a random minion up to your Shop tier, Gilded) on every 16th death, repeating. In combat it is a live `toHand`, gilded at settle. Not an Avenge (the Rune of Body Counting wording), so Rune of Fury does not repeat it. The countdown is live through a fight; the power tally reads `n/16`. |
| Fortune | "Investment is free. Triple rewards also grant 3 gold." | Investment costs 0 (the pairing's `power`), still 5 uses to pay out. Every Triple Reward you GET gains 3 Gold right then. The power prints the Gold so far. |
| War | "Start of Combat: Give your minions +8/+8 for every Gilded minion you've played this game." | Gilded minions played from hand are counted from the run start (`bramGildedPlays`). Start of Combat: every friendly minion gains +8/+8 per play, a combat buff. Count and grant printed live. |
| Genesis | "Discover the minion from Investment. It is always of your current tier." | The 5th investment opens a Discover of minions of exactly your current tier; the pick arrives Gilded. |
| Time | "Investment becomes: Discover a Tier 5 minion. Start of Turn: Get another copy." | Investment becomes a once-per-game 1 Gold Discover of a Tier 5 minion. Every Start of Turn after, a plain copy of the pick goes to hand (its own beat). The power names the minion it copies. |
| Bonds | "When you play a Gilded minion, give your minions +8/+8." | Playing a Gilded minion gives every board minion, the played one included, +8/+8 permanently, from the hero-power button. |

## How it is wired

- **Investment branch** (reducer): `ancientInvestmentPassive` (Death refuses the press), `ancientInvestmentTime` +
  `ancientRunInvestmentTime` (Time's Discover replaces the bank), `ancientInvestmentDiscovers` +
  `ancientRunInvestmentGenesis` (Genesis' payout). Fortune's cost and Time's once-per-game ride the pairing's `power`
  override (`AncientPowerOverride` grew `oncePerGame`).
- **Triple Rewards**: `ancientOnTripleReward` at the end of `grantGoldenDiscover`, the one chokepoint every Triple Reward
  walks, after the card lands.
- **Time's pick**: `ancientOnDiscoverPick` at the top of `takeDiscoverPick`. The power never fires while a modal is open,
  so its Discover opens at once and the next pick is Time's (`bramTimePending`).
- **Plays**: `bramOnPlay` at the top of `ancientOnPlay` (the `playCard` chokepoint): War's count and Bonds' grant.
- **Shop deaths**: `ancientBramShopDeath` at `fireOnFriendDeath`.
- **Start of Turn**: `bramStartOfTurn` in `ancientStartOfTurn` (`recordSotBeat`, R-SOT-BEAT-01).
- **Combat** (`@game/core`):
  - `QuestCombatMods.ancientBramDeaths`: an avenge-bus listener on `tick + count` that calls `grantRandomMinion` and
    records the grant's index in the new `ShoutCarry.handGilds`; settle gilds those hand grants.
  - `QuestCombatMods.ancientSocBuffAll`: a Start-of-Combat buff to every living friendly minion.
- **UI**: the StatusBar Investment tally asks `ancientInvestmentTally` (Death `n/16`, Time none).
- **Doc Bot**: both mods armed in the combat-mod scanner.
- **Oracle**: R-ANCBRAUM-01..06 in `packages/rules/src/registry/approved/heroes.ts`.
- **Tests**: `packages/sim/src/ancientsBraum.test.ts`.

## Judgement calls (open for the owner)

- **Death repeats** every 16 deaths, and the count starts at the pick. It is not an Avenge (Rune of Fury does not double
  it), following Rune of Body Counting's identical "When N friendly minions die" wording. A full hand drops that payout
  but the count still resets.
- **Fortune's "free"** is 0 Gold per use; it is still once per turn and still 5 uses to pay out.
- **Fortune's Gold** is paid when you GET a Triple Reward (playing a Gilded minion, Keshi, a fortress reward), not when you
  play it. A reward lost to a full hand pays nothing. Each Corrupted Tome extra pays too.
- **War** counts only Gilded minions PLAYED from hand (not ones gilded on the board, not Discovered-and-held), from the
  run start.
- **Genesis**: the Discover offers Gilded minions; the 5-use bank and the 1 Gold cost are unchanged.
- **Time**: Investment still costs 1 Gold and is ONCE PER GAME. The copy is plain and comes every Start of Turn for the
  rest of the run. If the owner wants it usable every turn, drop `oncePerGame` from the pairing's `power` (the Start of
  Turn copy then follows the latest pick).
- **Bonds** includes the played minion in "your minions".
- **FX**: no new beats. Time rides its own Start-of-Turn beat; combat payouts are normal `toHand` events (they fly as
  plain cards and land Gilded); Bonds' Shop gains stream from the hero-power button.
