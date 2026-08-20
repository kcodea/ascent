# Veinstorm Stats buffs-panel row + Shop Stats rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Veinstorm Stats" row to the run-buffs panel (Ruby stats stamped on the shop) and rename the "Tavern buys" row to "Shop Stats".

**Architecture:** Both are edits to `gatherRunBuffs` in `packages/ui/src/runBuffs.ts`, which returns `BuffRow[]` ({key,label,value}); each row inherits the panel styling automatically. The new row reads the existing `RunState.veinstormRubies` accumulator. Pure UI — no engine change.

**Tech Stack:** TypeScript, React (`packages/ui`), Vitest.

## Global Constraints

- **UI-only.** No change to `packages/core|content|sim`. `veinstormRubies: { atk, hp }` already exists on `RunState` (`state.ts`) and is tracked by `spellBuffShopByRuby` (`recruit.ts`).
- **Value = per-offer stamp:** the Veinstorm row shows `+veinstormRubies.atk/+veinstormRubies.hp` (owner ruling), the Ruby `+atk/+hp` each shop minion carries — same `+X/+Y` format as every other row.
- **Show only when non-zero**, matching every other row's guard.
- **Branch/PR:** work on `feat/veinstorm-buff-row` (worktree off `origin/main`). `npm install` in the worktree before trusting gates (CLAUDE.md). Never push to `main`; PR → green `verify` → squash-merge. Update `docs/devlog.md` in the same PR (README/roadmap unchanged for a minor row).
- **Gates:** `npm run typecheck && npm run lint && npm test && npm run build:web` all green before "done".

## File Structure

- `packages/ui/src/runBuffs.ts` — the label rename + the new row (both inside `gatherRunBuffs`).
- `packages/ui/src/runBuffsPanel.test.ts` — extend (do NOT create a new file; this is the existing home for `gatherRunBuffs` row tests).
- `docs/devlog.md` — a dated entry.

---

### Task 1: The Veinstorm Stats row + Shop Stats rename

**Files:**
- Modify: `packages/ui/src/runBuffs.ts` (inside `gatherRunBuffs`; the tavern row ~L161-162 and the "Veinstorm has no row here" comment just below the shop-slot rows ~L173)
- Test: `packages/ui/src/runBuffsPanel.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `gatherRunBuffs(run: RunState, combat?: CombatBuffDelta | null): BuffRow[]` (existing); `BuffRow = { key: string; label: string; value: string }`; `RunState.veinstormRubies?: { atk: number; hp: number }`, `RunState.tavernBuyBonus: { atk: number; hp: number }` (both existing).
- Produces: a new row `{ key: 'veinstorm', label: 'Veinstorm Stats', value: '+A/+H' }`; the `tavern` row's label becomes `'Shop Stats'`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ui/src/runBuffsPanel.test.ts` (it already imports `createRun`, `RunState`, `gatherRunBuffs` and defines `const run = (over) => ({ ...createRun(5), ...over } as RunState)` — reuse that helper):

```ts
describe('Buffs panel — Veinstorm Stats + Shop Stats rename', () => {
  it('shows the Veinstorm Stats row from the veinstormRubies bank (per-offer stamp)', () => {
    const rows = gatherRunBuffs(run({ veinstormRubies: { atk: 2, hp: 2 } }));
    const row = rows.find((r) => r.key === 'veinstorm');
    expect(row, 'a Veinstorm Stats row exists').toBeTruthy();
    expect(row!.label).toBe('Veinstorm Stats');
    expect(row!.value).toBe('+2/+2');
  });

  it('has no Veinstorm row when the bank is absent or zero', () => {
    expect(gatherRunBuffs(run({})).some((r) => r.key === 'veinstorm')).toBe(false);
    expect(gatherRunBuffs(run({ veinstormRubies: { atk: 0, hp: 0 } })).some((r) => r.key === 'veinstorm')).toBe(false);
  });

  it('renames the tavern buy-bonus row to "Shop Stats"', () => {
    const rows = gatherRunBuffs(run({ tavernBuyBonus: { atk: 1, hp: 1 } }));
    const row = rows.find((r) => r.key === 'tavern');
    expect(row, 'the tavern buy-bonus row exists').toBeTruthy();
    expect(row!.label).toBe('Shop Stats');
    expect(row!.value).toBe('+1/+1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/ui/src/runBuffsPanel.test.ts -t "Veinstorm Stats"`
Expected: FAIL — the Veinstorm row doesn't exist yet and the tavern label is still `'Tavern buys'`.

- [ ] **Step 3: Rename the tavern row label**

In `packages/ui/src/runBuffs.ts`, change the tavern row (currently):

```ts
  if (tav && (tav.atk > 0 || tav.hp > 0)) rows.push({ key: 'tavern', label: 'Tavern buys', value: `+${tav.atk}/+${tav.hp}` });
```

to:

```ts
  if (tav && (tav.atk > 0 || tav.hp > 0)) rows.push({ key: 'tavern', label: 'Shop Stats', value: `+${tav.atk}/+${tav.hp}` });
```

(Keep the preceding `const tav = run.tavernBuyBonus;` and the `// Permanent tavern buy bonus …` comment as-is.)

- [ ] **Step 4: Add the Veinstorm Stats row**

Replace the comment block just below the left/right-most Shop-slot rows (currently):

```ts
  // (Veinstorm has no row here: it plays real Rubies onto the tavern minions in front of you rather than
  // running a run-wide channel, so its value is visible ON those offers — see `spellBuffShopByRuby`.)
```

with the row (owner reversed that call 2026-08-20):

```ts
  // Veinstorm's banked Ruby stamp — the +atk/+hp each shop offer carries, re-landed on every fresh roll by
  // `spellBuffShopByRuby` (the bank in `run.veinstormRubies`). Owner ask 2026-08-20: surface it as its own row.
  const vein = run.veinstormRubies;
  if (vein && (vein.atk > 0 || vein.hp > 0)) rows.push({ key: 'veinstorm', label: 'Veinstorm Stats', value: `+${vein.atk}/+${vein.hp}` });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/ui/src/runBuffsPanel.test.ts`
Expected: PASS (the new block + the pre-existing shop-slot/fodder tests).

- [ ] **Step 6: Full gate**

Run: `npm run typecheck && npm run lint && npm run build:web`
Expected: green. (The full `npm test` runs in Step 8's commit-readiness / CI; running the one test file above already covered the changed logic.)

- [ ] **Step 7: Update the devlog**

Prepend a dated entry to `docs/devlog.md` (match the file's format; read its top first): the new "Veinstorm Stats" row (reads `run.veinstormRubies`, the per-offer Ruby stamp) + the "Tavern buys" → "Shop Stats" rename; note it's UI-only (no engine change) and reverses the old "Veinstorm has no row" note by owner request; verified by the `runBuffsPanel.test.ts` cases + gates.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/runBuffs.ts packages/ui/src/runBuffsPanel.test.ts docs/devlog.md
git commit -m "feat(ui): Veinstorm Stats buffs-panel row + rename Tavern buys to Shop Stats"
```

---

## Self-Review

**Spec coverage:**
- New "Veinstorm Stats" row from `run.veinstormRubies`, per-offer stamp, non-zero guard → Task 1 Steps 4 + 1. ✔
- "Tavern buys" → "Shop Stats" rename (key unchanged) → Task 1 Step 3 + test. ✔
- No engine change → constraints; only `runBuffs.ts` + its test + devlog touched. ✔
- Test coverage (row appears, hidden when zero, rename) → Task 1 Step 1. ✔
- Devlog → Step 7. ✔

**Placeholder scan:** none — every step has the exact code/anchor.

**Type consistency:** `gatherRunBuffs`, `BuffRow` `{key,label,value}`, `veinstormRubies.{atk,hp}`, `tavernBuyBonus.{atk,hp}`, keys `'veinstorm'`/`'tavern'`, labels `'Veinstorm Stats'`/`'Shop Stats'` — consistent between the implementation steps and the tests.

**Note:** line numbers are from `feat/veinstorm-buff-row` at plan time; match on the quoted code if they've shifted.
