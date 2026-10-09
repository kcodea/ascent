# 2026-10-09: Ancients × Rayse, Cassen, Drakko, Flash, Gildmaster (+ Cassen loses his rare jobs)

Thirty Ancient pairings for five heroes, in the owner's words, plus one live hero change. The Ancients stay dev-only
(the Scene Builder's Set 3 flag, `sbAncients` → `enableAncients`); the Cassen change is live in every mode.

## Cassen hero change (live everywhere)

Owner: "let's change cassen and remove citadel and fortress so he just has the 3 options instead."
`commissionOffer` now always returns Discover / Gold / Spell. The 25% rare-slot roll is gone, and so is the "never
the one taken last" exclusion (the offer is always the three). `citadel` / `fortress` stay in `CommissionKind`,
`COMMISSION_*` and `payCommissionOnce`, so a save already working one still pays out (tested). The running-commission
line now prints its reward and live due turn (`Working: Gain 2 Gold (due turn 5).`) instead of a stale "In 2 turns",
and the em dash in "Choose one —" became a colon. R-CASSEN-01.

## The pairings

Every hero Avenge (Rayse 4, Cassen 7, Gildmaster 14) is ONE running count of friendly deaths across the Shop and
combat (owner ruling), the Xerox / Gorr / Nadja / Brackus shape: Shop deaths tick it at `fireOnFriendDeath`
(`ancientHeroAvengeShopDeath`), combat carries the count in and settle adds the fight's deaths. Rune of Fury repeats
the combat half. All three share the hero-power Avenge disc (`ancientAvengeCountdown`).

| Hero | Ancient | What it does |
| --- | --- | --- |
| Rayse | Death | Avenge (4): a Sprout (`raysesprout`, a NEW 1/1 neutral token) at the current size, then +1/+1 for later ones. Combat Sprouts are real summons, so Vines' +2/+3 and Taunt land. Shop Sprouts land on the board (full board: overflow). |
| Rayse | Fortune | Summons gain +1 Attack per Gold spent this turn: Shop summons permanently (`ancientOnShopSummon`), combat summons as a combat buff (Robin's `ancientSummonGain`, frozen at the turn that just ended). |
| Rayse | War | The first 3 summons each combat attack immediately (`ancientSummonsAttack`, the R-ORD-05 queue; returns count). |
| Rayse | Genesis | Risen's Genesis with a budget: only the first 2 summons each combat make an extra copy (`ancientSummonExtraLimit`). |
| Rayse | Time | End of Turn: a random friendly minion without Rise gains Rise, permanently (recurring entry `ancientRayseEotRise`). |
| Rayse | Bonds | Each combat summon gives 2 other random friendly minions +3/+3, a combat buff (`ancientSummonBuffOthers`). |
| Cassen | Death | Avenge (7): the running commission lands a turn sooner. A Shop fire that makes it due pays at the next action boundary (`ancientCommissionDueNow`); a combat fire (`ancientAvengePulse`) moves it at settle. |
| Cassen | Fortune | Each payout banks 5 free Refreshes. |
| Cassen | War | Each payout gives the board +8/+8, permanently. |
| Cassen | Genesis | Each payout also gives a random minion of exactly your Shop tier. |
| Cassen | Time | Every commission is due next turn (`commissionDelayOf`); one already running at the pick too. The picker shows "1 turn". |
| Cassen | Bonds | The payout runs twice (`ancientCommissionReps`). |
| Drakko | Death | The run's Drakkos become Undead / Beast via `RunState.cardTribes` (Rune of Drakko still adds Dragon / Spirit). |
| Drakko | Fortune | Shout minions cost 1 Gold less (`offerBuyPrice`, floored at 0). |
| Drakko | War | Start of Combat: 1 + Shouts fired this turn (`shoutFiresThisTurn`) steps, each its own beat, +1/+1 to a random minion. |
| Drakko | Genesis | Drumline completes up to 3 times: 5, then 4, then 3 Shout buys (`ancientDrumlineNeed` / `ancientDrumlineComplete`). |
| Drakko | Time | End of Turn: re-fire the left-most Shout (`ancientDrakkoEotShout`, Echoing Roar's `replayBattlecry` rule). |
| Drakko | Bonds | Every Shout fire gives board Drakkos +2/+2, permanently: Shop at `ancientOnShopShout`, combat via `ancientShoutBuffsCard` (`permaGain`). |
| Flash | Death | With First or Last armed, the 2nd enemy kill is copied too, live. |
| Flash | Fortune | First or Last costs 0 Gold (`power` override). |
| Flash | War | Pummel (400) once per combat on the shared lifetime tally: a copy of a random living enemy minion, live. |
| Flash | Genesis | The claim grants 2 copies (`flashCopies` = Wishbone reps × 2). |
| Flash | Time | Start of Combat: a copy of a random enemy minion, live. |
| Flash | Bonds | Every Flash copy is EXACT: a NEW carry-back, `ShoutCarry.handExact` (index + stats + keywords + Gilded), applied at settle like Braum's `handGilds`. |
| Gildmaster | Death | Avenge (14): a Goldcrafter to hand (combat reuses Gorr's `ancientGorrAvenge` with `ids: ['goldcrafter']`). |
| Gildmaster | Fortune | Braum's `tripleRewardGold` with 5 Gold. |
| Gildmaster | War | Pummel (1000) once per combat (Darah's `ancientPummelCharge` with its own flag): +1 to Gildcrafter's whole-game budget, stored on `powerOverride.maxUses` so the gate and the UI read it. |
| Gildmaster | Genesis | EVERY Triple Reward triggers twice (`grantGoldenDiscover`, guarded by a module flag). |
| Gildmaster | Time | Gildcrafter turns passive; Start of Turn gilds a random non-Gilded board minion (its own beat). |
| Gildmaster | Bonds | Playing a Gilded minion: Gilded board minions +5/+5, repeated once per gild this game (`AncientsState.gilds`), each its own tick. |

## Judgement calls (open for the owner)

- **Rayse Fortune**: Shop summons AND combat summons (cross-phase by default). Combat uses the Gold spent in the turn
  that just ended.
- **Rayse Genesis**: a Rise / Rebirth return counts toward the first 2 (the Risen precedent); the extra copies never
  spend the budget.
- **Rayse Bonds**: the 2 recipients are distinct and never the summoned minion; a combat buff.
- **Rayse Death**: a Shop Sprout on a full board overflows, and the size still grows.
- **Cassen Death**: a combat fire can only move the commission to "next Shop"; a commission already due next turn gains
  nothing from it. A Shop fire that makes it due pays right away.
- **Cassen offer**: "the 3 options" read as always all three (the old "not the one taken last" exclusion is gone).
- **Drakko Death**: Drakko prints no type, so adding Undead / Beast through the union-only `cardTribes` IS the
  replacement. **War**: Shouts fired by End of Turn effects in the same action as the fight are not in the count
  (the turn tally is folded at the action boundary).
- **Flash Death**: needs First or Last armed (an "also" on the claim). **Genesis × Wishbone** multiply (4 copies).
  **Bonds** copies the body's Attack and maximum Health at the moment it died or was copied.
- **Gildmaster Bonds**: gilds made before the pick count (`gilds` ticks from the run's start), so the first Gilded play
  is +5/+5 plus one repeat per gild so far.
- **Snapshots**: like every Ancient, the combat mods ride the PLAYER's fight only (`ancientCombatMods` is never part of
  a snapshot). Permanent results (Rise, stats, Gilded, Drakko's types via `cardTribes`) are ordinary board state and
  serve with the board.
- **FX**: no new FX defs. Recurring End-of-Turn entries and Start-of-Turn beats are hero-sourced `ownBeat`s; combat
  grants are ordinary `buff` / `summon` / `toHand` / `questTrigger` events; Shop grants use the buff-FX capture.

## Wiring

`packages/sim/src/ancients.ts` (30 pairings, 27 new `AncientEffect` variants (plus a `limit` on `summonsSummonExtra`), the batch section at the end),
`packages/core/src/combat/simulate.ts` + `types.ts` (8 new `QuestCombatMods` fields, `ShoutCarry.handExact`),
`reducer.ts` (commission delay / reps / after-hook / due-now boundary, Drumline, Shout discount, Triple Reward repeat,
Flash copies, exact-copy settle, passive Gildcrafter gate), `recruit.ts` (Shop death hook, two recurring End-of-Turn
entries, commission text), `StatusBar.tsx` (Avenge disc for three more powers, Drumline tally, commission picker
delay), the `raysesprout` token, Doc Bot arms + one excused orphan, R-ANCRAYSE / R-ANCCASSEN / R-ANCDRAKKO /
R-ANCFLASH / R-ANCGILD 01..06 and R-CASSEN-01, and one test file per hero.
