# 2026-09-22 — pixiFx.detach() retires every live def play

**What:** the board FX overlay (`PixiFxLayer`) detaches when the title screen unmounts it (`isPreRun`) and
around the rank preview, and re-attaches on return. `pixiFx.detach()` tore down its own hand-written effect
state and destroyed the Pixi Application with `{ children: true }`, but never touched the def-play runtime:
`extraUpdaters` (every `playDef` play's per-frame updater) and the FX budget registry (`fxBudget.ts`).

**The bug** (found by review on `feat/equipment-amplified-comet-fx`, pre-existing): fire a few one-shot def
plays on the shop (`equipment-used-up` twice, `self-buff-burst`), go to the title, come back. Pixi had
destroyed each play's containers and nulled its `ParticleContainer` shader's resources; the play's updater
survived on the controller, so the NEW context's first tick ran it, `setParticleTime` read
`shader.resources['fxUniforms']` on null, the external-updater guard logged
`[pixiFx] external updater threw — removing it to protect the overlay` once per play and evicted the updater.
`retire()` never ran, so each play stayed in the budget registry (`window.__fx.budget.live()`), in the
particle pool's `acquired` set and in the filter counters — ghosts counting against `maxParticles` for the
rest of the session. Reproduced on a throwaway run: three registry entries and three errors after the round
trip. Caller-owned loops (`amplified-slot`) were fine only because their owners dispose them on the same
unmount.

**The fix:**

- `fx/fxBudget.ts` gains `retireLivePlays()`: empties the registry first, then retires a snapshot of every
  play (protected loops included) through the play's own idempotent `createRetire` — the remove-then-retire
  shape `trim` already uses, so a retire that never reaches its own unregister leaves nothing behind. One
  throwing retire is logged and skipped rather than abandoning the rest. It is NOT a trim: `fx:culled` does not
  move.
- `pixiFx.detach()` calls it FIRST, before `resetFxPools()` and `app.destroy`, so every play tears down in its
  normal order (updater off → player + layers + filters + particles → unmount → container) against a live
  stage and its pooled pair files back into the pool normally. Gated to the board controller (`!this.label`),
  the same gate as the shared counters, because `playDef` only ever plays through `pixiFx`, never
  `discoverFx`. It then clears `extraUpdaters` (covers the DEV workbench's own updater) and `pendingMounts`
  (a container queued before `init()` would otherwise be added to the next app's stage).
- A caller-owned loop retired at detach: the owner's later dispose (`useAmplifiedSlotFx`'s `stop()`,
  the Discover (Both) markers, `useCiaEnchantedFx`, `milestoneBadgeFx`, the Library preview) is the same
  `retire` and a no-op through its `done` flag — no second teardown. A detach is now "a new world": an owner
  that outlived a detach/re-attach without unmounting would need to restart its loop (none does today; every
  owner unmounts on the same `isPreRun` flip).

**Verification:** `packages/ui/src/fx/detachRetiresLivePlays.test.ts` seeds the controller's private
`app`/`layer` with a fake whose `destroy({ children })` destroys the stage, runs the REAL
`rendererFor`/`mountLayer`/`addUpdater`, and pins: registry + updater list empty after detach, every stub
destroyed once in age order, `fx:culled` untouched, a re-attach tick throws nothing and logs nothing, a loop
disposed after detach neither throws nor re-destroys. Sabotage-checked: with the three fix lines commented
out, two of three tests fail (`destroyed` stays `[]`, registry holds 2). Browser re-check on a throwaway run:
registry empty at the title, zero console errors after the round trip and a fresh play, the amplified-slot
loop unaffected. Oracle: `R-PRESENT-04` (`packages/rules/src/registry/approved.ts`), report counts
173 / 87.

Not a gameplay change: no patch note.
