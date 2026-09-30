# 2026-09-29 — Gauntlet player screens (PR 3), and Practice loses bots

The Gauntlet mode from the stage builder (PR 1/2) now has its player-facing shell.

## Start flow

Play menu, Gauntlet, Stage select, `startGauntlet(stage)`, hero select (any hero, Practice's full-roster list),
`createGauntletRun`. `startGauntlet` refuses a stage that is not playable (`isStagePlayable(stage, import.meta.env.DEV)`):
stages 6-10 and any `status: 'draft'` stage show "Coming soon" to players. In a DEV build a draft stage with at least
one non-empty round is playable and marked "Draft", so the author can test it.

## Progress

Device-local for now, under localStorage key `ascent.gauntlet.local`: stage 1 unlocked, clearing N unlocks N+1.
PR 4 moves this onto the account (and adds the crate reveal).

## Run-end gates

A Gauntlet run never rates, never uploads boards / run history / telemetry / practice rows, never records fight
results, and never writes a replay draft. Loss screen: "Defeated, Stage S, Round R" with Retry (same stage, back to
hero select) and Home. Win screen: "Stage cleared!" plus the unlock line, Next stage (only when N+1 is playable) and
Home. Quitting mid-run resumes like a normal game (autosave covers it).

## Gauntlet panel and run-aware caps

A Gauntlet panel shows the stage, round and the round's cap; the caps (5 / 10 / 15 / none by stage band) are read
run-aware across the UI rather than assuming lobby rules.

## Timer

No clock until the player has spent 30 Gold in the round (`goldSpentThisTurn >= 30`); then a 60-second countdown.
At 0 it behaves like the normal timeout (reorder and freeze still allowed; no buy / sell / roll / play). This was
rebased over the Thymepiece changes to the shared timer path.

## Audio

Music on, announcer off. The Good Luck intro now also opens a Gauntlet run (`shouldPlayGoodLuckIntro` accepts
`gauntlet`), like any normal game.

## Practice lost bots

Owner direction: Practice is always against players. The Opponents and Bot difficulty rows are gone from
`PracticeOptions.tsx`; `loadPracticeConfig` and `confirmPracticeSetup` force `opponents: 'players'` so an old
persisted `bots` draft cannot stick. `PracticeConfig.opponents` stays in the sim type: Scene Builder builds its own
bots config in `startSceneBuilder`, and old saved runs and history rows still carry it.
