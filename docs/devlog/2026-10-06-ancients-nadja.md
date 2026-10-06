# 2026-10-06: Ancients × Nadja

Nadja's six Ancient pairings (hero id `nadja`, power **Goldspring**, kind `gainMaxMana`, 3 Gold, untargeted: "Gain 1
maximum Gold."), in the owner's words. Still dev-only (the Scene Builder's Set 3 Ancients flag), so there is no patch
note.

What Goldspring already did: `maxGoldBonus += reps` in the reducer's `gainMaxMana` branch (the Gold Font / Shop License
channel, ABOVE the natural 10 and **uncapped**; Rune of Wishbone / Empowerment repeat it). Every "max Gold" below is that
same channel, so none of them has a cap either.

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Goldspring becomes: Avenge (6): Gain 1 max gold." | Goldspring turns passive (`power: { passive: true }`; the reducer refuses a passive click). A hero Avenge (6) on ONE running count across the Shop and combat (`nadjaDeaths`, the Gorr / Xerox Death shape). Shop deaths tick at `fireOnFriendDeath` and pay right then (the Gold pill's coin burst). Combat: `QuestCombatMods.ancientMaxGoldAvenge`, a `maxGold` float per fire, Rune of Fury repeats; the fires come home as `CombatCarryBacks.ancientMaxGoldFires` and pay at settle. Prints the deaths left and the max Gold so far, live through a fight. |
| Fortune | "Goldspring can be used twice per turn and costs 2 gold." | No new primitive: the `power` override `{ cost: 2, usesPerTurn: 2 }` (Fibbsy's per-turn budget). `AncientPowerOverride` grew `usesPerTurn`. Prints the uses left; the power badge shows "N left". |
| War | "Start of Combat: Your left-most minion gains Rally: give your minions +3 attack per gold spent this turn." | `QuestCombatMods.ancientSocRally` with the Attack already folded (3 x `goldSpentThisTurn`, the Shop turn that just ended, Baby Gastrid's read). At Start of Combat the left-most living minion gains Rally and a grafted `rallyBuff` (registered explicitly, Contract Rewrite's shape), so Rally doublers repeat it. `rallyBuff` grew two opt-in params: `self` (the Rallying minion counts too) and `fixed` (a Gilded body gives the same). Combat body only. Prints the Gold spent and the Attack. |
| Genesis | "Goldspring also grants a random minion." | After the +max Gold, `ancientAfterGoldspring` conjures a random minion (the run's pool, your Shop tier or lower, your types: Haven Drake's pick) to hand through `conjureToHand`, once per Goldspring fire. |
| Time | "Goldspring becomes: End of Turn: Gain +1 max gold." | Data only: Goldspring turns passive, and Robin's `eotMaxGold` primitive (the `ancientRobinMaxGold` recurring End-of-Turn entry) does the rest. Prints the total. |
| Bonds | "Give 2 random minions +2/+4 whenever you spend gold." | `ancientOnSpendGold` in the reducer's `spendGold` (THE Gold-spend chokepoint), above Rune of Bulk Order's early return: every spend of 1+ Gold gives 2 distinct random board minions +2/+4, permanently. |

## How it is wired

- **Registry** (`packages/sim/src/ancients.ts`): a `nadja` block, four new `AncientEffect` variants (`avengeMaxGold`,
  `socRallyPerGoldSpent`, `goldspringGrantsMinion`, `spendGoldBuffsRandom`; Time reuses `eotMaxGold`), hooks
  `ancientNadjaShopDeath`, `ancientNadjaAvengeLeft` (joins the shared Avenge disc), `ancientNadjaRallyAttack`,
  `ancientAfterGoldspring`, `ancientOnSpendGold`. New `AncientsState` fields: `nadjaDeaths`, `nadjaDeathGold`.
- **Combat** (`@game/core`): two mods (`ancientMaxGoldAvenge`, `ancientSocRally`) and one carry-back
  (`ancientMaxGoldFires` / `playerAncientMaxGoldFires`). Both mods are armed in Doc Bot's combat-mod scanner.
- **UI**: one line in `StatusBar.tsx` (Fortune's "N left" badge). Everything else reads the shared power text.
- **Oracle**: R-ANCNADJA-01..06 in `packages/rules/src/registry/approved/heroes.ts`. **Tests**:
  `packages/sim/src/ancientsNadja.test.ts`.

## Judgement calls (open for the owner)

- **Death counts Shop deaths too** (R-PHASE-01: one count across both phases, like Gorr and Xerox). A combat fire's max
  Gold is paid when the fight settles; it is next turn's Gold either way.
- **No cap** on any max Gold here: Goldspring itself has none.
- **Fortune**: each of the two uses gives its own +1 max Gold (2 Gold each, so 4 Gold for +2 a turn).
- **War**:
  - "This turn" in combat = the Gold spent in the Shop turn that just ended.
  - The Rally is granted for that fight only (Start of Combat, every fight).
  - "Your minions" includes the Rallying minion itself.
  - The Attack is a combat buff (gone after the fight).
  - Nothing spent: no Rally at all.
- **Genesis**: a random minion of your Shop tier or lower, your types, to hand (not the board, not a Discover).
- **Bonds**: once per spend, never per Gold (a 3-Gold buy pays once). Board minions only, 2 different ones. Goldspring's own
  cost is a spend, so it pays too.
