# 2026-10-20 — Vaultkeeper: Dwarf/Dragon, improving on a run-wide tally

**Owner ask (Mike):** "lets change vaultkeeper to a Dwarf / Dragon tribe type, and let's change its mechanic to 4
dragons or dwarves played improves it. i want this mechanic to be active even when the card is not on board or in
hand or in shop. do we have a term for this?"

**Term.** There is no keyword for it. Cards say it with a scope tail: Tome's "Improves every 4 spells cast this
game." (counted from the start of the game). Mike picked reusing that tail, so the card reads "When you play a
**Dragon**, gain **+3/+3**. Improves every **4 Dragons or Dwarves** played this game."

**Rulings (2026-10-20):** the +3/+3 still pays on Dragons only; the count starts at the beginning of the game; a
Vaultkeeper's own play counts; a dual-type play counts once; +3/+3 per step, Gilded doubles.

**How it works.**
- `RunState.tribeUnionPlays` is a run-level map keyed by a sorted `tribes` union (`dragon+dwarf`). `packages/sim/src/runTally.ts`
  derives the unions to count from every card using `tribePlayedGainSelfImproving`, so the count runs whether or not a
  reader is owned. `countTribeUnionPlay` bumps it in `playCard` right after `fireOnTribePlayed`, so a paying copy reads
  the tally from before the play (grant, then count).
- The factory reads the run tally instead of the copy's `spiritTally`.
- Live text and the N/4 counter read the run tally through `runTallyFor` on every player surface (Shop and Discover
  via `liveOptsFromRun`, hand and board via `handLiveOf`, end screen via `liveBoardView`, combat in `Unit.tsx`). A served
  opponent's snapshot stamps its owner's count into the copy's `spiritTally` slot (`snapshot.ts cleanBoard`).
- A run saved before this change starts counting from 0 at that point.

Rule: R-VAULT-02 (amended). Tests: `vaultkeeperRunTally1020.test.ts`, `vaultBrisbaneText.test.ts`.
