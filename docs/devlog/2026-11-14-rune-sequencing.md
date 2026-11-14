# 2026-11-14: Sequencing (Set 2 Epic Dragon rune)

Owner design. Rule R-SET2-RUNE-SEQUENCING-01; tests in `packages/sim/src/runeSequencing.test.ts`. Owner art wired as drawn (`art/runes/rune_sequencing.webp`).

"When you cast **3** different spells, get a **copy** of the first one." Epic, Dragon, 3 Gold, Set 2 (`EPIC_RUNES`).

## One sequence, every phase

- The rule lives in ONE place: core's `advanceSequence` (`packages/core/src/runeSequencing.ts`). A spell joins when its
  id is not already in the sequence; a repeat does nothing (no count, no reset); the third different spell returns
  `pay` = the first id and an empty sequence.
- The run holds the sequence (`RunState.runeSequence`, the flag is the `combatFlag` `runeSequencing`).
- **Shop / End of Turn:** `sequencingOnCast` (`packages/sim/src/runeSequencing.ts`), called at the end of
  `noteSpellForCountRunes`, the every-spell chokepoint (Shop spells, Discover spells, Whispers, Rubies cast from hand,
  rune / minion / End of Turn casts). Pays with `conjureToHand` (a Ruby through `mintRubies`), normal hand cap,
  one copy per stack (`runeStacksOf`), and `procRuneId` pulses the badge.
- **Combat:** `questCombatMods` sends `runeSequencing` + `runeSequence` into the fight (so a served snapshot carries
  them too, symmetric). `sequencingCombat` runs from `spellResolved`, the per-cast hook every `castInCombat` caller
  reports through, BEFORE its Shop-spell gate. A pay fires `questTrigger runeSequencing` and a live `toHand` per copy
  (`recordHandGrant`, landed by settle under the hand cap). The final sequence rides `ShoutCarry.runeSequence`;
  settle writes it back.
- **Live readout:** a new presentation-only `runeSequence` event (side + the whole list) after each change, silent
  and zero hold (classed like `teamSend`). `runeProgress` folds it per replayed step into `RuneCombatProgress.sequence`;
  `runeLiveStateInCombat` replaces the pre-fight list with it. `liveRuneText` appends
  "(Sequence: A, B. 1 more.)" (or "(Sequence: none yet.)") on every rune-text surface; `runeLiveTally` gives the
  badge and tip pill `n/3`, live mid-fight, for both sides.

## Judgement calls (flag to the owner)

- Gifts (Clues included), reward tokens and Second Draft never join the sequence (never copy food), so a sequence
  can never pay a dud.
- A Ruby counts when it is CAST from hand in the Shop; a Ruby an effect plays (a rune's or minion's Ruby, in either
  phase) is not a spell cast and does not count.
- Stacks: one extra copy per rune copy (the meter family's "doubled payoff per trip").
- A combat-granted Ruby lands as a plain card through `playerHandGrants`, like every other combat hand grant.
