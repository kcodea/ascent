# 2026-10-14 · Two live bugs left by the old wave mode

Owner: *"there are remnants of the old wave based mode that you can outright remove. we do not use that mode ever
anymore and dont need it anywhere. make sure it doesnt break our lobby/versus modes though"*

First PR of the staged removal (plan: `2026-10-14-remove-wave-mode-plan.md` on branch `chore/remove-wave-mode`).
UI only; no sim file, no DB change.

## 1. `board_results` credited a board nobody fought (R-LEDGER-01)

The reducer still pins a wave-first opponent-pool pick into `servedBoards` every turn, in every mode. A lobby never
fights it (it fights the paired seat), but the store's `faceOmen` hook credited the fight to `nextOpponent(run)`,
i.e. that pin, and wrote a `board_results` row for every round of every lobby and tutorial game. Removed the call,
`recordFightResult`, and its upload-queue case (a queued `fight` item is now dropped). The table itself and its
reader (`fetchAndRegisterBoardRecords`, which feeds the pool-pick weighting used by bot seats) are left for the
matchmaking-cleanup PR, pending the owner's call.

## 2. Every end screen re-simulated the run (R-ENDSCREEN-01)

`EndScreen` ran the retired course screen's derivations as hooks above its tutorial / Gauntlet / lobby returns:
`buildTags`, `lineResult` and a `replayRun` of the whole action log. They now live in `CourseEndScreen`, which
mounts only for a lobby-less run (none in live play). Deleting that screen is PR 2 of the plan.

Test: `packages/ui/src/waveModeLiveBugs.test.tsx` (both cases fail on the previous `main`).
