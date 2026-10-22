# 2026-10-21: Set 3 Dragon runes, Basic tier (11 runes)

Owner content ask 2026-10-21: Set 3 Dragon runes. This branch is the Basic tier; the Epic tier is two parallel
branches (`feat/set3-dragon-runes-epic-a`, `feat/set3-dragon-runes-epic-b`). Branch `feat/set3-dragon-runes-basic`.

## Collision check

Every name was checked against every rune and card in every set (live, archived, tokens): **all 11 are NEW**. No
SAME, no CHANGED. Near names that are different cards: Rune of Scales (Epic, Set 1/2, "your Dragons +4/+5" per Shop
spell), Rune of Inheritance, Rune of Tempering, Rune of Borrowed Echoes, Rune of the Embers.

## What shipped

All `sets: ['set3']`, `tribes: ['dragon']`, cost 3, in `RUNES` (Basic). Names are the owner's, verbatim (no
"Rune of" prefix, the Happy Birthday precedent).

| Rune | Reward | Where it lives |
|---|---|---|
| Rune of the Runic Primer | `combatFlag runeRunicPrimer` | pays on acquire (combatFlag case) + Start of Turn (`runicPrimerTurnStart`) |
| Rune of Loose Tongues | `runeThreshold` meter `playDragon`, `per: 1`, NEW payout `grantRandomWhisper: 1` | data only |
| Rune of Clear Voices | `combatFlag runeClearVoices` | the reducer's Whisper-from-hand branch |
| Rune of Spell-Fed Scales | `combatFlag runeSpellFedScales` | Shop: `noteSpellCast`; combat: `spellResolved` |
| Rune of Borrowed Flame | `combatFlag runeBorrowedFlame` | Shop: `castSpell`; combat: `castWhisperInCombat` -> `ctx.onWhisperCast` |
| Rune of Spell Tempering | `combatFlag runeSpellTempering` | same two hooks as Rune of Borrowed Flame |
| Rune of the Open Treasury | `combatFlag runeOpenTreasury` | `applySpellBought` (both spell buy paths) |
| Rune of Deep Breaths | `combatFlag runeDeepBreaths` | `performAttack`, after Sunpony |
| Rune of Defiant Wings | `combatFlag runeDefiantWings` | `runRuneStartOfCombat` (Twilight-repeated) + `socRuneReplaysOf` |
| Rune of the Final Utterance | `combatFlag runeFinalUtterance` | `runeAvenge(4, ...)` (Fury doubles it) |
| Rune of Ember Inheritance | `combatFlag runeEmberInheritance` | a `bus.on('avenge')` listener reading the victim |

Shop halves are grouped in `packages/sim/src/dragonRunesBasic.ts`; combat halves are under "SET 3 DRAGON RUNES" in
`simulate.ts`. Shared numbers are `DRAGON_RUNES_BASIC` in core `types.ts`.

## New primitives

- `runeThreshold.grantRandomWhisper` (schema + `QuestReward` + run state): `mintRandomWhispers`, the gated pool.
- `ctx.onWhisperCast` (CombatContext): every resolved combat Whisper cast, per repetition.
- `ShoutCarry.borrowedFlameGain` / `ShoutCarry.whispersCast`: the combat carry-home for Rune of Borrowed Flame's improve and
  Rune of Spell Tempering's meter.
- `mintWhisper(..., overflow)`: a seventh parameter so a rune's Whisper grant over-caps at the moment of acquisition.
- `RuneLiveState.borrowedFlame` + `liveRuneText` case: Rune of Borrowed Flame prints its current value everywhere.

## Interpretations (owner approved the readings 2026-10-22)

1. **Names use the "Rune of" prefix** and **costs come from docs/set3-dragon-rune-draft-30.md** (owner ruling 2026-10-22): 2 Gold for Rune of the Runic Primer, Rune of Clear Voices, Rune of Borrowed Flame, Rune of the Open Treasury and Rune of the Final Utterance; 3 Gold for the other six.
2. **"Repeat each turn"** = every Start of Turn (the tribe-drip shape), plus the immediate grant on purchase.
3. **Rune of the Runic Primer is tier-gated** like every non-owner Whisper source (R-WHISPER-TIER-01): below Shop Tier 2 it pays
   nothing (Runebind is Tolan's tier, 2).
4. **"Play a Dragon"** = played from hand in the Shop (the Actioned Beasts ruling); a combat hand-summon is not a play.
5. **Rune of Clear Voices** counts distinct Whisper NAMES cast from hand; a Yazzus repeat or a second copy of the same Whisper
   is not a new one. Combat Whisper casts are never "from hand".
6. **"Give a Dragon"** (Rune of Spell-Fed Scales) = a random friendly Dragon on the board, seeded; one pick per copy.
7. **Rune of Borrowed Flame** starts at +1/+1 and improves +1/+1 per trigger (x Rune of Mastery). The value is ONE shared
   per-copy value: each copy pays it, the improve happens once per trigger. Whisp's echo cast on itself is a cast on a
   Dragon, so it pays and improves too.
8. **Rune of Spell Tempering repeats** every 4 Whispers (a running meter), not once. "Your Shop Spells +1/+1" = the run's spell
   power (`spellBonus`), the channel every "improve your spells" uses. Whispers cast in combat (Whaloo) count.
9. **Rune of the Open Treasury**: "the first Shop Spell you buy" = the first spell bought each turn by either buy path; the copy is
   plain, over the cap only at acquisition (it never is, in practice).
10. **Rune of Deep Breaths**: the first 2 Dragon swings per side per fight (a Windfury second swing counts), each casting one
    Growth per copy through the attacker as an ungilded stand-in.
11. **Rune of Defiant Wings**: 2 different random friendly Dragons (fewer = all). Its Shop replay under Combat Prowess / Lasting
    Cadence is permanent, as every rune replay is.
12. **Rune of the Final Utterance**: the Whisper uses the gated pool, the Shop Spell the side's set pool at its tier (the Carrion
    Coin grant). Both arrive in hand after the fight.
13. **Rune of Ember Inheritance**: "with Echo" = the dying body carries any Echo (printed or granted). The latch is spent by
    that first death even if no other Dragon is alive to inherit. Its Attack at death; a combat-only buff.

## Verification

`packages/sim/src/set3DragonRunesBasic.test.ts` (Shop halves through the real reducer, including two real turns) and
`packages/core/src/combat/set3DragonRunesBasic.test.ts` (real `simulate()`: every combat half, enemy-side symmetry,
Twilight, Fury, copies, determinism). Pins moved: `set3RuneList.test.ts` (175 -> 186 listed, 95 -> 106 Basic).
Oracle: R-DRAGON-RUNES-BASIC-01. No rune emblem art wired (not asked).
