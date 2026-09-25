# 2026-09-25 — Set 3 rune batch 3: eleven Kobold / Undead runes, Resonance reworded

**What shipped.** Eleven new Set-3-only runes (`sets: ['set3']`, each tribe-gated), appended at the end of `RUNES` /
`EPIC_RUNES` under a `Set 3 rune batch 3` header so a concurrent roster PR (#1727) meets them at a seam, not inside
its hunks. They JOIN the owner's Set 3 list (`set3RuneList.test.ts`): Set 3 is now **174 runes, 91 Basic / 83 Epic** (after #1727 moved Engraving Gems Epic to Basic).
Rune of Resonance's text is reordered (Start of Turn first); its behaviour is unchanged.

| Rune | Id | Pool | Cost | Gate |
|---|---|---|---|---|
| Rune of Gemmed Decisions | `rune_gemmed_decisions` | Basic | 3 | Kobold |
| Rune of Echoing Kobolds | `rune_echoing_kobolds` | Basic | 3 | Kobold |
| Rune of the Red Storm | `rune_red_storm` | Basic | 4 | Kobold |
| Rune of Rubywire | `rune_rubywire` | Basic | 4 | Kobold |
| Rune of Choices | `rune_choices` | Basic | 3 | Kobold |
| Rune of Combatative Rubies | `rune_combatative_rubies` | Basic | 3 | Kobold |
| Rune of Body Counting | `rune_body_counting` | Basic | 3 | Undead |
| Rune of Storming Veins | `rune_storming_veins` | Epic | 4 | Kobold |
| Rune of Sold Choices | `rune_sold_choices` | Epic | 5 | Kobold |
| Rune of Aggressive Golems | `rune_aggressive_golems` | Epic | 5 | Kobold |
| Rune of Ruptured Rubies | `rune_ruptured_rubies` | Epic | 6 | Kobold |

**Where each one lives (one authoritative hook each).**
- **Gemmed Decisions**: `applyChooseOnePlayed` (recruit.ts), the one resolution hook both the minion and the spell
  Choose One paths reach after the branch resolved. A plain Ruby per copy.
- **Echoing Kobolds**: an aura-style GRAFT on the `grantedEffects` channel (`applyRuneGrafts`: on purchase over board +
  hand, at every arrival, and the action-boundary sweep), so it is a real Echo in the Shop and in combat (Echo
  multipliers and tallies apply). Combat SUMMONS are grafted in `summonMinion` (`graftBatch3Runes`), since a summoned
  body never passed through the Shop. New factory `deathrattleGetRubies` (arena body + both wrappers), combat Rubies
  ride the existing Ruby carry-back (`grantRubies` → minted at settle at the live Ruby strength).
- **Red Storm**: `castSpell`, the one Shop cast chokepoint (the Rune of Lassoing precedent), so every Veinstorm
  resolution pays, whoever cast it and however often it repeats. Veinstorm has no combat cast.
- **Rubywire**: Shop half in `noteSpellCast` behind `isShopPoolSpell` (R-SHOPSPELL-01); combat half in simulate's
  `spellResolved`, the hook Goldilox uses. Rubies go through `playRubiesOn` / `playRubyOn`, the Ruby chokepoints.
- **Choices**: the Prismatic Pick mechanism. One `chooseBothCharges` per copy, armed right after the per-turn clear at
  turn setup, plus one on the turn it is taken. The (Both) text and marker light up for free (they read the charge).
- **Combatative Rubies**: a per-side attack meter in simulate, seeded from the run's `runeCombatativeTick` and ticked
  beside the quest tally's `attack`; every 3rd attack casts a permanent Ruby (`playRubyOn(..., permanent)`) on 2 random
  Kobolds. Settle advances the run meter by `playerQuestTally.attack`, the same count, so they cannot disagree.
- **Body Counting**: Shop half in `fireOnFriendDeath` (every Shop death path calls it exactly once; a sale never does);
  combat half is an `avenge`-bus handler seeded from `runeBodyCountTick`. Settle advances by `playerDeaths`.
- **Storming Veins**: `spellCastsWithout` adds `runeStormingVeins` for `veinstorm` (additive, like every "additional
  time"); `runeExtraCasts` attributes the extra casts to the rune for the cast-actor presentation.
- **Sold Choices**: `fireSoldChoice` (recruit.ts), called from the sell case while the body is still on the board.
- **Aggressive Golems**: the same graft channel, Rally keyword + new factory `rallyGiveAttackToRight` (arena body:
  the next living ally in board order gains the Golem's current Attack).
- **Ruptured Rubies**: `playRubyOn` (factories.ts), the one combat Ruby primitive, via a new
  `ctx.rubyRuptureBouncesFor`; each hop is `applyRubyStats` (stats only, never re-bounces), inheriting permanence.

**Judgement calls (flagged for the owner).**
- *Golden Kobolds under Echoing Kobolds get ONE Ruby.* No house rule doubles a rune-granted Echo on a Gilded body
  (Candlelight Toll's identical "Kobolds: Echo get a Ruby" pays one), so the graft carries `fixed: true`.
- *Combatative Rubies' meter runs across fights* (the ask's suggestion). Attacks only exist in combat, so the rune is
  combat-only by nature; Shop Rally replays are not attacks and do not count.
- *Body Counting*: a Shop destroy, a devour (Orrery / Constellation Broker) and a Shop damage death (Fel Spikes) count;
  a sale never does; a Starform consume eats Shop minions, not friendly ones, so it cannot count. It is NOT an Avenge,
  so Rune of Fury does not double it. The Undead comes from the run pool at or below the tier (All-types bodies
  included, matching the combat grant).
- *Red Storm in combat*: Veinstorm has no combat implementation, so it can only pay in the Shop / End of Turn.
- *Sold Choices*: a body that resolved BOTH branches (a charge, a rune, a golden `chooseBothWhenGolden`) repeats both —
  recorded as `chosenBoth` on the instance (`chosenOption` stays unset so its combined text is unchanged). A branch
  that aims lands on a random other friendly minion. `chosenOption` already survived into served snapshots; `chosenBoth`
  is classified `shop-only` in the snapshot registry (a captured board is never sold; the player's own save carries
  the whole instance). A Choose One whose chosen branch is a PERSISTENT effect (one gated by `params.option` on the def,
  not in `chooseOne[].effects`) has nothing to repeat on sale.
- *Aggressive Golems*: "the minion to the right" = the next LIVING ally in board order. The granted Rally fires once
  regardless of gilding. A Shop Rally replay (Lasting Cadence etc.) fires it and the Shop gain is permanent.
- *Ruptured Rubies*: hops inherit the landing's permanence (the Double Trouble rule), so a permanent Ruby's hops are
  permanent too.
- *Duplicates*: every one stacks per its family (Rubies / pairs / charges / casts per copy; meters pay doubled);
  none was added to the sweetener set. Aggressive Golems' second copy is a no-op graft (a body cannot hold the same
  Rally twice); it could join `RUNE_DUP_SWEETENER` on an owner call.
- Tribe-gate rulings recorded in `tribeGate.test.ts`: Choices, Sold Choices (Choose One is Kobold), Storming Veins
  (Veinstorm) and Aggressive Golems (Gemheart Golem) name no tribe word, so they are owner-ruled Kobold.

**Art.** None wired (owner provides later). `runeArt(id)` returns undefined, so the Runeforge card renders its plain
text face (no `has-art` class) and the badges their default emblem, the repo's standing behaviour for a rune whose art
has not landed; no placeholder files were added.

**Verification.** `packages/sim/src/set3RunesBatch3.test.ts` (41 tests, real `reduce` paths) and
`packages/core/src/combat/set3RunesBatch3.test.ts` (15 tests, real `simulate`). Roster pins moved in `runes.test.ts`,
`set3RuneCuts.test.ts`, `set3RuneRoster.test.ts`, `set3RuneList.test.ts`; combat-mod lane inert pin 63 → 70 (the new
mods need Kobolds / a Shop-spell cast / 8 deaths the staged fight does not field; each is pinned by the new tests).
The text-parse unresolved pin moved 95 → 97 consciously: Echoing Kobolds' quoted granted Echo, Body Counting's
"When 8 friendly minions die," and Sold Choices' "when sold as well" have no grammar rule yet (the other eight parse);
Resonance's reordered text now parses. Oracle R-RUNE-23..33 (after #1727's R-RUNE-22). Contracts, Doc Bot text and
the rules seed regenerated; `final-report.md`'s contract total moved 1045 → 1056.
