# 2026-09-26: Ancients × the Auctioneer

The Auctioneer's six Ancient pairings (hero id `myra`, power **Pulse**: "Trigger a friendly minion's Shout."), in the
owner's words, built on the Ancients proof of concept ([2026-09-25](2026-09-25-ancients-mvp.md)) and mirroring the
Warden's pairings ([2026-09-26](2026-09-26-ancients-warden.md)). Still dev-only (the Scene Builder's Set 3 Ancients
flag), so there is no patch note (the Warden PR added none either).

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Pulse triggers the chosen minion's Shout an additional time, then destroys it." | Pulse fires the Shout twice (each through `replayBattlecry`, so a gild / Drakko applies to each), then `destroyMinionInShop` (a real Shop death: Echo, death watchers, Rebirth / Rise). |
| Fortune | "Whenever you trigger a Shout during the Shop phase, gain 1 Gold next turn." | Every Shop Shout FIRE (hand play, Pulse, any replay, End-of-Turn replays; each Drakko repeat) adds 1 to `bonusEmbersNextTurn` the moment it fires. Combat Shouts do not count. The power text prints the Gold banked this turn (`AncientsState.shoutGold`). |
| War | "The minion you Pulse gains 'Rally: trigger this minion's Shout'" | Pulse fires the Shout, then the target gains the `RL` keyword and a grafted `rallyTriggerOwnShout` in `grantedEffects` (so it rides into combat, snapshots and replays). The card prints it as a blue note. |
| Genesis | "Pulse becomes: 2g - Discover a Shout minion." | Pulse becomes untargeted, 2 Gold, once per turn: a Discover of Shout minions at your tier or below (`filter: 'battlecry'`, the Help Wanted convention). |
| Time | "Pulse becomes passive. Start of Combat: trigger your left-most and right-most Shouts. If you have only one Shout, trigger it once." | Pulse is passive. At Start of Combat the left-most and right-most living Shout minions fire their Shout once each through `fireShout` (Drakko folded, `battlecryTriggered` emitted); one Shout minion fires once. |
| Bonds | "Shout triggers buff adjacent minions +4/+3." | Every Shout fire gives the minions next to the Shouting minion +4/+3 in real time. Shop: permanent (`fireBattlecryTriggered`). Combat: a `battlecryTriggered` listener buffs the living neighbours right after the Shout (combat-only unless Engraved). |

## How it is wired

- **Registry** (`packages/sim/src/ancients.ts`): a `myra` block, six new `AncientEffect` variants, and a new
  `AncientPairing.power` field, a hero-power SHAPE override (`passive` / `untargeted` / `cost`). `pickAncient` stamps
  it on `AncientsState.powerOverride`, and `activePowers` (heroes.ts) folds it into the native power. So the power
  button, the cost coin, the "PASSIVE" tag, the reducer's cost gate and spend, and the bots all read one shape, with
  no UI change. (heroes.ts cannot import ancients.ts without a cycle, hence the stamp.)
- **Reducer** (`replayBattlecry` branch): Time refuses activation; Genesis queues the Discover; Death replays the
  extra fires and destroys; War grafts the Rally.
- **Shop Shouts**: `fireBattlecryTriggered` now takes the Shouting card and calls `ancientOnShopShout` once per fire
  (Fortune's Gold, Bonds' neighbours). Every shop Shout path walks it: `playCard`, `applyBattlecryTarget`,
  `replayBattlecry`, and the borrowed play (no neighbours: the card is not on the board).
- **New effect primitive `rallyTriggerOwnShout`**: an arena body (`arena.replayShout(self)`, one fire per Rally)
  with combat and shop dispatchers, whitelisted in the content schema and `EffectFactoryId`, with an `ownBeat`
  presentation policy. A gild doubles the Shout's own magnitude, not the trigger count.
- **Combat mods** (`QuestCombatMods`): `ancientEdgeShouts` (Time) and `ancientShoutAdjacent` (Bonds), threaded by
  `ancientCombatMods`. `livingNeighbours` is now exported from `factories.ts` for the Bonds listener.
- **Card text**: `liveCardText` appends `GRANTED_RALLY_SHOUT_NOTE` when the instance carries the graft. The shop chain
  reads `grantedEffects`; combat reads the new display-only `MinionSnapshot.grantedRallyShout`.
- **Oracle**: R-ANCAUCT-01..06 in `packages/rules/src/registry/approved/heroes.ts`.
- **Tests**: `packages/sim/src/ancientsAuctioneer.test.ts` (each pairing in its phase, real-time ordering for War,
  Time and Bonds in combat) and `packages/ui/src/ancientsAuctioneerText.test.ts`. The "no pairing" case in
  `ancients.test.ts` moved from the Auctioneer to Soren.

## Judgement calls (open for the owner)

- **War does not stack.** A second Pulse on the same minion does not give it a second Rally.
- **War's Rally fires the Shout once per attack**, not twice on a gilded minion (the gild already doubles the Shout).
- **Death with Rune of Wishbone**: each Pulse fire gets its extra Shout (2 fires become 4), then one destroy.
- **Time picks both edges once, up front**, then fires them left to right. A Shout that kills or summons does not
  re-pick the other edge.
- **Time and the Shop**: Time's Shouts are combat Shouts, so Fortune would not count them (moot: one Ancient per run).
- **Bonds in the Shop buffs the minions directly next to the Shouter on the board** (a Shout played from hand buffs
  its new neighbours). In combat it is the nearest LIVING neighbour on each side.
