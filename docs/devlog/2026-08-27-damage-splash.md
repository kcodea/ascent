# 2026-08-27 — Damage number: golden burst backdrop + spring bounce + random tilt

Owner ask: replace the red square behind a combat damage number with a golden burst PNG, spring it in with a
bounce, and (added) a random rotation toggle — all dialable in a tuner, with no perf cost.

**The backdrop.** `.float.dmg`'s old `background: var(--threat)` pill is replaced by the owner's burst art on a
`::before` BEHIND the number (z-index -1 inside the float's own z25 stacking context), so the number + burst are
ONE element and pop/rise/fade together exactly as the pill did. It is a STATIC image animated only via the
float's transform/opacity — compositor-only, one shared texture — so it costs no more per frame than the solid
pill. The 1254×1254 source was downscaled to **384px** (`apps/web/public/fx/damage-splash.png`, 833KB → 125KB).

**The bounce.** `@keyframes floatupc` (the damage-number pop) now overshoots → dips → rebounds → settles, so
the burst "springs out". Transform-only.

**Random tilt.** A per-float angle hashed deterministically from the float's `id` (Recruit.tsx float render) —
stable across re-renders (never spins) and no `Math.random`. Gated on the tuner's `rotRandom`, ranged by
`rotRange`.

**Tuner.** New "Splash" group on the Damage Float tuner (`floatConfig.ts` + `FloatTuner.tsx`): splash size,
number outline width + colour, the random-rotation toggle, and the rotation range. The number also gained a
thin outline (`-webkit-text-stroke` + `paint-order: stroke fill`) so digits read over the bright burst.

**Owner-locked defaults** (2026-08-27): pop 2×, entry 0.1×, 1s, splash 4.2×, outline 2.35px `#b3b3b3`, random
rotation ON up to ±45°. Baked into `floatConfig.ts` DEFAULTS **and** the styles.css fallbacks (`.float`,
`.float.dmg`, the `floatup*` keyframes), per that config's ship convention.

Verified: typecheck ✅, lint 0 errors ✅, build:web ✅. Owner-tuned + signed off live at 1×. (The one climbing
Fel Spikes number keeps its single-pop hold keyframe — it gets the burst but not the bounce.)
