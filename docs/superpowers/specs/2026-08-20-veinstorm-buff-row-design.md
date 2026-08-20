# Buffs panel: Veinstorm Stats row + Shop Stats rename — Design

**Date:** 2026-08-20
**Branch:** `feat/veinstorm-buff-row` (worktree off `origin/main`)
**Owner seam:** presentation (`packages/ui/**`) — Mike's domain. No engine/content/sim change.

## Summary

Add a new row to the run-buffs panel (the pop-out beside the hero portrait) that shows the Ruby stats
Veinstorm has stamped onto the shop, and rename the existing "Tavern buys" row to "Shop Stats".

The panel is built by `gatherRunBuffs(run, combat)` in `packages/ui/src/runBuffs.ts`, which returns a
`BuffRow[]` (each `{ key, label, value }`, value like `+X/+Y`). Every row inherits the panel's styling, so a
new `BuffRow` looks identical to the others with no CSS work.

## Decisions (from brainstorming)

- **New row "Veinstorm Stats"** reads the run-wide accumulator **`run.veinstormRubies` = { atk, hp }**, which
  `spellBuffShopByRuby` banks on every Veinstorm cast and re-stamps onto every fresh shop offer. Its value is
  the **per-offer stamp** — the Ruby `+atk/+hp` each shop minion carries — shown as `+atk/+hp`, exactly like the
  sibling rows. (Owner ruling: per-offer stamp, not the total across all offers.)
- **Rename** the existing "Tavern buys" row label to **"Shop Stats"** (that row reads `run.tavernBuyBonus`, the
  permanent per-buy bonus). Its internal `key: 'tavern'` is unchanged.
- **No engine change.** `veinstormRubies` is already a `RunState` field (`state.ts:1507`), tracked by
  `spellBuffShopByRuby` (`recruit.ts:4961`) and covered by the existing sim test
  `spellstoneRubySynergy.test.ts` (asserts the bank value).
- This **reverses** the deliberate "Veinstorm has no row here" note in `runBuffs.ts` (the value used to be
  considered visible only on the offers themselves) — an owner-requested change.

## Implementation

In `packages/ui/src/runBuffs.ts`, inside `gatherRunBuffs`:

1. Change the tavern row's label:
   ```ts
   // was: label: 'Tavern buys'
   if (tav && (tav.atk > 0 || tav.hp > 0)) rows.push({ key: 'tavern', label: 'Shop Stats', value: `+${tav.atk}/+${tav.hp}` });
   ```
2. Add the Veinstorm row, placed with the other shop rows (replacing the "Veinstorm has no row here" comment):
   ```ts
   const vein = run.veinstormRubies;
   if (vein && (vein.atk > 0 || vein.hp > 0)) rows.push({ key: 'veinstorm', label: 'Veinstorm Stats', value: `+${vein.atk}/+${vein.hp}` });
   ```
   Shown only when non-zero (same guard pattern as every other row).

Row ordering: the Veinstorm row sits immediately after the left/right-most Shop-slot rows, grouping it with the
other shop-related rows and directly below the renamed "Shop Stats" row.

## Testing

- **Unit test** (`packages/ui/src/runBuffs.test.ts`, extend or create): call `gatherRunBuffs` on a `RunState`
  with `veinstormRubies: { atk: 2, hp: 2 }` and assert a row `{ key: 'veinstorm', label: 'Veinstorm Stats',
  value: '+2/+2' }` is present; with `veinstormRubies` absent/zero, assert no such row. Assert the tavern row
  (`tavernBuyBonus: { atk: 1, hp: 1 }`) now renders `label: 'Shop Stats'`.
  - Build the `RunState` the same way the existing runBuffs tests do (if a test file exists) or via a minimal
    stub of the fields `gatherRunBuffs` reads (`board: []`, plus the two bonus fields). Confirm the real shape
    against `state.ts` while writing the test.
- **Gates:** `npm run typecheck && npm run lint && npm test && npm run build:web` all green (worktree needs its
  own `npm install` first — CLAUDE.md).
- **Live check (optional, owner):** cast Veinstorm in a run and confirm the "Veinstorm Stats" row appears with
  the right value, and the renamed "Shop Stats" row.

## Out of scope

- Any change to how Veinstorm/Rubies apply stats (engine behavior is unchanged).
- Reconciling the semantic overlap between "Shop Stats" (buy bonus) and "Veinstorm Stats" (Ruby stamp) beyond
  the owner-chosen names.

## Files touched

- `packages/ui/src/runBuffs.ts` — the label rename + the new row.
- `packages/ui/src/runBuffs.test.ts` — new/extended unit test.
- `docs/devlog.md` — a dated entry (README/roadmap unchanged for a minor UI row).
