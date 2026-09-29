# 2026-09-28: Ancients × Albus

Albus's six Ancient pairings (hero id `albus`, power **Empowerment**: "Choose a Shop minion. Discover a minion from the
tier above it for it to become.", 1 Gold, once per turn), in the owner's words, built on the Ancients proof of concept
and mirroring the Warden, Auctioneer and Lord of the Risen pairings. Still dev-only (the Scene Builder's Set 3
Ancients flag), so there is no patch note, like the three hero PRs before it. Albus already had an awakening style
(B, Card fan, 3 cards) from the bloom-styles pass, so no UI theme work was needed.

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Echo minions discovered from Empowerment gain Rise." | The Empowerment pick, when it has an Echo (an `onDeath` effect), gains Rise. The pick replaces the Shop offer, so the Rise rides `ShopCard.keywords` and is baked in on the buy. |
| Fortune | "Minions discovered by Empowerment are free." | The new Shop offer's set price (`ShopCard.cost`) is 0. Empowerment itself still costs 1. |
| War | "Pummel (80): Get 2 Strange Revisions. (Once per Combat)" | A hero-level Pummel. Every hit any friendly minion lands adds to one tally, read at the keyword's own damage site (`noteDamageDealt`), with Heavy Hand's share. Lifetime (carried across combats, `AncientsState.pummelDealt`), once per combat, and the 2 Strange Revisions fly to hand on the crossing hit, mid-fight. |
| Genesis | "Empowerment costs 3g. You also get a copy of the chosen minion sent to your hand." | The `power` override sets the cost to 3. After the pick replaces the offer, a plain copy goes to hand (board if the hand is full). |
| Time | "Empowerment becomes Start of Turn: Discover a minion from the tier above you." | The `power` override makes Empowerment passive. Every Start of Turn queues a Discover of exactly Shop tier + 1 (`exactTier`), on its own Start of Turn beat. |
| Bonds | "Playing odd tier units grants +3/+3 to friendly odd tier units. Playing even tier units grants +3/+3 to friendly even tier units." | `playCard` (the "played from hand" chokepoint) gives every OTHER board minion of the same tier parity +3/+3, permanently, with buff tendrils from the played minion. |

## How it is wired

- **Registry** (`packages/sim/src/ancients.ts`): an `albus` block and six new `AncientEffect` variants. One Shop hook,
  `ancientOnEmpowerPick`, called from `takeDiscoverPick` both where the pick replaces the offer and on the fall-through
  to hand (the targeted offer was gone behind a queued Discover). Time's half lives in `ancientStartOfTurn`
  (`albusStartOfTurn`, through `recordSotBeat`). Bonds is `ancientOnPlay` in `playCard`.
- **Combat** (`@game/core`): `QuestCombatMods.ancientPummel`, the per-side tally + once-per-combat latch in `simulate`
  (`noteAncientPummel`, called at the top of `noteDamageDealt`), and a carry-back `ancientPummelDealt` →
  `CombatResult.playerAncientPummelDealt`, present only when the mod is on, so every other result is byte-identical.
- **Live text**: `{timeTier}` (Time's tier), `{pummelNow}` / `{pummelEvery}` (War's progress, `total mod 80`, the
  Pummel badge rule). During a fight the War readout adds the replay's friendly damage so far
  (`CombatQuestDelta.friendlyDamage`, folded from the `dmg` events whose dealer is a player body, Heavy Hand applied in
  `StatusBar`), so it ticks with each hit (R-REALTIME-01). Genesis' 3 Gold rides the cost coin; Fortune's 0 rides the
  offer's price coin.
- **Oracle**: R-ANCALBUS-01..06 in `packages/rules/src/registry/approved/heroes.ts`.
- **Tests**: `packages/sim/src/ancientsAlbus.test.ts`.

## Judgement calls (open for the owner)

- **Bonds excludes the played minion** ("your OTHER odd-tier minions"), the Forest Colossus / Warden Bonds "another"
  precedent. Bonds is Shop-only: combat has no play from hand (a Spirit hand summon is a summon, not a play).
- **Time at the top tier** clamps the way Empowerment already does: at Tier 6 it Discovers Tier 6 (Tier 7 with access).
  The "previous only" ruling was about Risen's summon count and does not apply here.
- **War's scope** is every friendly minion's landed damage (a hero Pummel has no single body), lifetime like the
  keyword, with Heavy Hand's extra share. No `pummelTrigger` flash is emitted (that event is per-body and keyed to a
  minion's own meter effect); the two cards flying to hand are the visible beat.
- **Death with the Genesis copy** cannot happen: one Ancient per run. Each hook still handles the other's case.
- **Wishbone / Rune of Empowerment**: Empowerment's tier step doubles as before; the Genesis copy and Fortune/Death apply
  to the one pick. Time's passive Start of Turn Discover is not doubled (like the Auctioneer's passive Time).
