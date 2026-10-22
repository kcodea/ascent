# 2026-10-22 — Skip fast-forwards the fight instead of cutting to the result (R-SKIP-TURBO-01)

Owner ask (Mike): Skip should speed the fight up to 20× rather than jump to the resolved board (the old
freeze + fade + jump made the outcome read oddly), then slow back down for the hit that decides the fight.

**How it works**

- `packages/ui/src/skipTurbo.ts` (pure): `decisiveBeatIndex` picks the beat with the blow that kills the last body
  to die (backed up to that swing's `attack` wind-up; a Rise's first death never counts). `skipTurboSpeed` is a
  smooth climb from the press, then a constant-deceleration brake, `v = √(base² + 2·a·r)` with `r` the authored
  time left to that beat, so it slows evenly over `turboBrakeMs` of real time and lands exactly on the player's
  speed. `remainingNow` interpolates `r` inside the current hold so the speed moves every frame, not per beat.
- `useCombatReplay.ts`: `turbo(onLand?)` + `turboing`, run by the auto-ramp's existing rAF loop (the faster of the
  two curves wins). "Landed" is stored on the turbo state so a loop re-arm (slider change) can't fire it twice.
  The loop is now clocked off rAF timestamps only (it used to seed from `performance.now()`), which is the same in
  a browser and correct under fake timers.
- Audio: game sounds crossfade against a generated fast-forward whir (`audio/skipWhir.ts`) on one dial, the turbo
  amount: `sfx.ts` `setSkipTurboAudio` ducks the mute bus by `turboSfxGain` and blocks new sounds above
  `TURBO_SFX_BLOCK`. The first version hard-muted then snapped back at full volume, which the owner flagged.
- FX: `pixiFx.setTimeScale` scales the one FX clock (authored defs + stock particles, including in-flight ones)
  by `speed / base`, so effects race and brake with the fight instead of being hidden.
- Tunable in the dev Speed Ramp panel (Skip turbo group): Skip speed 20×, ramp-up 300 ms, slowdown 1500 ms.
- Recruit's Skip button hides once pressed; spectators and replay streams that follow a Skip run the same turbo.
  The old fade-and-jump path (`skipFade`, `.combatfrozen`) is gone; `replay.skip()` stays for zero-beat fights.

**Verified:** `skipTurbo.test.ts` (decisive beat, interpolation, brake duration and smoothness, crossfade curve)
and `skipTurboReplay.test.tsx` (through the real hook: reaches >15×, finishes in under half the time, is back at
the player's speed on landing, lands once, zero-beat fights finish); typecheck, lint, full suite, build:web.
Owner played it on the dev server.

**Known / follow-ups:** the beat on screen when Skip is pressed finishes at its current speed. At 20× effects
spawn much faster than normal; if the owner sees hitching, profile on the prod build and thin FX at top speed.
The whir is a placeholder until an authored clip replaces it.
