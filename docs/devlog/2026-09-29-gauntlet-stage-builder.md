# 2026-09-29 — Gauntlet Stage Builder (DEV tool)

A dev-only panel for authoring the Gauntlet's stage boards round by round, built on top of the Scene Builder
sandbox so every round can be fought against your own board with the real systems. Not player-facing: no patch
note, no oracle rule.

## Opening it

**Title → Stage Builder** (DEV builds only — the button, the `startStageBuilder` action and the lazy panel mount
are all `import.meta.env.DEV`-gated, so none of it reaches the player chunk). It starts a fresh Scene Builder
sandbox and opens stage 1, round 1. Stages 1–5 are editable; slots 6–10 show "no file yet".

## The draft / pin model

- The panel edits an in-memory **draft** of the stage; the selected round is **pinned** as the sandbox's next
  opponent (`servedBoards[wave]` + `sandboxFoeWave`, the rig-authored-foe marker).
- **Both surfaces edit the same round:** the panel's board/stat/keyword/tier controls, and the Scene Builder's
  tavern row (show-enemy mode). A tavern-row edit replaces the pin and folds back into the draft.
- **End Turn tests the round**, including the stage's runes (round 6 / round 9 slots). After the fight the
  selected round is re-pinned at the new wave, so you can keep testing it.
- An empty round drops the pin (the lobby seat fights instead) and says so.
- Unsaved rounds carry a dot; Close / switching stage while dirty asks first. Leaving the sandbox (e.g. a normal
  run starts) closes the builder outright, so a later plain Scene Builder launch is never pinned to a stage round.

## Saving

**Save all edits** validates the draft (`validateStage`), stamps each minion's `cardVersion`, and writes
`packages/content/src/gauntlet/stages/NN-*.json` through the dev server's `/__gauntlet/stage` endpoint
(`apps/web/gauntletStagePlugin.ts`). That is a file on disk only — **commit it and open a PR like any other
change.**

The stages directory is watcher-ignored so a Save does not force a page reload (which would throw away the
sandbox). Consequence: **the running game keeps the bundled stage data until the dev server restarts.** The
builder itself always loads from disk, so it sees your saved file immediately.

## Rules the panel enforces

- **A rune "acts for the opponent" only if it defines a combat modifier** (`runeActsForOpponent` →
  `runeCombatModsFor`: any field defined). An authored Gauntlet opponent has no recruit phase, so a shop-only
  rune (Gold, refreshes, Discovers, End of Turn) does nothing for it; those options carry "— no effect for
  opponents".
- **Printed keywords can't be removed.** A minion's keyword toggles only add/remove `addedKeywords`; a keyword
  printed on the card shows locked.
- Card drift (a card changed since the round was saved) is flagged per minion and per round.

## Adding stages 6–10

1. Create `packages/content/src/gauntlet/stages/NN-<slug>.json` (two-digit prefix; copy an existing stage's shape,
   `status: "draft"` allows empty rounds).
2. Add one import in `packages/content/src/gauntlet/index.ts` and put it in the `GAUNTLET_STAGES` array.
3. Restart the dev server; the slot becomes editable and Save writes to that file (the endpoint only ever writes
   an existing `NN-` file, never creates one).

## Verification

Store + panel tests in `packages/ui/src/stageBuilder/` (draft/pin sync, dirty tracking, save stamping, the close
confirm under the header, the builder closing when the game leaves the sandbox); full gate green; the production
bundle was grepped to confirm no Stage Builder string ships.
