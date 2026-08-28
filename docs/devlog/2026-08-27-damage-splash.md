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

Verified: typecheck ✅, lint 0 errors ✅, build:web ✅. Owner-tuned + signed off live at 1×. (The one climbing
Fel Spikes number keeps its single-pop hold keyframe — it gets the burst but not the bounce.)

**Follow-up (same PR).** Owner supplied a second burst variant and asked for finer placement control:
- **Burst art picker.** A second downscaled PNG (`apps/web/public/fx/damage-splash-2.png`, 384px, 137KB — a
  spikier star) plus a `select` on the tuner ("Burst art": Rounded / Spiky). The `::before` background is now
  `var(--dmg-splash-img, …)`, switched by `applyFloatConfig`. Default stays image 1, so nothing ships changed.
- **Position nudges.** Number X/Y (moves the digits and the backplate together, baked into the `floatupc` /
  `floatupchold` / `floatstickc` translate) and Splash X/Y (moves the burst `::before` relative to the number).
  All default 0 → no shipped change; a new "Position" group + Splash-group sliders on the tuner.
- **Pop length.** The scale bounce moved off `floatupc`'s `transform` onto its own `dmgpop` keyframe driving the
  individual `scale` property, so its duration (`--dmg-pop-dur`, tuner "Pop length") is independent of "Time on
  screen". `scale`/`translate`/`opacity` are separate animatable properties, so the two timelines don't clobber.
  Default 300ms reproduces the old 0–30%-of-1000ms pop exactly. The climbing Fel Spikes number (`floatupchold`)
  and the death float (`floatstickc`) keep their own single-timeline scale — the new knob is the main hit float.

**Pop-displacement fix.** Splitting the pop onto the individual `scale` property left `floatupc`'s centring on
the `transform` property — and the two compose as `scale · translate`, so the pop's scale MULTIPLIED the −50%
centring offset: at the peak of a 1.7× bounce the number was displaced ~28px up-and-left, then swung back. It
read as a broken/absent pop (owner noticed it on their own board when the opponent attacked in). Fix: `floatupc`
now drives the individual `translate:` property, so it composes with `scale:` as `translate · scale` — the exact
matrix the pre-split combined `transform: translate() scale()` produced. Verified in-browser: individual
`translate:`+`scale:` reproduces the old rect at every scale (0.3 / 1 / 1.7), the mixed form did not.

**Owner-locked defaults** (2026-08-27, re-tuned after the pop fix): number 42 / damage 48, 0.9s on screen, pop
1.7× over a 400ms bounce, entry 0.3×, the SPIKY burst (art 2) at 2.84× nudged 2px left, a thin 1.5px black
number outline, random rotation ON up to ±45°. Baked into `floatConfig.ts` DEFAULTS **and** the styles.css
fallbacks (`.float`, `.float.dmg`, the `floatup*` / `dmgpop` keyframes), per that config's ship convention.
