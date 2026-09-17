# Targeting-line sparkles persist after the aim ends

**Owner report (2026-09-17):** the targeting lasso's sparkle particles vanish the instant you stop aiming.
They should live out their full length and fade on their own.

## Cause

`FxController.clearAimLine()` tore the whole aim composition down synchronously — `inst.destroy()` on every
layer plus `root.destroy({ children: true })`. That culls the live sparks (the `targeting` primitive's own
spark system) and the `emitter` motes on the same frame the line disappears, so anything still in flight blinks
out instead of fading.

## Fix — reuse the existing stop-emitting / drain contract

The `FxInstance` interface already carries `stopEmitting()` + `isComplete()` for the player's seamless-loop
drain. The aim line now uses the same contract on release:

- **`targeting` primitive** (`packages/ui/src/fx/primitives/targeting.ts`) gained `stopEmitting()` (sets a
  `stopping` flag) and `isComplete()` (true once its spark array is empty). While stopping, `update` emits no
  new sparks and draws neither the ribbon nor the pointer — it just steps and draws the sparks already in
  flight, so the line drops at once but its sparks fade in place. The spark draw was extracted into a shared
  `drawSparks()` so the released tail looks identical to the live one.
- **`clearAimLine()`** (`packages/ui/src/pixiFx.ts`) no longer destroys everything. Each layer that implements
  `stopEmitting` (the lasso's sparks, the emitter's motes) is stopped and carried into a new `finishingAim`
  drain set; tail-less layers (the cursor orb `custom` layer, which has no `stopEmitting`) are destroyed with
  the line. `drainAim` ticks each carried tail every frame and reaps it once every inst reports `isComplete`,
  with a 3 s safety cap (`AIM_DRAIN_CAP_MS`) so a stuck tail can never linger. `finishingAim` is included in
  `hasLiveWork()` so the auto-idle ticker stays awake while a tail drains.

A quick re-aim now reads correctly: the previous aim's sparks fade while the fresh line draws — the same
overlap the player's seamless loop already relied on.

## Verify

`typecheck:web` clean, lint clean on both files, all 1650 `packages/ui/src/fx` tests green. The visual itself
is GL-side (verified by eye in play, per the targeting primitive's test rationale).
