# 2026-09-23 — Scene Builder "broken": two stores in one tab (HMR), not a code regression

Owner report (verbatim, with a screenshot): *"the scene builder is broken for me for some reason. can you please
fix this? i dont have infinite money in god mode and cannot add cards to the shop"*. The screenshot: the panel on
"round 1 · 8 left · GOD", the Gold pill on **4**, a Library click changing nothing on the shop row.

## What it was

No one of today's fourteen merges broke the rig. On a clean page load every flow works on current `main` and
on the owner's own server (port 5173, build stamp `fd8ee7d18`, a fresh tab): God rules open on 999 Gold, a
Library click lands in the shop, "+ enemy" pins the row, round 2 keeps 999.

The owner's tab was different: the dev server had been up since `fd8ee7d18` (#1643, 07:25) and had taken every
merge since through Vite HMR. Two of them touched `packages/ui/src/store.ts` (#1644 `6e5573828`, #1653
`91c5bde34`) and several more touched modules under it (`@game/sim` in #1647, the announcer slice). The store
module has a single top-level `create<GameStore>(...)`, so **re-evaluating it under HMR mints a second Zustand
store**, booted from the localStorage save. Every module the patch re-executed bound to the new store; every
module it did not kept the old one.

Reproduced on port 5263 with the sandbox open:

- touching `store.ts`: `window.useGame` changed identity; the store the panel held still had the sandbox
  (999 Gold, `sandbox: true`) while the new one held the saved run (Indy, 3 Gold). A Library click grew the old
  store's shop only.
- touching `announcerSlice.ts` (a store dependency): Vite's batch was `Game.tsx, EscMenu.tsx, Recruit.tsx,
  store.ts` then `hmr invalidate Recruit.tsx (Could not Fast Refresh)` then `Game.tsx, SceneBuilderPreview.tsx`.
  `SceneBuilder.tsx` is never in the batch, so the panel keeps the old store while the board and the Gold pill
  render the new one. That is the owner's screenshot exactly: the panel on the sandbox, the pill on the saved
  run's 4 Gold, `mutate` writing where nothing renders.

The manual workaround was always a page reload. Nobody had hit it before because store.ts rarely changed twice
in a sitting with the rig open.

## The fix

`store.ts` now declares itself not hot-swappable: an `import.meta.hot.accept(() => window.location.reload())`
guard next to the DEV `window.useGame` handle. Any HMR update that would re-evaluate the store (itself, or
anything under it) reloads the page instead of patching it, so a tab can never hold two stores. Verified live:
both touches above now produce `performance.getEntriesByType('navigation')[0].type === 'reload'`, one store,
the title. Absent in production (`import.meta.hot` is undefined) and in vitest (same). The save survives the
reload; a sandbox is disposable by design.

Not changed: the panel's `mutate` (direct `useGame.setState`), the God/normal rules, the refill, the reducer.

## Tests + oracle

- `packages/ui/src/sceneBuilderPanel.test.tsx` (jsdom, mounts the real panel over the store): God rules open on
  999 and the refill tops a dip back up; a Library click puts THAT card in the shop row; "+ enemy" pins one more
  minion for this wave; and a source tripwire that `store.ts` has exactly one `create<GameStore>(` and exactly
  one `import.meta.hot.accept` whose body is the reload.
- Oracle rule **R-PRESENT-09** (`packages/rules/src/registry/approved/foundation.ts`): one store per tab; the
  store is never hot-swapped; the panel writes the store the board reads.

No patch note: Scene Builder is a dev tool.
