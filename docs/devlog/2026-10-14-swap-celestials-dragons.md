# 2026-10-14 · Celestials to Set 4, the Whisper Dragons to Set 3, and the first Set 3 Dragon batch

Owner: "move celestials to set 4 along with their runes etc. remove them from set 3. move our current set 4 dragons to
set 3." Both sets are disabled (Set 2 is live), so no patch note.

## The swap

- **Convention:** a card's source file lives in its home set's `cards/<set>/` directory, so a set move is a `git mv`.
  `cards/set3/celestials.ts` -> `cards/set4/celestials.ts` (`SET4_CELESTIALS`), Star Crash + Black Hole (`accretion`) ->
  new `cards/set4/spells.ts` (`SET4_SPELLS`), `cards/set4/dragons.ts` + `whispers.ts` -> `cards/set3/` (`SET3_DRAGONS`,
  `SET3_WHISPERS`). **Ids never changed** (`ce3_*`, `d4_*`, `w4_*` now record where a card was first authored).
- **Set 3** tribes `['kobold', 'dwarf', 'undead', 'spirit', 'dragon']`; the four Dragons sit in the slot the Celestials
  held, so no earlier minion moved. **Set 4** tribes `['beast', 'celestial']`: Beasts, then the 22 Celestials + the
  Starform token, then the shared neutral spells, then Star Crash + Black Hole.
- **Runes:** the 20 Celestial-only runes are `sets: ['set4']`. The Set 3 Menagerie now grants a Dragon instead of a
  Celestial ("this set's five tribes"). The four Celestial hybrids (Soul Script, Star Tap, Gem Star, Festival Circuit)
  work in neither set, so they are **parked** (`sets: []`, never archived) for an owner call.
- Starform, Collapse, Star Destroyer, the starform FX and glossary pills are card-driven, not set-gated: they work
  wherever the cards are (verified in a Set 4 Scene Builder run: Star Seed creates the Starform + Star Destroyer).
- Art jobs follow the owner's folders: Set 3 Minions now has `Dragons` (no `Celestials`); Set 4 Minions has `Celestials`.

## The Set 3 Dragon batch (same day)

Whaloo, Falx (+ its Whisper Ripple), Queen Morro, Shush (Equip: Jar of Secrets, 3 random Whispers; the Jar was briefly a
Shop spell and never shipped as one). Rules in `docs/GAME-RULES.md` and the oracle (R-WHISPER-03..07,
R-SPELL-MORRO-01). Engine notes:

- **Combat Whisper casts** (`castWhisperInCombat`, core factories): a real cast through `castInCombat`, combat-only
  buff, improve tracked per side (`whisperImproveFor` / `addWhisperImprove`) and carried back via
  `ShoutCarry.whisperImprove`; the side's run value rides `CombatSideState.whisperImprove` (snapshot-captured, so a
  served Whaloo casts its own run's Runebind). Whisp echo and Tamby copy have combat halves (Tamby: once per fight, a
  gilded copy keeps its multiplier via `ShoutCarry.handWhisperMults`).
- **Queen Morro** folds into `spellCastRepsFor` (live, additive) and into `playRubyOn` only outside a cast (no squaring).
- **Presentation:** `sc` events carry `target` + `whisperImprove`; the replay stamps `whisperCastsUsed` (Whaloo's
  triggers, one per caster+step) and `whisperImproveLive` (Tolan's text rises mid-fight). Buffs panel: Whisper rows by
  name with "until your next turn" (`buffExpiry.ts`). Runebind's owner FX def `runebind` is bound `buffedOn` on both its
  `spellCast` and `buffWave` rows (Dragonflame's shape): one play on the target per cast.

## Judgement calls to confirm

- Parked hybrid runes (above); Set 2's Dragon runes stay cut from Set 3 even though Dragon is now a Set 3 tribe.
- Gilded Shush: 3 Gilded Whispers (not 6 Whispers).
- Tamby's "(Once per turn)" in combat is once per fight (the Shop latch is not threaded into combat).
- Ripple on a Shout-less minion is refused (kept in hand), as Resonance.
