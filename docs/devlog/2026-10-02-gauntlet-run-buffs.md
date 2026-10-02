# 2026-10-02: Gauntlet run buffs (Stage Builder)

Owner ask: "kobolds buff gems throughout a match, but theres no way for me to reflect that, so rubys stay at 1/1. can we
add another section to the tuner that has all of the various buffs taht i can modify from round to round?" Owner
decisions: expose every SIMPLE number buff; buffs CARRY FORWARD (a round inherits the previous round's values unless it
changes them) and the field shows when a value is inherited. Rule: R-GAUNTLET-06.

## Data

- `GauntletRound.buffs?: Partial<GauntletBuffs>` holds only what the author SET on that round.
- `packages/content/src/gauntlet/buffs.ts` is the shared pure half: the field catalogue (`GAUNTLET_BUFF_FIELDS`, keyed
  by a `Record` so a new `GauntletBuffs` member without a row fails to compile), `effectiveBuffs(stage, round)` (the
  carry-forward fold over rounds 1..round), `buffSourceRound` (which round a value is inherited from), `nonZeroBuffs`,
  `withBuffOverride`, `buffOverridesEqual`.
- `validateStage` checks known keys only (strict) and whole numbers >= 0. Nothing in sim/core ever decrements one of
  these scalers, so negatives are refused.
- Exposed (25), each the `BoardSnapshot` field of the same name: Kobold `rubyBonus`, `rubyCasts`,
  `cardsBoughtThisTurn`; Spell `spellPower`, `spellEscalation`, `spellsThisTurn`, `spellsCast`, `growthBonus`; Demon
  `impAura`, `fodderConsumed`; Undead `undeadAura`, `undeadBuyAtk`; Mech `magneticAura`; Beast `beastBuyAtk`,
  `beastsPlayed`, `wildHuntGrown`, `beastHuntExtra`, `beastRitualExtra`, `squirlScoutBuff`; Dwarf `alesLastTurn`,
  `goldSpentThisTurn`; Spirit `spiritsPlayed`, `revelerX`; Counters `deathrattles`, `conductorBuff`.
- Not exposed (owner): `cardBuffs`, `handSpellIds`, `handMinions`, `lastSpellCastId`, `lastSpellThisTurnId`,
  `rememberedSpellIds`, `tribesPlayed`, `questMods` (runes already drive that one).

## Engine

`createGauntletRun` stores the folded, non-zero buffs per round on the authored seat (`authoredBuffs`, plain data, absent
when the stage sets none). `authoredSeat` now attaches a `BoardSnapshot` when a round has runes OR any buff, spreading
the buffs onto it beside the rune `questMods`/`runes`; the reducer's lobby path already builds the enemy side from that
snapshot through `sideFromSnapshot`, so no combat code changed. A compile-time pin in `tutorialSeats.ts` keeps every
buff key a real snapshot scaler. A rune-less, buff-less round still prepares exactly `{ minions, tier }`, so the
tutorial and practice bots are untouched.

End to end (gauntlet.test.ts): a stage of Blazers with Ruby strength +2/+2 set on round 4, played through the real
reducer, casts 1/1 Rubies on round 3 and 3/3 Rubies on round 5.

## Stage Builder

A foldable **Run buffs** section under the round: rows grouped Kobold / Spell / Demon / Undead / Mech / Beast / Dwarf /
Spirit / Counters, pairs as Attack / Health inputs. A value this round does not set is dimmed with "from round N";
typing sets an override (bold name, brass border, the round turns dirty); the row's ✕ clears it back to the inherited
value. "Show only buffs in force" hides the zero rows (remembered per browser). `roundToSnapshot` now carries the
effective buffs, so the sandbox Test fight uses them, and the board canvas runs its cards' text through `liveCardText`
with the round's buffs (Chef Raag prints the Imp aura it will fight at). Copy from previous round keeps the round's own
overrides (buffs already carry forward).
