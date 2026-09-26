# 2026-09-26: Shop Rise watchers hear every shop Rise

Owner (2026-09-26): "yes fix this". The gap was logged in [2026-09-26-ancients-risen](2026-09-26-ancients-risen.md).

## What was wrong

A minion with Rise destroyed in the Shop comes straight back (`riseReturn`), but only ONE of the two shop destroy
paths told the Rise watchers. The deferred two-step death (`settlePendingDeath`: Cage Breaker, a Deathfibrillator, a
loan) called `fireOnRise` after the return. The immediate path (`destroyMinionInShop`: Warden x Ancient of Death's
Aegis, Auctioneer x Ancient of Death's Pulse) did not, so the minion Rose and Revenant, Rising Tide and Rune of the
Endless March never heard it. Ancient of Bonds (Lord of the Risen) worked around it with its own call inside
`riseReturn`.

## The fix

- `riseReturn` (the one Rise return every shop path shares) now calls `fireOnRise` itself, right after the return
  cue, so each shop Rise fires the watchers exactly once, at that moment, with the risen body as the payload
  (combat's `onRise` payload).
- `settlePendingDeath` no longer calls `fireOnRise` (it would have fired twice).
- Bonds' `ancientOnShopRise` moved from `riseReturn` into `fireOnRise` (first, as combat's Bonds listener is
  registered ahead of the minion watchers), so it is one watcher among the others and fires once.
- Buff FX: the watchers run inside `captureBuffFx`, the same as before, so a Rising Tide tendril plays on the
  immediate path too.
- Rebirth: checked, no gap to fix. A Rebirth return is not a Rise and there is no Rebirth watcher.

## Where

- `packages/sim/src/recruit.ts` (`riseReturn`, `fireOnRise`, `settlePendingDeath`).
- Oracle: **R-RISE-SHOP-01** in `packages/rules/src/registry/approved/triggers.ts`.
- Tests: `packages/sim/src/shopRiseWatchers.test.ts` (immediate path: Revenant, Rising Tide board + hand, Endless
  March, the buff FX; no double fire on either path; Rebirth silent; Bonds once on both paths).
- `docs/GAME-RULES.md` Rise watchers section; patch note.
