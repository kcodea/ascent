# 2026-10-02 — Replays play the End of Turn (recorded batch on the fight frame)

Owner report: "noticing a gap in the replay system - when watching this back, the end of turn with lasting cadence
etc wasnt showing any animation or beats at all." The game was a Brackus victory that used Rune of Living Magic and
Rune of Lasting Cadence.

## Root cause

Live End of Turn is click-driven. `Recruit.tsx endTurn()` calls `preparePresentationAction({ type: 'faceOmen' })`,
which resolves End of Turn once into a `PresentationBatch`. It then compiles the batch and plays it on the Shop,
which is still mounted, and only then commits `faceOmen`. The replay capture (`commitResolvedAction` in `store.ts`)
recorded `faceOmen` as one `CombatFrame` and nothing else. The batch reached the commit, but it went only to the
bug-report action ring. Playback is a pure renderer, so it stepped from the last shop frame straight to the fight.
It had no batch to play, and replay v2 forbids rebuilding one with a reduce at playback.

A test repro used three Rally minions under Lasting Cadence. Live, that produced 9 batch events, which compile into
6 beats (3 Cadence + 3 Rally) and 2490 ms of animation. The replay frames were `[shop:turnStart, combat]`, and no End
of Turn data was recorded.

**Scope:** this hit every End-of-Turn source, not just Lasting Cadence. The other phases were already fine:
- Shop actions replay their FX through the state-driven seq channels that ride the ShopView deltas.
- Start of Turn replays because `sotBeatFx` and its seq ride the turnStart keyframe.
- Combat replays the recorded `lastCombat` verbatim.

## Fix

The replay format is additive and stays at version 2.

- **Capture.** `CombatFrame.eot?: EotRecord` holds the batch (deep-cloned, about 3 KB), `atMs` and the `lassoFx`
  records. `atMs` is when End Turn was pressed: `preparePresentationAction` stamps it on the frames clock, and the
  fight's own `tMs` is the commit, after the beats. The record is built by `eotRecordOf` and stamped at the
  `faceOmen` commit. It is only stamped for a non-empty End-of-Turn batch.
- **Playback.** When the next frame is a fight that carries `eot`, `replayPlayer` holds the shop until `eot.atMs`.
  It then sets `replayEotCue { key, eot, speed }` and waits for `replayEotDone === key`, with a 90 s safety net,
  before it renders the fight.
  - A pause lets the beats finish, and resume renders the fight.
  - A seek or any frame render drops the cue.
  - A late completion with an old key is ignored.
- **Recruit.** `playEndOfTurnAuthoritative(recorded?)` runs the recorded batch through the same compiler, timeline
  player and presenters as a live End Turn. It does no prepare and no commit: completion calls `recorded.onDone`. It
  plays at the replay speed.

**Old replays** have no `eot`, so they go straight to their fight as before. They cannot be recovered.

Oracle: R-REPLAY-01 (foundation). Test: `packages/ui/src/replay/replayEot.test.ts`.

## Not covered

- During the fight, the HUD still shows the pre-End-of-Turn shop world (hand and gold), because the fight renders
  over the nearest shop view. End-of-Turn hand grants appear at the next turn start, as they did before.
- The legacy End-of-Turn path (`ascent.choreo = '0'`) dispatches `faceOmen` without a batch, so nothing is recorded
  for it.
