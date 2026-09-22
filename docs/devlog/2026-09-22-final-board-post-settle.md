# 2026-09-22 — The recorded final board is the POST-SETTLE board (Career / Recent Games / Hall of Champions)

**Owner ask (2026-09-21, from a Recent Games row whose final team showed the board from BEFORE the last
combat):** "Can we make it so that the final snapshot is actually what a 'fresh board' would look like after
that final combat? So that it carries the in-combat buffs for boards that carry them." In the screenshot the
Abominations read 106k / 166.2k, which were Engraved gains from EARLIER combats; the final combat's gains were
missing.

This replaces the 2026-08 owner ask ("the impressive version the player actually fought with", i.e. the
Start-of-Combat board with SoC buffs applied) — that snapshot was, by construction, the board at the START of
the last fight, so every gain earned DURING it was absent.

## What changed

`packages/ui/src/store.ts`, the run-end block of `commitResolvedAction` (the deferred `setTimeout` that
builds the history entry / Hall upload / replay v2 result):

- **`finalBoard = endStateBoard(next) ?? highestFresh`.** `endStateBoard` is the single builder: a
  `snapshotBoard(run)` of the settled `run.board`, with each minion overlaid by `liveBoardView` (final
  Attack/Health incl. run-wide auras, live scaling text, name/tribe identity baked for readers on other
  builds).
- **`combatStartBoard` and `bakeIdentity` deleted**, the `socBoard` import dropped. `socBoard` itself stays
  in `@game/sim` (`snapshot.ts`) as a pure test / fidelity helper (`socBoard.test.ts`,
  `set3RunesTrancheC.test.ts` still use it); its doc comment says so.
- A DEV-only `console.warn` at the seam fires if `next.lastCombat && !next.combatSettled` when a run ends,
  so a future terminal writer that skips the settle cannot silently regress the recorded board.

## The seam: where the final combat gets settled

No copy-and-settle was needed. The run-end block is only ever reached through the `resolveCombat` action
(`packages/sim/src/reducer.ts`): `if (!s.combatSettled) settleCombat(s, s.lastCombat)` runs FIRST, then
`settleLobbyRound`, then `advanceCombat` flips the phase to `gameover` / `victory`. `settleCombat` sets
`combatSettled = true` before `advanceCombat` runs, and `advanceCombat` is the ONLY terminal writer. So by the
time the store's run-end block sees `next.phase` terminal, `next.board` already carries every carry-back
`settleCombat` writes (Engraved / Permanent `playerPermaBuffs` via `addBuff`, Ruby carry-backs, Pummel
payouts, `spellProgress` / `ascendProgress` / `summonBonus` accruals, identity transforms such as Spirit Pup and
Tara to Taragosa, Rune of Overflow, Chorus Engine, Undead Bond, beast auras). Nothing is re-derived in the UI.

## What the final board contains now vs before

| | Before (SoC merge) | Now (post-settle) |
|---|---|---|
| Gains carried back by the LAST combat (Engraved growth, Rubies, Pummel) | missing | **present** |
| Plain Start-of-Combat +N/+N on a non-Engraved body | shown | dropped (combat-only) |
| Combat-granted shields / keywords (Divine Shield, Reborn) | shown | dropped (`settleCombat` strips `tempShield` / `tempReborn`) |
| Start-of-Combat summoned bodies (tokens with no run card) | appended | **dropped** (a fresh board would not have them) |
| Live scaling text | live | live (same `liveBoardView` overlay) |

Two visible consequences to know about, both consistent with the "fresh board" semantic:

- **Pummel bodies show 0 progress** on the final board: `settleCombat` clears `damageDealt` for
  `resetEachCombat` meters, exactly as the next shop would.
- **Identity transforms land**: a Tara that ascended in the last fight is recorded as Taragosa; a Spirit Pup
  that grew up is recorded grown. Comparing against the replay of that fight will look like a different card.
  That is intended.

One approximation, accepted: `advanceCombat` returns early on a terminal round, so the per-turn reset block
(`spellsThisTurn`, `goldSpentThisTurn`, `playedThisTurn`, ...) never runs. Stats are exact; a PER-TURN tally
in a card's live text (a Spirit Worgen / Patch Job / Pack Leader style counter) prints the closing turn's
number rather than a fresh shop's 0. Zeroing those on a copy would mean re-implementing the reducer's
per-turn reset in the UI, which the architecture forbids, so it stays as is.

## Consumers

ONE `const finalBoard` feeds every surface, unchanged in shape:

1. Career match-history row: `buildRunHistoryEntry(next, { board: finalBoard })` to `uploadRunHistory`.
2. Recent Games: `v2.result.finalBoard` on the replay v2 record that rides the telemetry upload.
3. Hall of Champions: `uploadVictory({ board: finalBoard })` on a lobby win.
4. Rewatch last game: `set({ lastReplay: v2 })`.

NOT changed: the opponent-POOL snapshot (`capturedBoards` from `snapshotBoard(next)` at `faceOmen`, the
end-of-turn pre-combat board used for matchmaking) and the id linkage `finalBoard.id = highestFresh.id`;
`recordFightResult`, `beginRankSubmission`, the replay v2 frame capture, `servedBoards`. Practice / tutorial /
sandbox runs never reach the run-end block. Historical rows already on the server keep their old SoC boards;
there is no marker distinguishing them.

## Tests

- NEW `packages/ui/src/finalBoardPostSettle.test.ts` (jsdom, drives the REAL store through
  `dispatch({ type: 'resolveCombat' })` with the upload seams mocked, the `bugScenarioLoad.test.ts` pattern):
  an eliminated ascent run records the Engraved gain its last combat carried back (base 1/1 + 5/5 = 6/6, no
  shield, identity baked, `lastReplay.result.finalBoard` is the SAME object); combat-only SoC buff / shield /
  summon do NOT appear (1/1, one minion, power 2); a course victory settles before recording; a lobby win
  sends the same object to `uploadVictory` and `uploadRunHistory`.
- `packages/sim/src/socBoard.test.ts` title updated (still pins `socBoard` purity).

## Verification

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build:web`, `npm run harness` (see the PR / commit
for the run).
