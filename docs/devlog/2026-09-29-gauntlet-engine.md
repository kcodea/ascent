# 2026-09-29 — Gauntlet engine (PR 1 of 4)

Engine-only foundation for the **Gauntlet**: a single-player mode against one authored, invulnerable opponent.
Nothing here is player-visible yet, so there is no `patchNotes.ts` entry; that lands with PR 3.

**What shipped**

- **`mode === 'gauntlet'`** — a 2-seat lobby (the player vs one authored seat), `maxRounds: 10`. The authored
  opponent is invulnerable: it never loses Resolve, so the run ends on the player's Resolve or by clearing the
  stage. `createGauntletRun(seed, heroId, stage, setId?)` and `gauntletOutcome(run)` are the entry points;
  `RunState.gauntletStage` carries the stage.
- **Stage format** — `GauntletStage` / `GauntletRound` / `GauntletMinion` with `validateStage` and `stageDrift`,
  as JSON under `packages/content/src/gauntlet/stages/NN-<name>.json` (this is the Stage Builder's Save target).
  Five DRAFT stages ship: demons, kobolds, dragons, dwarves, beasts. Exposed via `GAUNTLET_STAGES` / `gauntletStage(n)`.
- **Authored minion data** — golden flag, added keywords and explicit tiers are all authorable per minion.
- **Per-lobby loss caps** — the lobby rules gain `lossCaps`, and `roundLossCap(rules, round)` / `runLossCap(run)`
  replace direct `lossDamageCap(...)` calls for anything run-aware. Non-gauntlet lobbies keep the old cap.
- **Opponent runes** — an authored opponent's runes act through `runeCombatModsFor(ids)`. Only
  combat-modifier runes have an effect for an opponent; shop/economy runes do nothing for it (an empty result is
  the Stage Builder's "no effect for opponents" badge).

**Judgement call (flag for the owner):** blank rounds (no authored tier) use `GAUNTLET_DEFAULT_TIERS` =
`1,2,2,3,3,4,4,5,5,6`. That curve is my assumption, not an owner ruling; it is a one-line constant to change.

**Follow-ups:** PR 2 Stage Builder, PR 3 screens (Play-menu node, stage select, HUD opponent portrait, win/loss,
Recruit turn clock rule, switching every UI `lossDamageCap` and odds call to the run-aware cap, removing "vs bots"
from `PracticeOptions`), PR 4 progress + crates. The existing `mode === 'lobby'` gates in `store.ts` (rating, board
upload, telemetry) stay closed for gauntlet because the mode differs; PR 3 must verify that.
