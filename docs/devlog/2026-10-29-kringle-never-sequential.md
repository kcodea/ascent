# 2026-10-29 — Kringle never buffs one tick at a time (R-REPEAT-06)

Owner (live Versus Duos, Dwarf board, several Kringles): "my kringle is buffing 1 by 1 again for some reason, it
doesnt happen everytime but it randomly does this".

## Root cause

The authoritative End of Turn (`playEndOfTurnAuthoritative`) was already paced: a fuzz over Dwarf boards (several
golden Kringles, Strikers, Kneel / Tankerchief watchers, Chronos, huge stats, set 2 and set 3, Versus `deferFight`)
compiled with the shipped beat config found every repeat tick paced and every chain inside the shared budget.

The sequential playback came from `Recruit.tsx` `endTurn`: `if (CHOREO_EOT && playEndOfTurnAuthoritative()) return;`
fell through to the LEGACY runner whenever the authoritative path returned false, and it returns false only when the
store REFUSES to prepare End of Turn (`preparePresentationAction`: `replaying`, or `versusRefuses` during a Versus pause
or its 3-2-1). The legacy runner plays one fixed 760 + 170 ms beat per entry, and a repeat card takes one entry per
tick, so a 61-tick Kringle took about a minute with its ribbons flying one at a time, End Turn locked the whole while,
and the closing `dispatch({ type: 'faceOmen' })` was then refused by the same guard. Intermittent because End Turn has
to be asked inside that window (a pause landing between the resume effect's render and its timeout, a press during a
pause, the Duos teammate view / replay viewer swapping the store's run).

## Fix

- `choreographer/endTurnGate.ts` `endTurnRefused`: the store's refusal predicate for End of Turn. `endTurn` asks it
  first (before the Whispers dissipate) and does nothing when it holds; Versus re-asks (`useVersusRecruit` resume
  effect + watchdog).
- With the choreographer on, `endTurn` never reaches the legacy runner: `if (CHOREO_EOT) { playEndOfTurnAuthoritative(); return; }`.
- The legacy runner (rollback valve only) paces its repeat ticks through `legacyEotRepeatPlan`, the same
  `repeatChainSchedule` / shared budget the compiler uses; batched ticks play together and only accents ring and
  ribbon.

Test: `packages/ui/src/choreographer/repeatNeverSequential.test.ts` (source pins on the End Turn path, the refusal
predicate, the legacy plan's budget, and the authoritative fuzz). Not reproduced live (no live tests on this task).
