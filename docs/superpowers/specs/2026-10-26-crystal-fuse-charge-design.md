# Crystal Fuse — end-of-turn charge redesign

Date: 2026-10-26 · Owner: Mike · Status: design, awaiting approval

## Intent

The end-of-turn **Charge Glyph** (the blue sigil on the board midline that charges over the last 20 seconds of a
shop turn) gets a new look. Its **behaviour stays exactly the same**; only the visuals change.

The new picture: a **fuse made of blue crystal** runs along the board midline toward the **End Turn gem** on the
right. Over the final seconds it **disintegrates from left to right**, like a burning rope. Everything that breaks
off turns to energy and debris that is **pulled into the End Turn gem**. The gem wakes up, glows brighter, and drags
in whipping, swirling energy, with debris starting to orbit it. At 0:00 all of that energy **collapses into the
gem** with a burst. The gem then sits charged and humming until the player presses End Turn, and the press fires the
gem's **existing strike**. (The turn does not end on its own at 0:00: the shop locks, `sfx.turnExplode()` plays,
and combat waits for the press.)

The swirl must read as a **simulation, not an animation**. Particles are moved by forces (pull, vortex,
turbulence, drag, mass), so the build-up comes out **slightly different every turn**.

## Goals

- Replace the Charge Glyph's look with the crystal fuse → End Turn gem.
- A force-based particle simulation for the debris and the gem swirl, with fresh randomness each turn.
- A Dev Menu tuner with a master **Aggression** dial plus individual force and look dials, live at game scale.
- Keep every existing timing, sound and pause behaviour byte-for-byte in feel.

## Non-goals

- No FX-workbench authoring for this effect. The owner explicitly chose code-built effects plus a tuner.
- No change to the turn clock, the Gold Fuse, the shop timer plaque (`ShopTimer`), or any sound clip.
- No gameplay change of any kind.

## Anti-goals (a failure even if it works)

- **It looks like a canned loop.** Scripted orbits, identical streams every turn, or visible repetition fail the
  brief.
- **It costs frames.** Performance is the north star (CLAUDE.md, `docs/performance.md`). A shop hitch or drag
  stutter during the last 20 seconds is a defect.
- **It drifts from the clock.** If the fuse, gem or sound disagree with the timer, or keep moving while the clock
  is held, that is a regression of `R-TIMER-SYNC-01`.

## What must stay exactly the same (behaviour contract)

Everything `ChargeGlyph` (packages/ui/src/Recruit.tsx, ~L579) does today, except its visuals:

| Behaviour | Today | Keep |
|---|---|---|
| Window | Lit for the last `min(CHARGE_SECONDS, turnSeconds)` seconds (`turnClock.ts`); hidden in combat | Same |
| Clock lock | Progress is a pure function of the clock (`chargeElapsed`), finishing exactly at 0:00 | Same |
| Holds | Freezes whenever the clock is held (`useTurnClockRunning`), resumes in place | Same, for fuse, particles and gem |
| Covered | Unlit behind full-screen surfaces (`covered`), stays lit behind mid-run popups | Same |
| Versus quiet | `quiet` fades it when the on-screen player ended early | Same as the early End Turn path below |
| Sound | `sfx.turnCharge(offset)` started at the clock-matched offset; `stopTurnCharge` on hold (120 ms) and unlight | Same, untouched |
| Last 5 s | `ShopTimer` fires `final-countdown-tick` + the `turntick` sound | Same, untouched |
| 0:00 | Clock halts, shop locks, `sfx.turnExplode()` plays (Recruit.tsx ~L5279), synced to the glyph's completion flash + mote gather; glyph stays lit until End Turn | Same timing; the new collapse burst replaces the flash (section 5) |
| Continue | A save restored mid-window resumes at the right point | Same (see "Continue" below) |
| Dev preview | `useChargePreview` lets the tuner force-show and scrub it | Same, with the new tuner |
| Perf marks | `chargeglyph:lit` / `chargeglyph:out` | Same |

The existing tests `chargeGlyphHold.test.ts` and `turnTick.test.ts` must keep passing, updated only where they
assert on the old visuals.

## The parts

### 1. The fuse (behind the cards)

- **Art:** the owner supplies one PNG of the crystal fuse with a transparent background, drawn at full size for the
  1920×1080 stage. It replaces `/fx/turn-glyph.svg` as the shape.
- **Placement:** where the glyph is now: a direct child of `.app`, at z:0, behind every card and above `.boardbg`,
  anchored to the measured board midline (`--charge-y`). The right end sits at the End Turn gem. The existing
  Layout Lab `--charge-*` knobs (or new `--fuse-*` equivalents) position it.
- **Burn:** a CSS mask eats the fuse away **left to right** as charge goes 0 → 1, driven by the same per-frame
  `--charge` write the glyph already uses (no React render per frame). The front has a soft, white-hot burning edge.
  A thin glowing band rides the front, either a masked gradient layer or the particle canvas (builder's choice).
- At charge 1 the fuse is fully gone, exactly at 0:00.

### 2. The debris stream (behind the cards)

- Pieces break off at the burning front: heavier **crystal shards** and light **energy motes**.
- They are simulated (section 4) and pulled toward the End Turn gem, staying behind the cards on their way.
- Rendered on the existing behind-the-cards particle canvas pattern (`.charge-motes`, 2D canvas, sprite-blitted,
  additive). It is sized to cover the midline from the fuse's left end to the gem.

### 3. The gem (on top of the End Turn button)

- The gem is the existing End Turn diamond (`EndTurnButton.tsx`, `frames/end_button_gem.webp`). No new gem art.
- A small overlay canvas over the button, like the button's existing `etb-bolts` lightning canvas, draws:
  - a glow that grows from faint to white-hot over the window;
  - the inward swirl: energy whipping around and into the gem;
  - debris caught orbiting the gem, which thickens as time runs out;
  - the incoming stream's last stretch, so particles visibly enter the gem rather than vanish behind the button.
- **Hand-off between layers:** particles live in one simulation. Each particle is drawn by the behind-cards canvas
  until it enters the gem's capture radius, then by the gem overlay. One sim, two draw passes, no duplication.
- The gem's existing hover lightning, sheen and urgent tooltip are untouched.

### 4. The simulation (the heart of it)

Model it on the FX workbench's particle physics (`fx/primitives/burst.ts`, `fx/primitives/emitter.ts`,
`fx/motion.ts`) and the current `chargeMotes.ts`: per-particle velocity integrated each frame under forces, not
keyframed paths.

Forces on each particle:
- **Pull to gem:** a constant-magnitude point gravity toward the gem centre, like the workbench's "Pull to target"
  (`burst.ts` `pointGravity`), so near particles curve in instead of being flung through.
- **Vortex:** a tangential push around the gem, falling off with distance. Pull plus vortex makes particles spiral
  in, and fast arrivals at the right angle naturally hold an orbit for a while before decaying in. **Orbits must
  come out of the forces, never be scripted.**
- **Turbulence:** the workbench's layered-sine field (`turbulenceX/Y`) with a seeded per-turn phase
  (`fieldPhaseOffset` idea), so the streams whip and flicker.
- **Drag:** per-frame damping.
- **Mass:** shards are heavier (respond less to force per frame), so they swing wider and orbit longer. Motes are
  light and dart straight in.
- **Ramp:** every force's strength rises over the window on a curve scaled by the master **Aggression** dial.
  Calm at 20 s, frantic in the last seconds.

Randomness:
- A fresh seed each turn drives spawns (position along the front, speed, angle, size, mass, life) and the turbulence
  phase, so every turn's build-up differs.
- UI code may use `Math.random` (the ban covers core/content/sim only), but prefer a seeded rng (`fx/rng.ts`) so a
  dev "lock seed" toggle can replay one look while tuning.

Absorption:
- Within a small radius of the gem centre a particle is absorbed: it dies and feeds the gem's brightness and
  pulse.

Timing:
- The sim steps on frame time only while the clock is running. When held, it does not step: every particle freezes
  in place (same as `chargeMotes` today via `heldRef`), and the resume does not take one giant catch-up step.
- Fuse burn progress and the force ramp read the clock (`chargeElapsed`), so they stay locked to 0:00 even though
  individual particles are free-running.

### 5. 0:00 and the wait for End Turn (owner-approved 2026-10-26)

The clock reaching 0 does **not** end the turn (Recruit.tsx ~L5274: "no auto-combat"). So there are three moments:

1. **0:00, the collapse.** The last of the fuse goes, every live particle is driven into the gem, and the gem gives a
   collapse burst, landing with `sfx.turnExplode()` the way today's completion flash + mote gather do. This replaces
   the old glyph's completion flash.
2. **The wait (0:00 → press), however long.** The gem stays fully charged and humming, with a slow, calm orbit of a
   few leftover debris pieces. **No new spawning.** The sim either keeps a tiny fixed set orbiting or freezes them.
   Either way it must cost almost nothing, because this wait has no time limit.
3. **The press.** End Turn fires the gem's existing strike (`EndTurnButton` `playStrike`: white flash, strike bolts,
   `impact-dust`, rings), which releases the stored energy. The overlay clears with it.

- The `turncharge` sound tail rings out as today.
- **Versus (my call):** when the server releases the fight, `VersusHud` calls `endTurn()` directly and skips
  `playStrike`. In Versus the stored charge must still release, so that path fires the strike too: one shared trigger
  (e.g. `emitPressCue('endTurn')`), not a second strike implementation. Guard against a double strike when the player
  already clicked early (the click already struck).

### 6. Early End Turn (pressed before 0:00)

- The **remaining fuse gives a quick bright flash and fades out fast**. Owner ask: very quick, shorter than today's
  450 ms fade.
- Live particles fade with it. They do not rush into the gem.
- The gem does its normal press strike, as for any End Turn.
- The Versus `quiet` path uses the same flash-and-fade.
- **My call:** the fade length is one tuner dial shared by the CSS transition and the unmount timer (today's
  `CHARGE_FADEOUT_MS`, kept in sync). The sound's `stopTurnCharge` fades are unchanged.
- A press **after** 0:00 is the "press" moment of section 5, not this early path.

### 7. Continue mid-window

A simulation cannot jump to second 12 the way an animation can. On a light that starts mid-window (Continue, a
covering surface closing, the dev preview scrub), the builder **pre-warms** the sim: steps it fast, off-screen, for
a short stretch at the current ramp so a believable amount of debris is already in flight and orbiting. It need
not match what was on screen before saving. Pre-warm must not hitch: cap it by step count, and measure it.

### 8. Tuner (Dev Menu)

Replace the current `ChargeGlyphTuner` entry ("Charge Glyph") with a **Crystal Fuse** tuner, same conventions:
dev-only, values persisted in localStorage, "copy" exports the values to paste into the shipped defaults.

- **Master:** Aggression. It scales how hard pull, vortex and turbulence ramp up over the window.
- **Forces:** pull strength, vortex strength, vortex falloff, turbulence strength and scale, drag, shard mass vs
  mote mass, ramp curve shape.
- **Spawning:** spawn rate at the front, shard/mote mix, speeds, sizes, lifetimes, max live particles.
- **Gem:** glow size and peak brightness, capture radius, absorb radius.
- **Fuse:** burn-edge softness, front glow width and brightness, early-End-Turn flash brightness and fade ms.
- **Colours:** shard, mote, hot core, gem glow.
- **Preview:** force-show + scrub (the existing `chargePreview` mechanism), replay from 20 s, and a "lock seed"
  toggle.

### 9. Performance budget

- One rAF loop for the sim and both canvases while lit. Nothing runs outside the window.
- Sprite-blit drawing (pre-baked glow sprites), never per-particle gradients. No looping animation on paint
  properties (CSS rules in CLAUDE.md).
- Hard cap on live particles (tuner dial with a safe shipped default).
- Rects measured once per light, never per frame (stage coordinate rule: measure in screen space; convert with
  `toStage` only where written into a CSS length).
- Verify with `npm run perf` where applicable and a Chrome DevTools trace of the last 20 s on a full board, prod
  build.

## What's removed

- The sigil glyph look (`turn-glyph.svg` mask layers, `.charge-base/.charge-fill/.charge-core` styling) and the
  mandala-gather motes look, replaced by the above. The glyph's **component behaviour** is kept and reused. Remove
  dead CSS, the old tuner and preview html only once nothing references them.

## Art (supplied)

- The owner supplied the fuse: `C:\Users\micha\Desktop\Reference Art\test countdown.png`, 1929×194, RGBA with a
  clean transparent background. It is a straight horizontal crystal rod made of segments joined by bright seams.
  Copy it into the shipped art (e.g. `apps/web/public/fx/crystal-fuse.png` or `.webp`; the name is the builder's
  call) and commit it with the change.
- **My call:** it is scaled (aspect-locked) so it runs from its left end on the board to the End Turn gem, and
  positioned so its right tip meets the gem. The gem (`.etbwrap`, ~0.45 board height) and today's glyph midline are
  close in height. Close the remaining gap with the fuse's position, not by bending the art.
- **My suggestion (owner may drop):** the burning front flares brighter as it crosses each seam, and the shard
  debris samples this fuse's crystal texture so it reads as pieces of it.

## Also in the same PR (repo rules)

- `packages/ui/src/patchNotes.ts`: a player-facing entry (it's an in-game UI change).
- A devlog entry in `docs/devlog/`.
- Any bug found and fixed along the way gets its oracle rule (CLAUDE.md "Bug fixes become rules").
- `R-TIMER-SYNC-01` stays satisfied. Update its `currentBehaviour` text if it names the glyph's visuals.

## Left to the builder

- Exact canvas sizes and positions, the particle data layout, the ramp curve maths, the sprite set, whether the
  burning front glow is CSS or particles, and the pre-warm length. Defaults are tuned with the owner afterwards in
  the tuner.
