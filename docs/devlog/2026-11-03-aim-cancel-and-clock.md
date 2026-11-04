# Aims can be cancelled, and the Shop clock runs under them (2026-11-03)

Owner report 2026-11-03: "can you allow the targeting of a minion to be canceled... both choose one and shouts etc should
be able to click back and not play the card/send it back to hand", and "shop time should not pause while choosing a
minion". Rules R-TARGET-CANCEL-01 and R-TIMER-AIM-01.

## Root cause

An aimed Shout committed before the aim opened: the `play` case spliced the body onto the board, paid the play meters and
the summon buffs, and only then set `pendingTarget`. There was no clean state to go back to, so `cancelChoice` refused it.
Common Ground's second pick was the same (meters paid, card still in hand). Choose One already held its play, but `reduce`
ran its per-play hooks on the `play` that only opened the prompt, so a cancelled Choose One still ticked them, and the
commit did not.

## Fix

- The `play` case runs on its draft as before. On reaching the aim with no pick it DROPS the draft (`holdPlayForAim`) and
  answers from the untouched `state` with the aim open. So the aim opens on the same predicate, against the board the play
  would leave, with nothing committed.
- `battlecryTarget` replays the `play` carrying `aimPick`, the twin of `chooseOnePick`. The recorded action sequence is
  unchanged (`play`, `battlecryTarget`) and the draws run in the same order, so old recordings reduce the same way.
- `reduce` skips `settleAction` for a held play, and runs it as a `play` for the action that commits one. This also moves
  the Choose One per-play hooks to the commit. `runDerive` marks a card played on the same terms.
- A committed `pendingTarget` from an older save (no `deferredPlay`) keeps its old branches.

## Clock

`shopDecisionOpen` (turnClock.ts) is the clock's decision gate and leaves `pendingTarget` out. The Choose One PROMPT still
holds the clock; its aim step does not.

0:00 under a held aim closes it like a cancel, in the reducer's `shopClockExpired`. That action needed its own pass through
the modal gate, which used to refuse it during an aim. The brief allowed auto-resolve if a timeout rule said so. R-TARGET-07
covers an aim "stranded when the turn ends", which was about a body already on the board; a held play has not happened and
`play` locks at 0:00, so cancelling fits R-TIMER-LOCK-01.

End Turn with a held Shout aim still open completes it on a random legal target, which keeps R-TARGET-07 true and replays
old recordings. The live game does not reach this: pressing End Turn is a click off target, so the aim cancels first.

## Input

Click or tap off target, right-click and Esc all cancel, for hand aims and for hero power / Equipment aims. Esc yields to
anything else open (`escapeHasOwner`). Right-click runs in the capture phase so the ping menu does not open on top.

Tests: `packages/sim/src/aimCancel.test.ts`, `packages/ui/src/aimClock.test.ts`. Sim changed, so the Versus Worker needs a
redeploy.
