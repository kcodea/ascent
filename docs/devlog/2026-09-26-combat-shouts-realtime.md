# 2026-09-26 — Every combat Shout resolves in real time (R-REALTIME-03)

Owner ruling: *"all shouts should be real time in combat, regardless of what they do/are. theres no point in
delaying any of them and they may be important to trigger other combat effects like gangplank's to hand
watcher."*

## Before

`replayCombatBattlecry` (core/effects/factories.ts) ran a Shout's `onPlay` effects live in combat ONLY when the
`do` id had a combat `FACTORIES` entry. Every other id was "economy": recorded with `ctx.deferBattlecry` and
replayed through its recruit factory at settle, after the fight. 26 onPlay ids in content were in that set. Cards
they gave arrived after the fight (so Gangplank never saw them mid-fight), and several replays were silent no-ops
at settle because they ran against a throwaway `ryme-bc` stand-in card (Astral Relay could not find its own slot,
Double Dealer armed a card that did not exist).

Three combat sites (Rune of Shared Scripture, the War Chorus, Rune of Ancestral Roar) call the onPlay
`FACTORIES` directly instead of going through `replayCombatBattlecry`, so for them a non-factory Shout was not even
deferred: it was dropped.

## After

**17 ids converted to combat-live** (a `FACTORIES` combat half each, under "SHOUTS IN REAL TIME"):

| Shout | Card(s) | Combat behaviour |
|---|---|---|
| `battlecryGetHandSpell` | Defender | Tower Shields to hand via `grantToHand` (live toHand + hand reactors) |
| `battlecryGrantRandomReveler` | Revelator | a random Reveler to hand, live |
| `battlecryDiscoverTribeIfControl` | Branch Manager | if another Spirit lives: a random Spirit to hand (the combat Discover rule, owner 2026-08-08) |
| `battlecryCopyCastSpell` | Recaller | copies of the turn's first/last spell to hand, live |
| `getEchoAndTrigger` | Crypt Broker | the Echo minion reaches hand live; its Echo fires on the arrived card at settle |
| `battlecryBuffRandomTribePlusReveler` | Limelight | combat buffs incl. the side's Reveler value |
| `battlecryBuffTargetPerGoldSpent` | Baby Gastrid | combat buff scaled by the turn's Gold spent (+ Rune of Full Measure) |
| `battlecryScoutSpread` | Squirl Scout | improves the snowball live, buffs this fight, growth carried back once |
| `battlecryDoubleNextSpell` | Nimbus | next-spell extra cast banked on the beat |
| `battlecryBuffNextSpell` | Sugarnova | next-spell +A/+H banked on the beat |
| `battlecryArmGrimoire` | Living Grimoire | the charge armed on the beat |
| `buffShopPermanent` | Contract Butcher, Malphas | permanent Shop buff granted live, applied at settle via `applyRunShopBuff` |
| `buffThisShop` | The Great Attractor | "this shop" banked on the NEXT shop (the combat shop-buff spell rule, 2026-08-07) |
| `battlecryBuffThisShopPerSpellsThisTurn` | Rocket Power | same, `1 + spells` ticks |
| `battlecryCopyEcho`, `battlecryGildTarget`, `battlecryDestroyForSpell` | Gravetwin, Auric Runemaster, Graverobber | targeted Shouts: a re-fire has no target in either phase (the Shop's `replayBattlecry` passes none), so it resolves the same way the Shop one does: nothing. Registered so they are no longer deferred |

**9 Shop-only exceptions** (`SHOP_ONLY_SHOUTS`, each with its reason): `armChooseBoth` (Double Dealer),
`battlecryAllDemonsConsume` (Herald of the Apocalypse), `battlecryCollapseStarform` (Solburn),
`battlecryConsumeShopRandom` (Cinder Clerk), `battlecryCreateStarformOrBuff` (Star Seed),
`battlecryStarformConsumeShop` (The Great Attractor), `battlecryTargetConsumesShop` (Appetite Agent),
`buffRightmostSlotPermanent` (Market Tormentor), `triggerAdjacentOrbits` (Astral Relay). Each logs its line on
the beat (the Shout counters and watchers already fired), and settle replays ONLY those ids, once, now acting as
the Shout's own run card (`deferBattlecry` carries the body's `sourceUid`; `replayEconomyBattlecry` uses the board
card with that uid when it is still there). The three direct-dispatch sites now call `deferShopOnlyShout` too.

## Plumbing

- `CombatContext`: `grantNextSpellExtraCasts`, `grantNextSpellBonus`, `armGrimoire`, `grantScoutBuff` /
  `scoutBuffFor`, `grantRunShopBuff`, `grantToHandThenEcho`, `revelerValueFor`, `goldSpentThisTurnFor`,
  `lastSpellThisTurnIdFor`, `fullMeasureFor`; `deferBattlecry` gained `sourceUid`.
- One new carry-back record, `ShoutCarry` → `CombatResult.playerShoutCarry` (and the side carry for self-play),
  folded in once by `settleCombat`.
- `CombatSideState` gained `goldSpentThisTurn`, `lastSpellThisTurnId`, `squirlScoutBuff` (reducer, bot mirror,
  snapshot capture and `boardSide` all thread them); `QuestCombatMods.runeFullMeasure`.
- `grantRandomSpell` / `grantRandomMinion` now fire the hand-grant reactors (`emitGainCard`) like `grantToHand`
  does. Previously a combat Discover Shout (Mysterious Joker, Sea Urchin, Black Belt Brian…) put a card in hand
  mid-fight without waking Gangplank. This changes RNG consumption in fights that have such a grant and a hand
  watcher.
- `NO_COPY_SPELLS` (sim) is now the core `NO_COPY_SPELL_IDS` set, so the two copiers cannot disagree.

## Player-visible differences

- Cards from combat Shouts arrive during the fight and wake hand watchers then.
- Board buffs from a combat Squirl Scout / Limelight / Baby Gastrid re-fire are now combat gains (like every other
  combat Shout's stats), no longer permanent Shop buffs added after the fight.
- A combat Great Attractor / Rocket Power "this shop" buff lands on the next Shop's offers instead of the old row.
- Astral Relay and Double Dealer re-fired in combat now actually do their Shop part at settle (they were silent
  no-ops against the stand-in card).

## Verification

`combatShoutsRealtime.test.ts` (content walk: every onPlay id is combat-live or a reasoned Shop-only exception;
focused: Defender + Gangplank mid-fight, Branch Manager, Revelator, Tidebud hand buff, Pimm Gold, Nimbus, Baby
Gastrid; end to end through the reducer with Auctioneer × Time: Defender, Contract Butcher, Squirl Scout, Nimbus
and Star Seed each applied exactly once at settle). Oracle R-REALTIME-03; R-REALTIME-02 points to it.

## Open questions for the owner

- Targeted Shouts re-fired without a target (Gravetwin, Auric Runemaster, Graverobber) do nothing in both phases.
  Baby Gastrid and Appetite Agent auto-pick a random target on a re-fire (owner report 2026-08-25); say if these
  three should too (it would change the Shop re-fire as well).
- Herald of the Apocalypse's Consume stays Shop-only (Consume and its watchers are Shop mechanics). A combat
  version would be a temporary stat gain with no `onConsume` watchers.
