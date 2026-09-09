# 2026-09-09 — Ribbon trail-travel styles: Crackle + Wander

Owner ask: *"can we create some alternate ways for trails to travel? right now it feels challenging to create
like a lightning crackle effect, or an erratic vine effect."* The ribbon primitive's only spine deformation
was a smooth travelling sine (`waveAmp`/`waveFreq`/`waveSpeed`), which can only ever snake. Added two more
perpendicular displacement styles, both **additive** on the same pass and both no-ops at their default zero
amplitude, so nothing that exists changes:

- **Crackle (lightning)** — `crackleAmp` (px), `crackleSteps` (jagged segment count), `crackleFlicker`
  (re-strikes/sec). A **linearly**-interpolated hash noise → sharp kinks; `crackleFlicker` quantises `timeSec`
  into discrete strobes that reseed the whole bolt, so it snaps between shapes instead of sliding (0 = one
  shape frozen to the path).
- **Wander (vine)** — `wanderAmp` (px), `wanderScale` (spatial frequency). A **smoothstep**-interpolated value
  noise → a slow organic meander that drifts gently with `timeSec`.

Both are enveloped by `sin(πt)` (0 at head and tail), so however wild the middle gets the trail still meets its
source and target — unlike the wave, which is deliberately left un-enveloped and byte-for-byte unchanged.

## Where it lives

- `ribbonGeometry.ts` — three allocation-free helpers (`hashLattice`, `valueNoise`, `jaggedNoise`, the classic
  `fract(sin·big)` hash so a trail is the same shape at the same `timeSec` on every client — a replay needs
  that) and the extended displacement pass. The pass now runs when **any** of the three amps is non-zero; at
  all-zero it is skipped exactly as before, so the un-deformed ribbon is bit-for-bit identical, and a wave-only
  def is byte-for-byte identical to before this change (the added terms contribute exactly 0).
- `primitives/ribbon.ts` — five new `Shape`-group sliders (amps carry `axis: 'scale'` like `waveAmp`;
  steps/flicker/scale are plain and `enabledWhen` their amp is above 0), threaded through `shape` +
  `setParams`. `update()` already advances `shape.timeSec`, so the flicker and drift animate for free.

No committed def uses them yet (all default 0), so there is no player-facing change — this is an authoring
capability. The workbench Inspector picks the sliders up from `SPECS` automatically.
