# 2026-11-10: Ancients × Underdweller, Membrance, Gorun, Mimic (batch C)

Twenty-four Ancient pairings for four heroes, in the owner's words. Still dev-only (the Scene Builder's Set 3 flag,
`enableAncients`): every hook returns early unless the run has Ancients on. Data in `ANCIENT_PAIRINGS`, hooks in the
"2026-11-10 BATCH C" section at the end of `packages/sim/src/ancients.ts`, combat halves in `simulate.ts` (all read per
side off `modsFor`). Rules R-ANCUNDER / R-ANCMEMB / R-ANCGORUN-01..06 and R-ANCMIMIC-00..06; tests
`ancientsUnderdweller|Membrance|Gorun|Mimic.test.ts`. Batches A and B (other heroes) were written in parallel.

| Hero | Ancient | What it does |
| --- | --- | --- |
| Underdweller | Death | A Soulkeeper pick with an Echo gains Rise (the Discover is tagged `'soulkeeper'`, `ancientOnDiscoverTaken`). |
| Underdweller | Fortune | Soulkeeper costs 0 (the pairing's `power` override; no primitive). |
| Underdweller | War | Combat logs every true death, both sides, as the body died (`QuestCombatMods.ancientGraves` -> `CombatResult.playerAncientGraves`, kept on `lastCombat`). The pick takes the first matching grave's Attack, max Health and keywords. |
| Underdweller | Genesis | After the pick lands, a plain copy of a random option not picked (`ancientAfterDiscoverTaken`). |
| Underdweller | Time | The first true enemy death comes home as a plain copy when the fight ends (`ancientFirstFoeDeathCopy`, beside Re-Pete × Death's claim). |
| Underdweller | Bonds | At the reducer's action boundary (`ancientOnCardsGained`): a minion that arrived in hand and matches a board minion's card gives both +X/+X; X starts at 2 and improves by 2. |
| Membrance | Death | A Memory offer with an Echo carries Rise (`ShopCard.keywords`, baked in at the buy). |
| Membrance | Fortune | Memory offers cost 2 (the offer's own `cost`). |
| Membrance | War | Memory offers are exact copies of the opponent's opening bodies (stats via `addOfferBuff`, keywords, Gilded) at 6 Gold. |
| Membrance | Genesis | The first Memory offer bought each turn (`ShopCard.memory`, `memoryBuys`) also gives a plain copy. |
| Membrance | Time | Start of Turn: a plain copy of a random minion from the last opponent's opening board (own beat). |
| Membrance | Bonds | Buying a minion whose card stood on your board before the buy gives your Gilded board minions +5/+5. |
| Gorun | Death | A dying friendly minion's Attack goes to a random friendly minion: a combat buff in combat (`deathWatchers`), permanent in the Shop (`ancientOnShopDeath`). |
| Gorun | Fortune | One running attack count across fights (`gorunAttacks`); every 5th banks 1 Gold for the next Shop (`bonusGold`) and pulses a flag. |
| Gorun | War | Blade Mastery's grant gives the same Health. The owner's Alt line was NOT built. |
| Gorun | Genesis | Start of Combat: the two left-most gain Ward and Flurry for that combat. |
| Gorun | Time | Start of Combat: every minion gains the current Blade Mastery grant once; no attack is counted. |
| Gorun | Bonds | Each attacker also gains the previous attacker's own Blade Mastery grant (never a carried one). |
| Mimic | Death | Soren's Reclaim, aimed automatically: the left-most Echo body is marked at the top of `socReclaim`. |
| Mimic | Fortune | Robin's Spoils as a passive, inside `bankSpoils`. |
| Mimic | War | Emissary's United Front a second time, through its own block (`ancientUnitedFront` = `spellsCast`, the run-lifetime count). |
| Mimic | Genesis | No automatic Start of Turn offer. Mimicry takes the slot back each turn as a pressable power that offers 4. |
| Mimic | Time | Start of Turn: a plain copy of a random minion that died last combat, either side (`lastCombatDeaths`). |
| Mimic | Bonds | Gorr's Four Peat as a passive, inside `gorrQuestBuy`. |

## Decisions a future session would otherwise re-derive

- **Mimic's pairing is Mimic's own.** `ancientPairingHeroId` returns the Mimic for a native Mimic, whatever it wields.
  Before this, a Mimic read the pairing of the power of the day (R-HERO-POWER-REPLACED-02). Every other hero is unchanged.
- **The four "borrowed power" pairings are second invocation paths, not copies.** Each one runs the other hero's own code:
  `socReclaim`, `bankSpoils`, the United Front block, `gorrQuestBuy`. They stack with a wielded copy of the same power.
  A minion marked by both Reclaims is Reclaimed once (one `resummon` flag).
- **`bladeGrantOf(side)`** is now the one expression for Blade Mastery's grant in `simulate` (the attack block and Time's
  Start of Combat read it).
- **`lastCombatDeaths`** (ancients.ts) is the one walk of the last combat's death log; the reducer's `diedLastCombat`
  (Soulkeeper's pool) is its distinct cards.
- **"Improve this" with no stated step** improves by the printed amount (+2/+2), the Soren × War / Gorr × Bonds
  convention.
- **Ancient Start of Combat effects stay combat-only.** None of them is in `socRuneReplaysOf` (the Shop's replay list),
  and this batch follows that, Mimic × War included.
- **Player-only.** `ancientCombatMods` rides the player's fight only (never a snapshot), as every Ancient does. The
  simulator halves are per side, so a served board that carried the mods would behave the same.

## Open for the owner

See the PR body: the assumptions list (which body's stats War keeps, the improve step, what counts as "getting" a copy,
Mimic × Time's either-side pool, the pick turn of Mimic × Genesis).
