# 2026-11-02 · The flaky Scene Builder Duos pass test: a random placeholder hero with a turn-1 choice

`packages/ui/src/sbDuos.test.ts` > "passes both ways through the local channel..." failed on three PRs in one day
(`test (light 1/3)`, `expected undefined to be 'p2:0'`) and passed on re-run. Branch `test/deflake-sbduos`. Rule
R-SB-DUOS-02 (approved/foundation.ts).

## Root cause

- Not a timing race, not shard state. `startSceneBuilder` seeds the rig with `randomSeed()` (`Math.random`), and the
  placeholder teammate's hero is picked from that seed (`sbMateHero`).
- About one seed in 15 picks a hero whose run opens on a turn-1 choice (Disco Dan, Brackus, Mimic). With a choice open,
  the reducer's `modalOpen` gate refuses `passCard` (and `sell`), so the teammate's pass never entered their outbox and
  nothing reached your hand. A seed sweep of 300 rig starts reproduced it 20 times, all on those three heroes.
- A real DEV-tool bug on top: the tuner still said "Passed Hitchhiker" and left the card in their hand.

## Fix

- `sbMatePasses` (hand / picked card) and `sbMateSells` check `modalOpen` on the teammate's run first and say
  "Refused: they have a choice to make first". The board-minion effect pass is not a reducer action and is unaffected.
- The test pins the rig seed (`Math.random` mocked only around `startSceneBuilder`), asserts the teammate has no choice
  open, and a new case covers the refusal.
