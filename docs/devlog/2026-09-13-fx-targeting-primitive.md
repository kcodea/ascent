# FX `targeting` primitive — the glowing magic lasso (Phase 1)

A new workshop-authorable primitive for the Hero Aim targeting line: a glowing "magic lasso" strung from a
source to a moving cursor that **bobs, sways and whips with cursor motion** — replacing the old fixed-bow aim
line (a quadratic curve with a clock-only wobble that never reacted to how you moved).

This is **Phase 1 — the LOOK, authorable in the FX workshop**. Phase 2 (a thin game driver that plays a
persistent instance as the live aim line, feeding source + live cursor + on-target + activation) lands next.
Owner chose the hybrid split: the ribbon/pointer is a data-driven primitive tuned in the workshop; the
persistent, input-driven aim lifecycle stays game glue (a moment/binding fires once — targeting is held).

## The motion — `aimLasso.ts` (pure, unit-tested)

A spring chain of control points strung between the source (pinned) and cursor (pinned). Each interior point
springs toward its rest on a per-aim base bow, with inertia — so when the cursor moves the rest shifts and the
points **lag, overshoot and settle** (the whip). On top: a perpendicular **sway** enveloped by `sin(π·t)`
(ends stay pinned), amplitude `swayAmp·(1 + speed·motionInfluence)` — a gentle idle bob that grows into a
pronounced sway as the cursor moves faster. Pure `(state, from, to, speed, dt, timeS, cfg) → points`, DOM-free,
so the physics has real headless tests (endpoints pinned, idle settles onto the bow, faster speed = bigger
sway, a sudden jump lags, stable under clamped huge dt, live segment-count resize).

## The primitive — `primitives/targeting.ts`

Renders `aimLasso`'s polyline as a **layered Graphics stroke** (owner's call: keep the stroke, not a textured
mesh) — a soft uniform aura beneath a bright core that **tapers** toward the cursor — plus a custom Pixi
**pointer** at the cursor end (glow + core + an optional rotating reticle of ticks, growing on a valid target).
Full param set in three groups (Lasso / Motion / Pointer) plus the standard blur + filter-lab + transform
stacks, so it tunes like every other primitive. Reads `setAim` for the source end and `setHead` (anchor it to
`cursor`) for the cursor end; a live `setOnTarget(bool)` channel (not a param) is how Phase 2's driver will
feed the on-target grow.

## Note for verification

The dev server in a worktree serves the PRIMARY checkout's `packages/ui` (the known preview trap), so the new
primitive can't be previewed from the worktree — it's covered by tests here and verified by eye in the workshop
once on `main`. No player-facing change yet (nothing plays it until Phase 2) → no patch note.
