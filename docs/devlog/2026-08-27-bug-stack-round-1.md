# 2026-08-27 — Bug Board round 1: the owner's first real bug stack

The first work order to come through the in-game Bug Board (`.local/bug-reports/work-order.json`, four
reports, priority-ordered). Each was reproduced from its capsule with `npm run bugs:repro`, verified
against code/rulebook (player text treated as an untrusted claim), fixed with a regression test, and
closed with `npm run bugs:close`.

## 1. `86340900` — Growth's improved value missing from Mushy's popup (fixed)

Rune of Living Growth's accrual (`growthBonus`) was threaded into the shop and spell-slot chains, but the
**referenced-card popup** chain (`tokenRefView` in `Recruit.tsx`, fed by `refViewsByUid`) and the combat
**conjured fly-in** (`conjuredView`) never passed it — so hovering Mushy showed Growth at its base +1/+1
while the cast paid base + accrual. Fix: `growthBonus` rides `spellLive` into both sites (plus the memo
dep). `tokenRefView` is now exported for the regression test (`tokenRefView.test.ts`).

Lesson for the next live-value channel: `spellLive` is the popup chain's bag — a new scaler added to
`spellDisplayText`'s `extra` must be added there too, or the popup silently prints base.

## 2. `a1fa8d17` — "testing out the bug report" (closed, not a defect)

A reporter smoke-test. Capsule hydrates and re-executes cleanly; the description claims no defect.
Closed `closed` with a note.

## 3. `3abab276` — Window Shopping's free roll not on the Refresh pill (fixed)

The pill read `refreshCostOf(run)` directly (plus a `freeRolls` special case), so Rune of Window
Shopping's first-3-free allowance never showed — the coin said 1 Gold while the roll charged nothing.
New sim helper **`nextRefreshCostOf(s)`** mirrors the reducer's `roll` charge order (banked free rolls →
Window Shopping < 3 → `refreshCostOf`); the `RefreshButton` cost AND its `disabled` gate now read it —
which also fixes a real playability bug: a rune-free roll at 0 Gold used to render disabled even though
the reducer would have allowed it. Regression test in `runeMinionBatchAug11.test.ts` walks the pill
value against the actual charge roll-by-roll. Stale "first 4" comments corrected to 3.

## 4. `a17a48ab` — Great Pot ignores spell power (fixed — the owner's intent was in the report)

The report contained the design ruling: Great Pot SHOULD fold spell power. Its factory
(`buffOnePerTribe`, recruit.ts) shipped flat because its name slips the docbot spell-power tripwire's
`spellBuff*` prefix. Three-part fix:

- the factory folds `spellAttackBonus`/`spellHealthBonus` into each grant;
- `spellDisplayText` gets a `buffOnePerTribe` branch, so the printed +4/+4 goes live (live-text rule);
- `buffOnePerTribe` is added to the tripwire's `isStatFamily` extras (`spellPowerFolding.test.ts`), so
  the fold can't silently regress — the exact hole that let it ship flat.

Regression tests in `spellPowerAudit.test.ts` (cast folds, no-power base, live text).

Shipped as PR `fix/bug-stack-round-1`; patch notes entry "Bug Board Round 1".
