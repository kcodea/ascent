# 2026-11-02 · Duos: the second board's animations play

Owner report 2026-11-02 (live Versus Duos / Ranked Duos): "some animations arent playing in duos it seems like the
second player's animations maybe dont play". Branch `fix/duos-second-board-fx`. Rule R-DUOS-FX-01
(approved/foundation.ts), test `packages/ui/src/duosSecondBoardFx.test.ts`.

## Root cause

A tag-team fight is one replay. The teammate's board enters on a `tagIn` event whose bodies get FRESH uids (`m7`, ...).
Every uid lookup the presentation uses was seeded from `initial` + `summon` events only, so none of them knew a
`tagIn` body:

- `useCombatReplay` `cardIds` (uid to card): the Deathrattle medallion pulse, authored damage / Echo / Rally bindings
  (`bindingFor(cardId, ...)`), Shout bindings, watcher bindings, source-buff defs, trigger pulses, the Rally and
  Flurry / Cleave wind-up choices, Blaster bolts, improve pulse presets. Also the per-beat rect refresh iterates
  `cardIds.keys()`, so a board-2 body that died had no last-known rect for source-anchored FX.
- `unitSides`: an enemy board-2 caster's board-wide spell FX fell back to reading the DOM row.
- `names`: narration and buff-source labels read "a minion".
- `playerUids`: player-sourced narrations skipped my teammate's board. (The Albus friendly-damage readout's `mine` set
  was left alone on purpose: it is a per-run tally, and which Duos board it should count is a separate question.)
- `combatTimeline` `cardIdMap`: the choreographer's beats for board 2 carried the bare uid instead of the card.
- Announcer scan, phone audio prewarm, fight recap, bug-report names, the proc harness: same gap.

Reproduced on a real tag-team `simulate` (Mama Pup + Void Panther, teammate's Mama Pup): the compiled timeline gave
board 1 `{ id: 'pack' }` and board 2 `{ id: 'm7' }`. It hit every client the same way (mine, my teammate's, spectators),
and both teams: whichever board fought second, on either side.

Second asymmetry found on the way: the end-of-fight hero attack used MY equipped attack even when my teammate's board
ended the fight (and the forced opponent's when the foe team's second board ended it), so the two teammates saw
different attacks for the same blow.

## Fix

- `packages/ui/src/fightRoster.ts`: `fightBodies(combat)` lists every body that fights (initial, summons, tagIns) with
  card, side and name. Every lookup above reads it (or adds the `tagIn` case inline where the loop already walks the log).
- `attackerCosmeticOf(..., liveSeatId)`: Recruit passes `useDuosCombat` selfSeatId / foeSeatId, so the live board's
  player's recorded attack plays, through "Show opponent cosmetics".

Not in scope / not found: shop-phase FX while watching a teammate (`duosPasses.ts` gates on `ownRunWhileWatching`) is
another builder's file (`fix/duos-pass-latency`) and was not changed.
