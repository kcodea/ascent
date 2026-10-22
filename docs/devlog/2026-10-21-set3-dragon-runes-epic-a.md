# 2026-10-21: Set 3 Dragon runes, Epic A (the easier seven)

Owner content ask 2026-10-21: Set 3 Dragon runes. This branch (`feat/set3-dragon-runes-epic-a`) carries the seven
easier Epics; the Basics (`feat/set3-dragon-runes-basic`) and the four hard Epics (`feat/set3-dragon-runes-epic-b`:
Lasting Words, Twin Tongues, Opened Vault, Bequeathed Secrets) were built in parallel.

## Collision check

All seven are NEW. No rune shares a name. Near names checked and distinct: Rune of Runic Exchange (Set 2 Dwarf, Ale
meter), Rune of Scales (Set 1/2, Shop-spell Dragon buff), Rune of the Runic Hoard (Set 1/2, per-spell Dragon buff),
Rune of the Brood (Imps). "War Council" is also a Set 2 Dwarf GREATER QUEST (`q_war_council`); a quest is a different
kind and the rune is named "Rune of the War Council", so nothing clashes in the validator or the UI.

## What shipped

All `sets: ['set3']`, `tribes: ['dragon']`, in `EPIC_RUNES`, no art (glyph fallback). Names and Gold costs follow
`docs/set3-dragon-rune-draft-30.md` (the owner's texts replaced the draft's).

| Rune | Gold | Mechanism |
|---|---|---|
| War Council | 5 | NEW `runeWarCouncil` combat flag: Start of Combat pass, 3 distinct random Dragons, `castWhisperInCombat` (Runebind) each |
| Growing Inferno | 5 | NEW `runeGrowingInferno` flag: `performAttack` after the Rally (the Sunpony slot), a rune cast of Growth |
| Secret Exchange | 4 | `runeThreshold` on NEW meter `whisperFromHand`, `per: 3`, NEW payload `discoverSpell: 1` |
| Runebound Brood | 4 | NEW `runeRuneboundBrood` flag, both phases: `summonEntryEffects` (combat) and `makeContext().summon` (Shop) |
| Unbroken Scales | 5 | NEW `runeUnbrokenScales` flag: an `onLoseDivineShield` listener with a side-wide budget of 2 |
| Runic Transposition | 4 | NEW `runeRunicTransposition` flag, both phases: folded into the Whisper's own grant |
| Wyrm's Hoard | 4 | `runeThreshold` on NEW meter `shopSpellFromHand`, `per: 3`, the existing `spells` buff (+1/+1 spell power) |

## New primitives

- **From-hand play meters** (`noteHandCastPlay`, recruit.ts). Called by the reducer's hand-play paths only (the Whisper
  branch, the main Shop-spell branch, the Discover-spell branches, Common Ground's second pick, the Choose One
  resolver): one tick per CARD played, after it resolves. A Yazzus / Nimbus repeat is the same play; rune, minion,
  Equipment and Whisp casts never tick. `whisperFromHand` for a Whisper; `shopSpellFromHand` for anything else that is
  a spell and not a Gift, token, reward spell or Ruby.
- **`discoverSpell`** threshold payload: `queueDiscover(state, { kind: 'spell' })` per trip (the Rift-Sunk Codex spec).
- **`castWhisperInCombat(..., runeId)`**: a rune can be the caster of a combat Whisper; the `sc` carries `rune`, so the
  cast's effect stems from the rune's node. **`ctx.runicTranspositionFor(side)`** answers the copy count and pulses
  the badge when it applies.
- **Shop Runebind from a rune**: `runeboundBroodShop` casts through `castSpell` under `withCastActor(rune)` and
  `withWhisperMult(1)`.
- **Unbroken Scales' Ward re-form** emits `shieldUp` with the key `rune:runeUnbrokenScales`, so `clashOrder.ts`'s
  `isWardReform` (it needs a keyed `shieldUp` in the break's slice) plays Foamguard's three beats: break, +10/+10, Ward
  back. No presentation code changed.

## Interpretations (owner approved the readings 2026-10-22)

1. **Secret Exchange and Wyrm's Hoard repeat every 3** ("After you cast 3" read as the counting-rune convention, like
   Hoardcalling, Runic Exchange, the Whelps), and bank the remainder across turns.
2. **"From hand" counts cards, not casts.** A Yazzus-doubled Whisper is one tick; Whisp's echo is none.
3. **Unbroken Scales copies multiply the buff, not the budget**: two copies still fire on the first 2 Ward losses,
   each +20/+20 (each copy is its own rune firing on the same event). The budget is side-wide, so a Rise / Rebirth
   return does not refill it (#2204 resets PER-BODY limits only). Text grammar fixed to "your Dragons lose".
4. **Runebound Brood in the Shop**: the Pup's Runebind stats follow the Whisper rule (temporary, gone at your next
   Start of Turn), not the "recruit triggers are permanent" rule, because it is a Whisper cast.
5. **Runic Transposition** applies to every Whisper cast on a Dragon, whatever the source (hand, Whisp, War Council,
   Whaloo, the Brood), and the extra Attack is part of the Whisper's own (temporary) grant, so a Hum keeps it.
6. **War Council / Growing Inferno / Brood copies** repeat the whole effect per copy (the boolean-flag family).
7. **Growing Inferno has no cap** (the owner text has none; the draft's "first 3" was not adopted).

## Tests and pins

`packages/sim/src/set3DragonRunesEpicA.test.ts` (17 tests: roster, both phases where they apply, copies, the beat
order inside an Unbroken Scales fire, determinism). Re-pins: `set3RuneList.test.ts` (175 to 182 listed, 80 to 87
Epic, a new `dragon` group), `set3RuneCuts.test.ts` (Set 3 Epic 80 to 87), `set3RuneRoster.test.ts` (Set 3-original
Epics 31 to 38). Presentation policies: seven `rune:` keys. Doc Bot: `docbot:sync` regenerated, final-report contracts
1103 to 1110. Oracle: R-DRAGONRUNE-A-01..06 in `registry/approved/runes.ts`.
