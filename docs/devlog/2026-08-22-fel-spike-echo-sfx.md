# 2026-08-22 — Fel Spikes' Echo gets two sounds: one launch cue, per-hit land ticks

Two new SFX for Fel Spikes' Echo spike volley, both fired from the single place the volley is scheduled —
`scheduleEchoVolleys` in `useCombatReplay.ts`, which both trigger paths (death-fired and Echohorn's rally-fired)
already route through.

- **`fel-spike-echo`** (launch) — plays the instant the projectile pixi launches, **once per volley** however
  many targets it sprays. It's a single `sfx.felSpikeEcho()` inside the per-wave `fire()`, before the per-target
  `playDef` loop, so multiple simultaneous targets never multiply it. A golden Fel Spikes still gets two taps
  because each of its two waves is its own `fire()` — "proc every time it fires."
- **`fel-spike-echo-land`** (impact) — plays **once per struck unit that takes damage**, timed to when the spike
  connects (`launch delay + projectileImpactMs travel`). Kept quiet (category gain 0.2 vs the launch's 0.38)
  since it stacks across the volley's targets, with a small per-hit stagger (12ms, speed-scaled) so a multi-target
  volley reads as a patter rather than one coherent, clip-prone blast.

**"Struck" = took damage, by design.** The land cue keys off units that fire a damage NUMBER (a `dmg` event), not
every unit the spike physically reaches — a Ward-absorbed strike pops a `shield` (no number) and gets no land
tick. New pure helper `echoWaveDamagedCount` computes that count per wave (distinct `dmg` targets from the
sprayer), separate from `echoWaves` (which returns damaged **and** warded units for the fan-out) so its exact
`.toEqual` test shape is untouched. Covered by four new cases in `echoWaves.test.ts`. *(Flagged to owner: if a
Ward-blocked spike should also click, widen this to `echoWaves(...).uids.length`.)*

Both clips are combat-bus categories in `audio/config.ts`; methods added to `sfx.ts` with synth fallbacks and
wired into the dev SFX-desk preview map. The `sfx-manifest.md` doc regen was skipped — on this checkout it also
flipped unrelated hero-VO status rows, so it's left to a later clean run.

Verified: typecheck ✅, lint (touched files) ✅, `npm test` ✅ (6565 passed), build:web ✅.
