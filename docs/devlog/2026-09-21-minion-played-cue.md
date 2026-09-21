# 2026-09-21 — `minionPlayed` cue: a by-card "played from hand" sound/FX hook

Added a new recruit moment, **`minionPlayed`**, that fires when a minion is played from hand — the first
trigger that covers a *vanilla* body (no `onPlay` required). Void Panther (`manasaber`, a plain Deathrattle)
is the first card wired to it: it plays `sfx-voidpanther` (a Sound-primitive def → `voidpanthergrowl.mp3`)
when you drop it onto the board.

## Why it's new

The existing play cue, `shout`, is gated on the def carrying an `onPlay`/Battlecry (it's the same signal that
drives the medallion pulse). Void Panther has only a Deathrattle, so **nothing fired when it was played**.
`minionPlayed` is the generic "you played this minion" signal every card can carry a binding for.

## Detection — "played from hand", precisely

A minion played from hand is **new to the board this frame AND was in the hand last frame**. The reducer moves
the same card object hand→board (uid stable, `reducer.ts` `'play'`), so this cleanly isolates a genuine
hand-play and excludes:

- **tokens** summoned by other cards (they appear on the board, never in the hand), and
- **Triple-merges** (the merged minion is a brand-new uid, never in the hand).

It lives in `Recruit.tsx` in its own effect with its **own** board/hand snapshot refs (`playedPrevBoardRef` /
`playedPrevHandRef`) — deliberately not the Shout effect's `prevBoardUidsRef` (which that effect mutates) nor
the coalesce watcher's `prevHandUidsRef` (a layout effect advances it mid-commit), so the detectors can't
race. Emitted one moment per minion, keyed by its card id, so two minions played in one action each resolve
their own binding.

## Wiring

- `choreo/recruitMoments.ts` — `minionPlayed` added to `RecruitMomentKind` + `RECRUIT_MOMENT_KINDS`, with a
  named `minionPlayedMoment(uid, cardId)` emitter (satisfies the "every kind has a source" invariant).
- `Recruit.tsx` — the detection effect → `runRecruitMomentCues(minionPlayedMoment(...))`, which falls through
  to the generic binding path (`bindingFor(cardId, 'minionPlayed')` → `playDef`). An unbound card costs one
  table lookup and plays nothing.
- `choreo/bindings.json` — `manasaber.minionPlayed = { def: 'sfx-voidpanther' }` (committed → ships to players).
- `fx/defs/sfx-voidpanther.json` + `audio/fx/voidpanthergrowl.mp3` — the def and its clip, committed together
  (the clip auto-registers via the eager `audio/fx/*.mp3` glob in `sfx.ts`).

## Next

A follow-up PR makes the Browse-All **By card** lens interactive so any card's play-sound can be assigned from
the workbench (minions → `minionPlayed`, spells → the existing `spellCast`), instead of hand-editing
`bindings.json`.
