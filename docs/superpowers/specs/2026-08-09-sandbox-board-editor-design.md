# Sandbox board editor — the FX rig becomes the real game

**Date:** 2026-08-09
**Status:** approved (owner, 2026-08-09)

## The problem

Authoring an effect means watching it fire on a real combat moment, repeatedly, on a board you control.
Today none of those three things hold together at once:

- The **FX workbench stages its own 3v3 board** (shipped 2026-08-08, PR #936). It is scenery: nothing on it
  fights, so an effect can only be previewed in isolation, never fired by an actual attack, death or buff wave.
- The **Scene Builder** runs a genuine sandbox (`startSceneBuilder` → a real `practice`-mechanics run, 999
  Gold, selectable tier and set), and ending a turn there runs a real `simulate()` with real moments and real
  FX. But the only opponent it can author is *N identical `sandbag` dummies at one hp/attack pair* — no real
  cards, no per-unit control, no keywords.
- **Nothing can edit a unit that is already on a board.** Yours arrive by buying and buffing; there is no way
  to say "make that one a 40/40".
- A fight can be watched **once**. Re-watching means rebuilding both boards.

So the rig that can fight cannot be authored, and the rig that can be authored cannot fight.

## The shape

**The Scene Builder's sandbox run IS the stage.** The workbench stops rendering a board of its own; what gets
added is the ability to author both boards in place, and to re-watch a fight.

This supersedes most of the stage shipped yesterday. Deleted: `fx/ui/Stage.tsx`, `fx/ui/stageBoard.ts`,
`fx/ui/stageBoard.test.ts`, the `.fxwb-stage` CSS block, and the workbench's stage state/controls.
`boardAnchors.boardRoot()` reverts to plain document queries — it existed only to disambiguate a fake board
from a real one on screen at the same time, and with one board there is nothing to disambiguate. The
workbench's "React on" picker reverts to listing the run's real units.

Untouched from that PR: the pipeline rail, the house-rules reskin, the language pass, and the two bug fixes
(the `undefined` slider, Escape reaching the game).

## 1 · Click a unit to edit it

Clicking a minion opens a popover anchored to that card: **card picker · attack · health · keywords**.
Applies live; no confirm step.

Gated behind an **Edit mode** toggle in the Scene Builder. This is not ceremony: a bare click already means
something on both rows (drag to reorder, drag to sell, buy from the shop), and the rig must leave normal play
intact — the shop phase is where some of the interactions under test only ever happen. A mode is the smallest
thing that keeps both.

**Editing sets a unit's BASE stats** (owner ruling 2026-08-09). A 40/40 you typed reads as a 40/40, with
neutral badges — not as "+38 buffed" in green. Rationale: the number you typed is the number you meant, and
a buff-coloured badge would be asserting a history the unit does not have. Testing buff-coloured badges is
what an actual buff is for.

## 2 · Flip the top row to the enemy

A **Shop ⇄ Next enemy** toggle swaps what the tavern row renders:

- **Shop** (default) — exactly today's behaviour, untouched.
- **Next enemy** — whatever is pinned at `servedBoards[wave]`, up to 7 units, each clickable and editable
  exactly like yours, plus add/remove per slot. With nothing pinned the row is empty and every slot is an
  add button; the existing `glass ×7` / `tank` / `bruisers` presets still work and simply show up here.

Flipping is a render switch, not a state change, so returning to the shop leaves it precisely as it was.
While flipped, buying and dropping into that row are disabled — there is nothing to buy there.

This writes `servedBoards[wave]`, the same pinned-board mechanism the Scene Builder's dummies already use and
which combat reads verbatim (`nextOpponent`). The board authored here is *literally* the board that fights;
there is no translation step that could drift.

Rendering the enemy in the tavern row, rather than as an extra row, is deliberate: it puts enemy units where
enemy units actually sit, so on-screen distance and travel match a real fight. That is the whole point for FX.

## 3 · Watch it again

After a fight, **Run it again** re-plays it: same boards, same seed, same beats. The run does not advance and
the wave stays pinned.

Cheap by construction. `useCombatReplay(combat, …)` is driven off `run.lastCombat`, a stored `CombatResult`,
so re-watching is re-mounting the replay with the same result object — no re-simulation, and byte-identical
by definition rather than by luck. Mechanically: return `run.phase` to `'combat'` with `lastCombat` intact and
remount the replay from beat 0.

The load-bearing constraint is that a replay must **re-run the animation and nothing else**. Resolving a real
fight also settles Resolve, the wave, quests, telemetry and the autosave; a replay must reach none of that.
So it is a store action that moves `phase` and remounts, NOT a re-dispatch of the action that produced the
fight — a second `faceOmen` would resolve a second combat, and the run would silently advance behind a
button labelled "watch that again".

## Explicitly not building

- **Editing during combat.** The replay is a recording of a resolved fight; there is nothing to edit.
- **Saving/loading scenarios.** Worth having, not before the rig has been used once.
- **A synthetic moment with no fight around it.** The owner chose a real `simulate()`; a fabricated moment
  would be a second, weaker path to the same place.
- **Battlecry on placement.** A placed card arrives as if it had always been there (owner ruling 2026-08-09).
  To watch a Battlecry, buy it from the shop — which already works. Running summon effects on placement would
  let the editor change *other* units as a side effect, making "set that one to 40/40" unpredictable.

## Architecture

Split along the existing simulation ↔ presentation seam. Nothing in `core`/`content`/`sim` changes: both
boards are authored through state the run already models.

| Unit | Purpose | Depends on |
|---|---|---|
| `sandboxEdit.ts` (new, `packages/ui/src`) | PURE: the edits as data — set a slot's card, set base attack/health, toggle a keyword, add/remove an enemy slot. Total functions over `RunState`/`BoardSnapshot`, no DOM, no store. Unit-tested directly. | `@game/core`, `@game/sim` types |
| `UnitEditor.tsx` (new) | The popover: card picker, two number fields, keyword toggles. Anchored to a card element. Pure presentation over a value + `onChange`. | `sandboxEdit`, `@game/content` |
| `SceneBuilder.tsx` (edit) | Owns Edit mode, the Shop ⇄ Next enemy toggle, and Run it again. Applies `sandboxEdit` results through the store. | the two above |
| `Recruit.tsx` (edit) | Renders the enemy board in the tavern row when the toggle is on; routes a click in Edit mode to the editor instead of drag/buy. | store flags |
| `store.ts` (edit) | Two sandbox-only flags (edit mode, tavern row contents) and a `replayLastCombat` action. | — |

The pure/impure split mirrors `boardAnchors.ts` and `reactTargets.ts`: the rules live in a total, testable
module; the components stay thin. This repo has no jsdom, so anything worth asserting has to be pure to be
tested at all — that constraint sets the boundary.

## Testing

- **`sandboxEdit.test.ts`** — every edit is a pure function, so all of it is directly testable: setting a slot's
  card preserves its uid; setting stats writes base stats and leaves the buff breakdown alone; keyword toggles
  are idempotent; enemy add/remove clamps to 7 and never produces an empty board (an empty board ends combat
  instantly and would read as "the rig is broken").
- **A served-board round trip** — author an enemy board, assert `servedBoards[wave]` holds exactly those units,
  and that `nextOpponent` returns them verbatim. This is the claim the whole feature rests on.
- **Manual, in a browser** — the popover positions correctly on both rows; the toggle leaves the shop intact;
  a fight runs on the authored boards; Run it again reproduces it.
- Gates: `npm run typecheck && npx eslint packages apps && npm test && npm run build:web`.

## Risks

**Editing writes into live run state, and a `Minion` carries more than attack and health** — buff breakdowns,
per-instance counters, keyword grants, `baseAttack`/`baseHealth` floors. Setting raw numbers can put a unit
into a state the sim never produces on its own. Mitigation: the editor touches only fields that are safe to
set independently and leaves the rest derived. If a sandbox fight behaves oddly, this is the first place to look.

**Edit mode overlaps real input.** Clicking a card in the shop buys it; dragging a board minion reorders or
sells it. The mode toggle is what keeps these apart, and it must be visibly on — an invisible mode that
swallows clicks would be worse than no editor.

**Sandbox only.** Every flag added here is gated on `run.sandbox`, and all of it is stripped from production
with the rest of the dev tooling. None of this can reach a played run.
