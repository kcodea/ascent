# 2026-11-12: hero attack "Multiball" (pinball), a Legendary, dev-only

The scaffolded `pinball` style (copied from Soccer by `npm run attack:new`) is now its own animation. Nothing of the
Soccer look or its sounds is left. It has no cosmetic yet, so it plays only through the dev "Attack style" override.

## The idea

The board becomes a pinball table. A flipper (white bat, red rubber) stands in front of the striking hero, the blow is
a chrome steel ball, the struck hero is the table's target (a ring of lamps round it), and pop bumpers rise round it.
It is a table, not a ricochet: flipper, bumpers, lit inserts, a ramp, a score display.

## The four looks

- **I, the flipper shot.** The flipper snaps up and thwacks the ball straight into the target. A bell, the lamps light.
- **II, the bumpers.** Three pop bumpers rise round the target. The ball rattles between them (six bounces, each bumper
  flashing, kicking and popping a "+10"), then drops onto the target.
- **III, the ramp and multiball.** A wire ramp lights up, entry first, arching beside the lane with a loop at its top.
  The ball rides it, goes round the loop and comes off as three ("MULTIBALL" blinks on the dot-matrix display). Each
  ball goes to its own bumper first, and the three land in a cascade. The blow lands with the FIRST ball; the other
  two are echoes (a smaller knock each, they land nothing).
- **IV, the jackpot.** The bumpers and the lane arrows chase, the flipper fires, the ball goes wild between the
  bumpers. The striker shoves the table and the play area tilts 2.4 degrees and rocks back ("TILT" blinks). Then
  every light strobes and JACKPOT rolls up on the display: the reels spin and stop left to right, the last one exactly
  on the impact, reading the damage of the blow.

## How

- **The damage number.** The runner is handed `total` (the engine's blow, the same number the shared formation
  shows). It goes into the plan, and `jackpotDigits(plan, t)` is a pure function of it: from `impactAt` on it reads
  exactly `total` (zero-padded to two reels). No fixed jackpot was needed.
- **Geometry.** `pinballGeo` builds everything from the two portrait centres and radii plus the frame: the flipper's
  pivot and angles (it picks the side with more room), three bumpers (clamped on screen, never over the target), up
  to five lane arrows, the ramp (a bowed curve with a loop, tried on both sides and at four sizes until it fits), and
  the display. `pinballPaths` turns the plan and the table into one keyframe track per ball, built once.
- **Determinism.** The bounce order comes from `rollSeed` (or a stable fallback) through the shared `seededRng`.
- **The tilt.** The shared `StageCamera` has no rotation, so the tilt turns only this scene's own Pixi root about the
  target, and the runner turns the two portraits by the same angle with their own transforms. The game's DOM is not
  rotated. Because the pivot is the target, the shared "FX stay on the struck portrait" sweep still holds.
- **Textures.** All painted once on 2D canvases: the chrome ball, the flipper, the bumper (unlit and lit), the lamp
  ring, the arrow insert, a rail tie, the display glass, and a 5 x 7 dot font for the words and digits.
- **No hit-stop, no slow motion.** The clock never changes pace. The blow lands once, on `impactAt`.

## Sounds

Four ElevenLabs calls, four clips kept, 3.27 s in total (trimmed, faded, mono, 44.1 kHz, 128 kb/s, about -20 LUFS,
peak under -1 dB): `pinball-flipper` (0.30 s, transient 25 ms in), `pinball-bumper` (0.55 s, a thwack and a soft
bell), `pinball-ramp` (0.92 s), `pinball-reel` (1.50 s, a score-reel rattle). The bumper clip is reused at other
pitches for the chase, the multiball bell, the impact and the echoes; each bumper has its own pitch so a rattle is not
one note repeated. The whoosh and the boom are shared clips.

## Verified

- `heroPinball.test.ts` (44 tests): the plan per tier, the seed, geometry on screen in five layouts and a small
  sandbox, every ball ending on the target, the lights, the reels stopping on the damage, the tilt, and the runner
  (the blow once, both portraits' transform, opacity, filter and z-order restored on the end, finish, cancel, the
  safety timer and a cancel at any moment).
- The shared sweeps under `heroAttack/` and the audio tests pass with it.
- Looked at in headless Chrome at 1920 x 1080 from the scene builder: all four looks with the player striking, and
  the jackpot with the foe striking.

## Not done, or weak

- **Nobody has heard the sounds.** They were placed from measured onsets and levels only.
- **Frame times** were measured in a dev build on a machine running fifteen other builds: the same as Soccer measured
  the same way (median about 5.6 ms, 99th percentile 7 to 16 ms, one long frame of about 50 ms right after the charge,
  which Soccer also shows). It needs a measurement on a quiet machine with the production build.
- The display sits over the top of the board, away from the target, so the eye has to travel on IV.
- The target's lamp ring is small and partly off screen when the target is tucked in a corner.
- On short lanes (the portraits close together) the lane arrows are dropped and the table is cramped.
- The Collection preview (the small local sandbox) was covered by a geometry test but not looked at.
