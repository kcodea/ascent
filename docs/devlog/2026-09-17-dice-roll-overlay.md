# 2026-09-17 — DiceRoll overlay: one top-down 3D die for the Gambler's power and the Gamble spell

**What shipped (UI only — no engine change).** The two 2D "digit flip" tumbles — `StatusBar`'s `.hpb-dice`
cycle on the power button and `Recruit`'s `.gambledie` portal — are replaced by ONE shared React overlay,
`packages/ui/src/DiceRoll.tsx`, driven by a GSAP timeline in `packages/ui/src/diceRollTimeline.ts`, per the owner's
2026-09-17 feel spec.

- **It never rolls.** `result` is the sim's number (`heroDiceRoll` for the Gambler, `gambleRoll.tier` for the
  spell); the timeline only reveals it. Cosmetics (rest yaw ±15°, a pixel of burst jitter) come from
  `makeRng` seeded by `diceSeed(variant, …)` — the Gambler off `(wave, roll)`, the spell off `gambleRoll.seq` —
  so a replay is pixel-identical. No `Math.random` in the UI path.
- **Geometry.** A fixed 0×0 GROUND at the anchor carries `perspective: 600px` (the die is always seen dead-on and
  rests flat, face up) › shadow › hop (`translateZ` + scale) › yaw (`rotateZ`) › cube (`rotateX rotateY`) › six
  faces (3×3 pip grids, `backface-visibility: hidden`). Face table exactly as specified (1 Y0 · 2 X90 · 3 Y-90 ·
  4 Y90 · 5 X-90 · 6 Y180). `faceUp(rx, ry)` resolves any rotation to the face at +Z geometrically — the test's
  oracle is independent of the table the timeline was built from.
- **Timeline** (normalised over `tumbleTime`): cube to end + overshoot by 0.74 (cubic-bezier .15,.55,.25,1), rock
  back 35% by 0.88, settle at 1; hop up by 0.30, contact at 0.62 (`onLand`, scale 1 + settleBounce·0.25), second
  hop to hopHeight·settleBounce by 0.80, flat at 1; yaw one turn + rest angle by 0.80; shadow = f(z). After a
  roll the bare rest pose (mod 360) is kept per variant so the next roll starts with no jump.
- **Landing burst** is an authored def, `fx/defs/dice-land.json` (12 particles + one shockwave ring, built from
  `hero-power-spark`'s shape), fired through `playDef` with `recolor` — gold for the power, the game's
  `--tier-N` ramp for the spell — never hand-rolled divs.
- **Two callers, props only.** Gambler: `StatusBar` measures the power button ONCE at roll start, mounts the die,
  and at `onComplete` the existing held face (`diceHeld`, owner ruling 2026-08-16) appears under the overlay's
  fade — the number is never taken away. Spell: `Recruit` keeps the PRIZE-WITHHOLD contract — `setGambleHold(uid)`
  at roll start, `setGambleHold(null)` in `onLand` (first touchdown, not settle); the die holds 900 ms then fades.
- **Tuner.** "🎲 Dice" in the Dev menu (Buttons group; `diceRollConfig.ts`): tumbleTime 1100 (400–2200),
  spinCount 3 (1–6), hopHeight 80 (0–150), settleBounce 0.22 (0–0.5), plus the spell preset 700 ms / 2 spins
  (floors 600 / 1). ▶ Test rolls a spell die at the screen centre, cycling the face 1→6.
- **Reduced motion:** 250 ms, no hop / spins / burst — the face is simply there.
- **Perf.** One `getBoundingClientRect` per Gambler roll (none for the spell — it uses the recorded pointer);
  four transform/opacity writes per frame; nothing loops; no filters.

**Adapted from the handoff, and why.** The spec's "particles ×12 / ring" DOM children became a `playDef` def
(the coordinator's ask: route bursts through the FX pipeline). The four knobs are there, plus the two spell
preset knobs the spec described as "per-variant presets" — the spell's quicker roll is a real, dialable
preset rather than a hard-coded fork. Sound: `onLand` is the hook; no clip yet.

**Verified.** `diceRollTimeline.test.ts`: 100 forced rolls × 6 results land on the correct face (geometric resolve),
overshoot / rock / hop / yaw / callback timing, reduced-motion, and seeded-replay determinism.
`defs.test.ts` / `directCalls` / `playDefUids` snapshots extended for `dice-land`. Live on 5173: see the PR.
