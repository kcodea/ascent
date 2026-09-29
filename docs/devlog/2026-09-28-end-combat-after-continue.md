# 2026-09-28 — End Combat works on a settled fight reopened by Continue

Reported by an agent testing hero attacks; the owner asked for the fix: "a lost fight that was already settled and
is then reopened with Continue never enables the End Combat button, so the run can't leave that screen."

**Root cause.** On a loss, End Combat waited for the hero-strike sequence to reach `lossPhase === 'done'`. That
sequence early-returns when `run.combatSettled` is already true (correct: the blow was dealt before the reload,
replaying it would imply a second hit). A save written after the settle restores with `combatSettled: true`, so on
Continue the replay plays back, the sequence never starts, `lossPhase` stays `null`, and the gate never opens. Skip
unmounts once the replay ends, so no control was left. Wins and draws were never held, so only losses stuck.

**Fix.** The gate is now one pure function, `packages/ui/src/endCombatGate.ts` `endCombatReady`: a loss is also
ready when the strike never began (`null`) and the fight is already settled. Mid-strike the phase is `'blast'`
(set before the impact settles), so a live loss still waits for the blow. Leaving still goes through
`resolveCombat`, whose settle is guarded by `combatSettled`, so nothing re-applies.

**Verified.** Reproduced live on a Practice run (normal health, port 5217): settled loss, reload, Continue, button
disabled with Skip gone. With the fix: enabled, leaving moved wave 1 to 2 with Armor unchanged (8). A reload during
an UNSETTLED fight still played the strike and took the damage once (Armor 8 to 4). Tests:
`packages/ui/src/endCombatGate.test.ts` (gate cases, save round trip, elimination). Oracle: `R-RESUME-01`.
