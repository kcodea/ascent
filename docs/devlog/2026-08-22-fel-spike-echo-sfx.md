# 2026-08-22 — Fel Spikes' Echo gets two sounds: one launch cue, per-hit land ticks

Two new SFX for Fel Spikes' Echo spike volley, both fired from the single place the volley is scheduled —
`scheduleEchoVolleys` in `useCombatReplay.ts`, which both trigger paths (death-fired and Echohorn's rally-fired)
already route through.

- **`fel-spike-echo`** (launch) — plays the instant the projectile pixi launches, **once per volley** however
  many targets it sprays. It's a single `sfx.felSpikeEcho()` inside the per-wave `fire()`, before the per-target
  `playDef` loop, so multiple simultaneous targets never multiply it. A golden Fel Spikes still gets two taps
  because each of its two waves is its own `fire()` — "proc every time it fires."
- **`fel-spike-echo-land`** (impact) — plays **once per volley** as its spikes connect (`launch delay +
  projectileImpactMs travel`), only when the volley actually dealt damage. (First cut played once per struck unit
  with a stagger; owner asked for a single land cue instead — 2026-08-22.)

Both gains are 0.50 (owner-set).

**Land plays only if a damage NUMBER fired.** The cue gates on a wave dealing actual damage (a `dmg` event), so a
fully Ward-absorbed volley (only `shield` pops, no number) stays silent. New pure helper `echoWaveDamagedCount`
computes the per-wave distinct-`dmg`-target count the gate reads (`> 0`), separate from `echoWaves` (which returns
damaged **and** warded units for the fan-out) so its exact `.toEqual` test shape is untouched. Covered by four new
cases in `echoWaves.test.ts`.

Both clips are combat-bus categories in `audio/config.ts`; methods added to `sfx.ts` with synth fallbacks and
wired into the dev SFX-desk preview map. The `sfx-manifest.md` doc regen was skipped — on this checkout it also
flipped unrelated hero-VO status rows, so it's left to a later clean run.

Verified: typecheck ✅, lint (touched files) ✅, `npm test` ✅ (6565 passed), build:web ✅.
