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

## Second pass (2026-11-12, after the owner played it)

The owner's verdict on the batch: the attacks need sound, and the big looks are quick and not impactful. On this one
the first sheets also showed that nothing was big enough to read as a pinball table.

**Scale.** The ball is 63% bigger (radius 0.27 to 0.44 striker radii) with a halo and a longer tail. The bumpers are
about half again as big (0.5 to 0.74 target radii), kick 24 px (was 9), swell more and flare their own lamp on a hit.
The lane arrows are bigger and spaced out. The playfield is LIT: a pool of light under the bumpers and the target that
flashes with every hit, the strobe and the impact. The display is nearly twice as wide (3.3 to 6.4 target radii) and
no longer sits at the top edge: it is placed just outside a flank bumper or on the lane short of the front bumper,
whichever the screen moves least. The tilt is 5 degrees (was 2.4) over 760 ms, and its first swing always carries the
striker toward the middle of the screen.

**The jackpot rolls UP.** The first pass spun random reels that happened to read high numbers, so it looked like a
count DOWN (94, 49, 44, 40). `jackpotValue` now climbs from 00 to the damage through the roll-up (slow, then racing),
never past it, never falling, and reads exactly the damage on the impact. `reelStopAt` is gone.

**Sound.** Measured with a recorder on the audio output (100 ms RMS windows, after the formation). First pass, IV:
mean -37.8 dB, peak -20.9 dB, most windows -36 to -48 dB (reference: Soccer IV -32.0 dB, Frost IV -31.8 dB). The old
bumper clip peaked at -11 dB and was all top end; the flipper clip was a thin click. Now IV: mean -25.7 dB, peak
-8.1 dB; the table and the chase -29 to -37, the rattle -21 to -27 without a gap, the impact -19 to -21, the payout
-23 to -26 for 1.7 s. Deliberately louder and denser than the references. Levels are measured, not heard.

- Five ElevenLabs calls, five new clips, 5.2 s: `pinball-clack` (0.41 s, the flipper), `pinball-thwack` (0.4 s, a pop
  bumper's solenoid), `pinball-bell` (0.8 s, a warm chime), `pinball-roll` (1.4 s, the ball on the wood),
  `pinball-jackpot` (2.2 s, the payoff). The first pass's `pinball-bumper` and `pinball-flipper` are deleted. Own
  clips now: seven, 7.6 s.
- Every bumper: the thwack with its own bell note on top (the three bumpers are a major triad). The flipper: the clack
  over a low thump. The ball rolls for as long as it is in play. The table pops up with a clunk per piece.
- IV: bells climb through the chase; the tilt is a thud, a clunk and two low sour bells; the score's climb is 14
  ticks that come faster, higher and louder; the impact is a low thwack, a low bell, the boom and the jackpot payoff;
  then five payout bells climbing an octave.
- Fixed in passing: the shared boom clip has 0.4 s of lead-in, so the first pass's impact thud arrived 0.4 s late. It
  now starts 380 ms into the clip.

**Impact (IV).** Running time after the formation: 3753 ms before, 5240 ms now (Soccer IV 3308, Frost IV 3083). The
added time is the roll-up before the blow (660 to 950 ms, with the ball hanging and swelling as it drops, 160 to
280 ms) and the payout after it (hold 760 to 1600 ms): sparks off the display, rings off the bumpers and the target,
the lights strobing, the target reeling on a slower, longer ring. On the blow: a whole-screen flash, shake 16 to 28 px
over 520 ms, a bigger punch-in, a white-hot core, a glow that lingers 1.3 s and steel sparks that arc down. Every
bumper hit also jolts the view a little.

**Style.** No new drawn objects. The flipper, ball, bumpers and display stay: the table is the idea, and this one is a
toy on purpose. Everything added is light.

**Verified this pass.** `heroPinball.test.ts`: the roll-up (from 0, climbing, exact on the impact), the ticks and the
payout cues, the display's size and place, the bigger pieces, the tilt. Sheets: IV both directions, III and II with
the player striking. Frame times on IV, dev build, on a machine running other builders at about 90% CPU: median
4.2 ms, 99th percentile 8.3 to 8.4 ms over three runs.

**Still weak or unverified.**
- Long frames: one of 40 to 60 ms in the first 80 ms (the first pass had it too), and in two of three runs a 33 to
  50 ms frame about 1400 ms in, near the first bumper hits. Not explained; the machine was too busy to pin it down.
  It needs a look on a quiet machine with the production build.
- On III the display can sit over the end of the ramp.
- I was not re-captured (it only gained size and sound).
- Nobody has heard the mix. The config key moved to `ascent.heropinball.v2` (first-pass tuner values are dropped).
