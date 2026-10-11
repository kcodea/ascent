# 2026-10-10 · Pixi FX layer dying for the session (R-PRESENT-32)

The owner's report (2026-10-10), verbatim: *"sometimes i have an issue with like... my hero power or spell targeting
animation completely not loading, and neither will other pixi effects. can you figure out why"*.

## Root cause (reproduced live)

The hero ceremony, the crate opener and `pixiFx.detach()` tore their Pixi apps down with
`destroy({ releaseGlobalResources: true })`. `HeroAttackPreview` used `destroy(true)`, which does the same. That calls
Pixi's `GlobalResourceRegistry.release()`, which empties Pixi's MODULE-GLOBAL pools: `TexturePool`, `BigPool` and the
batch pool. Every live renderer on the page shares those pools, so the board overlay was left holding objects that
had just been destroyed. Its next filter pass threw `TypeError: Cannot read properties of null (reading '2')` inside
`FilterSystem._applyFiltersToTexture` → `BindGroup.setResource`. The spell-target aim line is filter-built, so it was
the first effect to hit this.

Pixi v8's `Ticker._tick` does not catch a listener's throw. It skips the next `requestAnimationFrame` and leaves
`started === true`, so `ticker.start()` is a no-op from then on. `pixiFx.wake()` only ever called `start()`, so every
Pixi effect stayed dead until a reload. It was intermittent because it needs the board overlay to have used a filter
before another app's teardown released the pools.

Evidence, from a console harness on a dev server: attach the overlay, aim (fine x2), init and destroy a throwaway
Application with `releaseGlobalResources: true`, then aim. The next aim threw, and the ticker was stuck at
`started: true, _requestId: null`. The same cycle with no global release was clean 5/5.

**Ruled out:**
- **WebGL context loss.** A forced `WEBGL_lose_context` loss and restore kept the overlay rendering. Pixi restores the
  context itself, and `destroy` loses the context, so the live count stays bounded: about 5 in a run (over, under,
  above, Discover, wipe), plus one transient for the ceremony, crate or preview.
- **The `pixiNoDomEvents` detach.** No canvas is interactive; the aim is driven from DOM pointer events.

## Fix

- **`packages/ui/src/pixiAppSafety.ts`** (new):
  - `destroyPixiApp`: never releases the global pools.
  - `guardAppRender`: the app's render listener, wrapped in try/catch.
  - `reviveTicker`: stop, then start, when a ticker is found started with no frame requested.
  - `watchContextLoss`: counts real context losses and ignores the deliberate loss at destroy.
  - `reportFxFault`: logs `[pixi fault]` and moves the perf counters `fx:faults` and `fx:ctx lost`.
- **`pixiFx.ts`**:
  - The sim, the aim line and the aim tail are each isolated. A throwing aim def drops only that aim, and the next
    `setAimLine` respawns it.
  - Under, above and main renders are guarded.
  - `wake()` and `setPaused(false)` revive a dead ticker.
  - A main render that fails 24 frames running rebuilds the overlay on the same parent (`scheduleRebuild`). This was
    verified live: with the pools forcibly poisoned, it rebuilt once after 26 faults, then ran with zero faults, and
    aim plus bursts were back.
- **`detach()`** now forgets the aim's instances but keeps the gesture, so a live aim respawns on the new Application. Before, the first tick after a re-attach threw on destroyed Graphics.
- **Callers.** The ceremony, crate FX, attack preview and wipe all use the helpers.
- **Test.** `pixiAppSafety.test.ts` covers:
  - a source scan: no global release anywhere, and every non-singleton app is torn down through `destroyPixiApp`;
  - the render guard;
  - the ticker revive;
  - per-def aim isolation and the above-slot render guard.
