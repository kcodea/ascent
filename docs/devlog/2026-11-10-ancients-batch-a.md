# 2026-11-10: Ancients batch A (Rascal, Gambler, Pete, Foreman Flint, Juggler)

Thirty Ancient pairings for five heroes, in the owner's words. Still dev-only (the Scene Builder's Set 3 flag,
`enableAncients`): every hook returns early unless the run has Ancients on. Data in `ANCIENT_PAIRINGS`, hooks in the
"2026-11-10 batch A" section at the end of `packages/sim/src/ancients.ts`. Rules R-ANCRASCAL / R-ANCGAMBLER / R-ANCPETE /
R-ANCFLINT / R-ANCJUGGLER-01..06; tests `ancientsRascal|Gambler|Pete|Flint|Juggler.test.ts`.

Batches B (Kindness, Merrin, Emissary, Emerald Warden) and C (Underdweller, Membrance, Gorun, Mimic) were written at the
same time in sibling worktrees. Merge order A, B, C. This batch keeps every edit additive: one `batchA*` call per
existing chokepoint and one section at the end of the file.

| Hero | Ancient | What it does |
| --- | --- | --- |
| Rascal | Death | All In has 3 uses (`power.maxUses`). Hero Avenge (4), one running Shop + combat count: each fire adds 1 Gold to All In's NEXT payout (`rascalPot`, read by `allInPayoutOf`, cleared when All In pays). Combat pulses Cassen's `ancientAvengePulse`; settle adds. |
| Rascal | Fortune | All In has 3 uses and grows 2 MORE per turn (4 in all), in `allInPayoutOf`. |
| Rascal | War | `ancientAfterAllIn`: every board minion gains +2/+1 per Gold paid, one grant from the power button. |
| Rascal | Genesis | `ancientAfterAllIn`: one Discover of a minion of exactly your Shop tier per 5 Gold paid. |
| Rascal | Time | All In passive; Start of Turn +4 Gold on its own beat (`recordSotBeat`). |
| Rascal | Bonds | `spendGold` (`ancientOnSpendGold`): each spend of 1+ Gold gives the left-most and right-most minions +2/+1. |
| Gambler | Death | Hero Avenge (4): the Dice lock ends 1 turn sooner (`heroDiceLockUntil`). Shop right then; combat by pulse, at settle. |
| Gambler | Fortune | The `dice` branch draws a second die: Gold is both, the lock is the lower. No second draw on any other run. |
| Gambler | War | `ancientAfterDice`: +3/+3 per pip to every board minion. |
| Gambler | Genesis | `ancientAfterDice` casts Gamble (`castSpell`) with the roll handed in (`forcedGambleRoll`, read by `spellGambleTierPull`). |
| Gambler | Time | `offerBuyPrice`: while the lock runs, the turn's first minion costs 1 less. |
| Gambler | Bonds | `ancientAfterDice`: a Discover of a minion of exactly the rolled Tier. |
| Pete | Death | Tradesman's `avengeFreeRefresh` (3), reused. |
| Pete | Fortune | Buying a Contrabanana minion (`ShopCard.banana`) banks a free Refresh. |
| Pete | War | The Contrabanana offer gains one random keyword it lacks (Keshi × War's pool), on `ShopCard.keywords`. |
| Pete | Genesis | The `roll` branch upgrades the 2 right-most minion offers. |
| Pete | Time | Contrabanana every 2 Refreshes (`ancientContrabandEvery`; StatusBar shows n/2). |
| Pete | Bonds | `upgradeRightmostOffer`'s pool is narrowed to your most common type. |
| Flint | Death | Hero Avenge (4): a random Dwarf (your Shop tier or lower) to hand. Combat: Gorr's `ancientGorrAvenge` over the Dwarf pool. |
| Flint | Fortune | The turn's first Dwarf is free (`offerBuyPrice`'s `freeBuy`, the shared marker). |
| Flint | War | Start of Combat: Dwarves gain +1/+1 per Dwarf bought this game (Braum's `ancientSocBuffAll`, now with an optional `tribe`). |
| Flint | Genesis | The turn's first Refresh draws only Dwarves (`rollTribe`, Frank × Genesis' channel). Picked mid-turn, the next Refresh is it. |
| Flint | Time | End of Turn: +3/+3 per Dwarf bought this turn (Ayse's virtual End-of-Turn entry, counting Dwarves). |
| Flint | Bonds | Buying a Dwarf gives your OTHER board Dwarves +2/+2. |
| Juggler | Death | Gildmaster's `avengeGrantCard` (4), reused, with the Carnival Coin. |
| Juggler | Fortune | A Carnival Coin gives 3 Gold (`castSpell`'s Gold step). |
| Juggler | War | Each Coin cast banks +1/+1 onto later Coins (`jugglerCoinBonus`, added in `spellBuffAll`). |
| Juggler | Genesis | A Coin every 2 minion buys (`ancientCoinNeed`; StatusBar shows n/2). |
| Juggler | Time | The turn's first 2 minion buys each also give a Coin. |
| Juggler | Bonds | A minion of your most common type counts twice in `jugglerBuy`; the count past a payout carries over. |

## Plumbing worth knowing

- **One core change.** `QuestCombatMods.ancientSocBuffAll` takes an optional `tribe` (Flint × War). Everything else in
  combat reuses mods that already existed (`ancientAvengePulse`, `ancientGorrAvenge`, `ancientRefreshAvenge`).
- **Flint × Time shares Ayse's End-of-Turn entry** (`ancientAyseTime`). The two can never be live together, and one
  entry meant no new union member, beat spec or label in `recruit.ts` / `state.ts`, which three batches would have fought over.
- **Carnival Coin text.** `carnivalCoinLive(run)` feeds `spellDisplayText`'s new `carnivalCoin` option, threaded through
  the two text builders in `Recruit.tsx` and `instView.ts`, so the hand, the Discover and the fly-in all print it.
- **The Dice die tumbles for a new roll only.** StatusBar keyed the tumble on any change of `heroDiceLockUntil`; Gambler ×
  Death shortens the lock, so the effect now ignores a lock that moved earlier.
- **`jugglerBuy` takes the bought card id** and carries a count past the payout (`n - need`). On every other run that is
  the old reset to 0.

## Judgement calls (flagged to the owner)

1. **Rascal Fortune, "climbs by 2 per turn".** All In already grows by 2. Built as 2 MORE (4 per turn), since "gains a
   use" alone would be a weaker Death. The other reading (no change to the growth) is one number.
2. **Rascal Death, "add 1 gold to All In".** Built as Gold added to the NEXT payout, spent when All In pays (the pot
   reading). The other reading is a permanent +1 to every later payout.
3. **Rascal Bonds** is a passive added to All In (All In still pays). Each spend counts once, never per Gold (Nadja ×
   Bonds' rule).
4. **Rascal War / Genesis** count the Gold actually paid, Rune of Wishbone's repeat included.
5. **Gambler Fortune** shows one die on the button (the lower one, the lock). Both dice are in the power text.
6. **Gambler War with Fortune** cannot happen (one Ancient per run), but the code counts the pips of every die rolled.
7. **Gambler Time** counts the turn you roll as locked, and the Starform as a minion.
8. **Gambler Bonds** offers the rolled Tier exactly, even above your Shop tier (a 6 offers Tier 6 on turn 1).
9. **Pete War** uses Keshi × War's keyword pool (the only owner-written "random keyword" pool).
10. **Pete Time** switches the modulus on the running Refresh count, so the first Contrabanana after the pick can come
    one Refresh early or late.
11. **Pete Bonds** falls back to the ordinary draw with no type on the board.
12. **Flint Death / Juggler Death** grants are hand grants; a full hand gets none (the Gorr / Gildmaster rule).
13. **Flint Genesis** is the player's Refresh (the `roll` action), never the turn-start Shop. Spell and Starform slots
    are untouched.
14. **Flint Bonds** is board only (the bought Dwarf is in hand and not "other").
15. **Juggler War** improves by Rune of Mastery's repeat too, and only Shop casts exist (Coins are cast from hand).
16. **Juggler Time** Coins are not doubled by Rune of Wishbone (they are the Ancient's, not the power's own trigger).
17. **Juggler Bonds** carries the extra count past a payout instead of dropping it.

## Verification

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build:web`, plus `text:audit`, `docbot`, `audit` and
`beats:audit`. 76 new tests across the five files: every pairing through the real reducer / simulator with a control
that fails without the effect, the meter pick flow, a JSON round trip and a same-seed replay.
