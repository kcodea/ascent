# Hero Aim → the `targeting` primitive as the live aim line (Phase 2)

Wires the workshop-authored `targeting` lasso (Phase 1) into the actual in-game targeting line, and hides the
OS cursor while aiming so the drawn pointer reads as 1:1.

## The driver (`pixiFx.ts`)

The old aim line was a bespoke `Graphics` curve (`drawAimLine`) with a clock-only wobble. It's replaced by a
persistent instance of the `targeting` primitive:

- `setAimLine(from, to, onTarget)` now just records the live aim state (the 4th `cfg` arg is kept for call-site
  compatibility but ignored — the look comes from the primitive/def, not `aimFxConfig`).
- `updateAim(dtMs)` (called each frame from the ticker) lazily spawns the primitive the first frame after it
  has registered — `getPrimitive('targeting')` at RUNTIME, never a static import, so the primitive + filter
  registry stay in their own chunk (see `primitives/index.ts`) — then feeds it `setAim(from→to)` / `setHead(to)`
  / `setOnTarget(onTarget)` and advances it.
- `clearAimLine()` destroys the instance + its container.

**The look is workshop-authored.** If a def named **`aim-targeting`** is committed, the driver uses its
`targeting` layer's params; otherwise the primitive's own defaults. So the owner tunes the aim line in the
workshop, saves it as `aim-targeting`, and the game plays exactly that (the same pattern as the embermouth
binding). `Recruit.tsx`'s call sites are unchanged.

## Hiding the OS cursor (`styles.css`)

`Recruit.tsx` already toggles `body.aiming`. Added `body.aiming, body.aiming * { cursor: none !important }`, so
while a targeted power is armed the hardware cursor is hidden and the Pixi pointer IS the pointer. This is what
actually removes the "tip lags the cursor" feel: a canvas-rendered follower can't out-run the hardware cursor,
but with no hardware cursor visible there's no faster reference — the drawn pointer reads as exact. (The
workshop preview still shows the OS cursor, so the small render-latency gap is visible there; the `Cursor lead`
knob mitigates it for previewing.)

## Follow-ups

- The old 🎯 **Hero Aim tuner** + `aimFxConfig` LINE params are now dead (the activation-burst half still uses
  `aimFxConfig`); retire the line half in a later pass.
- Player-facing (the aim line looks different) → a patch note lands when this ships to players.
