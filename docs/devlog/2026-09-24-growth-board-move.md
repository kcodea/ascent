# 2026-09-24: casting Growth no longer slides the warband

Owner report (verbatim): *"when casting growth it randomly moves the warband, please fix that"*

## What it was (proved live, own port 5199, throwaway runs)

Not the sim, and not the Growth effect. The board order in state never changed (`run.board` uids identical
before/after every cast), and `growth-effect.json` has no shake, react or screen layer. The owner's def is untouched.

It was the shop's **row FLIP** (`RowFlip` in `packages/ui/src/Recruit.tsx`), case (b)/(c) of the brief:

- The commit branch (a sell, summon or effect reposition with no drag) glides each warband / tavern card from its
  `offsetLeft` at the PREVIOUS row commit to its current one. That baseline was re-swept only when the FLIP key
  changed outside a drag, so it could be arbitrarily old.
- The FLIP key also carries the drag's `collapsedLift` flag. Dragging any spell up out of the hand flips it on, and
  releasing it flips it off. The release commit runs the commit branch although no row changed.
- If the layout had changed since the last sweep (the window resized, a panel docked, anything that re-centres the
  row with the same cards), every card got a phantom delta and the whole warband slid in from its old spot.

Measurements (sampling every warband card's rect every 8 ms around the cast):

| Case | Before | After |
| --- | --- | --- |
| Sweep taken at 2560x1440, Growth dragged at 1600x900 | all 7 cards tween in from +147..+479 px | not re-run (resize drops the sweep) |
| Row shifted 300 px (padding, no resize event), Growth dragged | all 6 cards slide from -99 px (132 moved frames) | 0 moved frames |
| Growth by `dispatch` (no drag), 3 / 4 / 7 minions | no motion | no motion |
| Recurrence casting Growth twice at End of Turn | no motion | no motion |
| Real sell (row changed) | survivors glide | survivors still glide (23 distinct frames) |

It reads as random because it only shows when the layout moved between the last buy / sell / roll and the cast, and
it reads as Growth because Growth is the spell cast most. Any dragged spell did it.

Fatecarver / Hoardbreaker casting Growth in combat was also checked: the only row motion there was the ordinary
300 ms death shake.

## The fix

- `packages/ui/src/commitFlip.ts`: `commitFlipDeltas(prev, now)`. Each sweep is keyed by the `rowsKey` it was taken
  under; a commit whose rows did not change (same key) moves nothing, however `offsetLeft` shifted.
- `RowFlip`'s commit branch diffs through it and stores `{ key: rowsKey, lefts }`.
- `RowFlip` drops the sweep on a window `resize`, so a real row change after a resize snaps instead of flinging the
  survivors in from the old layout. One listener, no layout read, no per-frame work.

## Enforcement

- `packages/ui/src/commitFlip.test.ts`: the no-row-change case fails with the old diff (checked by removing the key
  guard) and passes with it; plus sell / summon / sub-pixel cases and the `RowFlip` wiring.
- Oracle: R-PRESENT-13 in `packages/rules/src/registry/approved/foundation.ts`.
