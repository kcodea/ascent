# 2026-11-13 - Set 2 rune batch, Basic tribal (14 runes)

One slice of the owner's 40-rune Set 2 batch (design: `docs/design/2026-11-12-set2-rune-batch.md`, review 2026-11-12). All
fourteen are Basic (`RUNES`), `sets: ['set2']`, gated to their tribe. No art wired. No patch note here (the coordinator
writes one for the batch). Oracle: R-SET2-TRIBAL-RUNES-01..05. Tests: `packages/sim/src/set2RunesBasicTribal.test.ts`.

| Rune | Tribe, cost | Built from |
| --- | --- | --- |
| Deep Pockets | Dwarf 3 | `runeThreshold` gold per 8, `grantRandomTribe: 'dwarf'`, `resetEachTurn` + `oncePerTurn` |
| Rowdy Crowd | Dwarf 2 | `runeThreshold` cardsPlayed per 4, `resetEachTurn` + `oncePerTurn`, `tribeBoard` Dwarf +2/+2 |
| Bloodscent | Beast 1 | combat flag; the Slaughter block, `permaGain` |
| Last Howl | Beast 3 | combat flag; the `avenge` broadcast (after the Echo), `summonMinion` from the def |
| Trophy Hunter | Beast 2 | combat flag; the Slaughter block, `grantBonusGold`, 3 per combat per side |
| Pitchforks | Demon 4 | combat flag; `summonEntryEffects` (every Imp arrival) |
| Imp Legion | Demon 3 | combat flag; NEW factory `deathrattleDamageLowestEnemy` (ARENA_EFFECTS), grafted Shop + combat |
| Guel's Apprentice | Demon 2 | `recurringGrant ['staffofguel']` |
| Collections | Demon 3 | flag; `settleMinionSale` → `applyRunShopBuff` |
| Flamekeeper | Dragon 1 | flag; Shop `castSpell`, combat `spellResolved` |
| Hatchling Roost | Dragon 2 | flag; a price cap in `offerBuyPrice` (the coin reads it too) |
| Dragon Hoard | Dragon 1 | `recurringEndOfTurn` effect `runeDragonHoard`; new wave-tagged `shopSpellCasts` count |
| Ruby Dust | Kobold 2 | combat flag; the `avenge` broadcast, `rubyOnRandomKobolds(…, permanent)` |
| Rough Cut | Kobold 2 | flag; Shop `fireOnRubyPlayed`, combat `playRubyOn` (new ctx hook `roughCutCopiesFor`) |

Shop halves: `packages/sim/src/set2RunesBasicTribal.ts`. Combat halves: `simulate.ts` "SET 2 RUNES, BASIC TRIBAL", declared
before the first Start of Combat pass so a Start-of-Combat summon or death already hears them. Shared numbers:
`packages/core/src/set2TribalRunes.ts`.

## Engine notes

- `resetEachTurn` on threshold runes was declared but never read. It is now read at turn setup (`tick = 0`).
- Trophy Hunter's combat badge shows `x/3` (the replay's trigger count, passed into `runeCombatTally`).

## Interpretations (flag to the owner)

- **"Kills" = a Slaughter** (the attacker's strike or cleave), the Rune of the Trophy reading. A Beast that kills its
  attacker by retaliation does not count. Bloodscent needs the Beast alive after the clash.
- **"Your Dwarves" / "your Dragons" = the board** (the Gator's Bite ruling), not the hand. Combat: living board Dragons.
- **Pitchforks and Imp Legion are inert in the Shop.** The doc assumed Pitchforks fires in the Shop too, but the code's
  rule is that the Shop has no enemies (`arena.enemies()` is empty). Combat only in practice.
- **Ruby Dust: "a minion with Rubies" = a friendly minion.** Set 2 has no friendly Shop deaths, so it is combat only.
- **Copies.** Last Howl: one body per copy, from the first death (the Second Litter precedent). Trophy Hunter: the cap
  stays 3 kills, each paying 1 Gold per copy. Every other rune multiplies its payout per copy.
- **Last Howl on a Rise death:** a Rise death is a real death, so it can trigger; both the Rise and the resummon return.

## Balance watch

Guel's Apprentice at cost 2 (a +3/+3 Shop buff every turn) and Bloodscent at cost 1 were already on the doc's watch list.
Pitchforks stacks with Imp-summon engines (Open the Gates, Knocked, Imp Overseer): every Imp is 6 damage.
