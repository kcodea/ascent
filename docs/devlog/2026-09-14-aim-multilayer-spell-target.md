# Live aim line plays the whole `spell-target` def (multi-layer), not just the lasso

The in-game targeting line — the animation drawn while you aim a targeted spell, hero power, or equipment —
used to be driven by a hand-rolled path in `pixiFx.updateAim` that spawned exactly **one** primitive
(`targeting`) and bound to a def named `aim-targeting` that never existed (so it rendered the primitive's bare
defaults). Any other layer an author added to that def was ignored in-game: it previewed in the workshop and
vanished the moment it played for real.

## What changed

`updateAim` now plays **every layer** of an FX def (`AIM_DEF_ID = 'spell-target'`), spawning each layer's
primitive into its own container under a shared `effectRoot`, and routing anchors through the **same**
`driveLayerHeads` the workshop preview uses — so in-game matches what was authored:

- `cursor` → the live pointer
- `source` → the caster
- `target` / `travel` → the cursor end

Spawning is **all-or-nothing**: primitives self-register asynchronously (dynamic import keeps GLSL out of the
entry chunk), so the driver waits until *every* layer's primitive is available before spawning any of them —
a partial spawn would strand a custom/emitter layer forever. A missing def falls back to a single
cursor-anchored `targeting` layer (the primitive defaults), so the line always draws.

The head sink over the instance array is built once at spawn, so the per-frame drive allocates nothing beyond
the small points `resolveAnchor` returns.

## What this unlocks

`spell-target` ships as a two-layer def: the glowing `targeting` lasso **plus** a `custom` image that rides
the cursor. The same path will play a cursor-anchored `emitter` layer (continuous sparks from the pointer)
with no further driver work — the emitter already streams endlessly and inherits its origin's velocity via
`setHead`.

## Scope

- Replaces the aim LINE for all three targeting gestures (spell cast, hero power / equipment, two-target
  picker) — they already shared the one driver.
- The one-shot **landing bursts** at the target on release (`hero-power-target`, `auctioneer-hp`,
  `echohorn-target-sparkle`) are a separate concern and were deliberately left untouched (owner ask).
- Ships the committed `spell-target.json` def and its `test-orb.png` image (previously a local-only import).

Files: `packages/ui/src/pixiFx.ts`, `packages/ui/src/fx/defs/spell-target.json`,
`packages/ui/src/fx/defs/images/test-orb.png`, `packages/ui/src/patchNotes.ts`.
