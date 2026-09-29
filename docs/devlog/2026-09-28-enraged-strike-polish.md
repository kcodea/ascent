# 2026-09-28: Enraged Strike polish (readable hits, a real combo, a new Tier IV)

Owner asks, in order (all 2026-09-28):
- "the enrage animations kinda meh, can you polish it up"
- "for the enrage animation -> the multi attack ones need to feel more impactful when they reel back, let them fly back in
  and impact each time. the final hit's entire animation stinks, please fully redo the huge animation for enrage"
- "enrage is much better." (after the first polish push; the combo and the new Tier IV were finished after that)

Branch `polish/enraged-strike`, off `main` after Enraged (#1804) and Poison Darts (#1805). Touches only Enraged's own
files, its tuner, its tests, its oracle rule (R-PROG-ATTACK-11), its GAME-RULES paragraph and the patch note.
Presentation only: the blow, when it lands and how often are unchanged.

## Why it read "meh" (the critique, next to Arcana, Poison and Frost at 0.25x)

1. **The hit frame was hidden.** Classic's contact puts the striker's corner over the struck portrait's face, so on the
   contact frame you saw the striker, a flash and the big `-N`, but never the foe getting hit. Arcana, Poison and Frost
   all land ON a visible target.
2. **The claws sat under the `-N`.** The `-N` is pushed from the struck hero toward the middle of the screen, which is
   exactly where the rips were drawn.
3. **The hero sprang home at once.** 80 ms planted, then Classic's elastic settle: the hit had no hold.
4. **The multi-hit tiers were nudges.** A small pull back between hits, with ticks that were a smaller copy of the impact:
   no reel back, no fly back in.
5. **The meteor was a cramped corner zoom.** The rise lifted straight up from the corner and half left the screen, the
   comet flames were oversized spikes, and the crater's big radial cracks read as lightning.
6. **Corner hits lost their spray.** Sparks and embers flew along the blow, i.e. off the top-right corner.
7. **Programmer-art shapes.** The flame sprites read as a sunburst of spikes; the thick yellow ring washed the frame; the
   first scorch trail was a thin laser line across the board.

## What changed

- **The readable hit.** Enraged stops with its rim at the struck portrait's rim (`contactStop`, in its own radii) and
  stays planted a beat (`holdMs` 210, a small recoil off the foe), so the contact frame shows the struck face taking the
  hit. Classic's own contact is untouched.
- **Claws away from the `-N`.** The rips are raked on the side of the struck portrait away from the big number
  (`DamageFormation.pts.hit`). They are bolder, with a hairline white-hot core down a deep red body.
- **Glowing rage cracks on the rim.** A new rim-crack texture: short, jagged fissures that hug the frame (never over the
  face, never lightning), in a dark layer, a hot layer and a white core that cools first.
- **Sparks bounce back into view.** `sparkInward` (0.65) sends that share of every spray toward the middle of the screen.
- **The rage burst.** At the peak of the windup the portrait flares, three heat rings tear off the rim, a ring of sparks
  bursts out and the roar tears out, `burstMs` before the drive.
- **A scorch skid.** Each dash leaves a short burn behind the hero (bounded to the last ~3 radii, never a line across the
  board), with a hot core that cools first.
- **Every hit is a full cycle** (II, III, IV). After each hit:
  - a hard recoil off the foe (stretched, fast), the first `recoilShare` of the gap;
  - a coil (squashed, trembling, a heat ring tightening onto the rim);
  - a drive back in, with its own streak, afterimages and scorch;
  - its own impact (a flash, a crisp shock rim, a claw set, rim cracks, a spark burst, the foe knocked back and squashed,
    a camera punch).

  Every hit is scaled by its `power` up the combo, so each lands harder than the one before.
- **Tier IV, redesigned: the Berserker rampage.** Concepts considered: a berserker rampage, a rage transformation with a
  burning trench charge, a leap and a cleave, and keeping the meteor. The rampage won:
  - it is the most literally "the Classic lunge, enraged to the max": the verb stays the lunge;
  - it gives a natural crescendo (faster, faster, rear back, knockout);
  - it reuses the combo machinery instead of adding a second system;
  - the leap-and-cleave was too close to the meteor the owner rejected.

  It plays as:
  1. five slams that come faster and faster (`Accel` 0.8);
  2. the **rear-back**: the hero rears way back and up over the board at the peak of its rage. The flames tower, the
     biggest roar plays with the growl and a rumble building to the blow, a dark pressure ring closes in, and the camera
     eases the push off and frames the whole swing;
  3. the **haymaker**: an overhead blow comes down on an arc (kept inside the screen) onto the foe's rim. It brings a
     giant flaming crescent, a screen-filling rage shockwave (a thin white-hot rim racing out, a dark ring behind it for
     contrast, a late second rim), molten cracks ringed round the struck portrait, rubble, an ember storm and the
     strongest camera punch.

  The meteor is gone.
- **The aura** is a crown of swaying flame strips off the upper rim, licking upward (not a sunburst of spikes).
- **Timing.** No freeze anywhere; the damage lands once, on the last hit or the haymaker.

## Timeline (ms, a typical cross-board Classic swing; the formation's lead-in is included)

| tier | hits | windup starts | impact | end |
| --- | --- | --- | --- | --- |
| I (3) | 1 | 2210 | 2988 | 3925 |
| II (8) | 2 (a tick, then the impact) | 2376 | 3576 | 4533 |
| III (14) | 3 (two ticks, then the finisher) | 2708 | 4405 | 5401 |
| IV (40) | 5 slams, the rear-back, the haymaker | 2800 | 5224 | 6341 |

The style's own part (windup to end): I 1.7 s, II 2.2 s, III 2.7 s, IV 3.5 s, with the knockout 2.4 s in.

## Perf (PROD build, headless Chrome over CDP, 1600x900, a practice run vs bots, a temporary uncommitted hook)

The browser pane was throttled to ~4 fps (the window was occluded), so these runs used headless Chrome. The machine was
under load from other sessions, so the numbers vary run to run.

| run | frames | p50 | p95 | p99 | worst | > 17.5 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (40, first play) | 1612 to 1933 | 4.2 | 4.3 to 8.4 | 8.3 to 16.6 | 142 to 183 | 7 to 12 | 1 |
| IV foe (40) | 1061 to 1934 | 4.2 to 8.3 | 8.2 to 12.6 | 12.5 to 16.8 | 16.7 to 46 | 0 to 10 | 0 |
| III (14) | ~1700 | 4.2 | 4.3 | 4.3 | 8.4 | 0 | 0 |
| II (8) | ~1500 | 4.2 | 4.3 | 4.4 | 8.4 to 25 | 0 to 1 | 0 |
| I (3) | ~1340 | 4.2 | 4.3 | 4.3 | 8.4 to 16.6 | 0 | 0 |
| IV again (steady) | ~2010 | 4.2 | 4.3 | 4.3 | 8.4 to 16.7 | 0 | 0 |

- The first play's long task lands 60 to 340 ms into the preview's opening: the damage formation starting, the preview
  mounting the foe portrait, and the one-time GPU upload of the pre-warmed textures and strip meshes. It happens before
  any Enraged FX is on screen.
- Texture painting itself costs 2.4 ms.
- Strip meshes (the flames, the streak, the claws, the crescent, the scorch) are now pre-warmed during the formation too.
- After every run the body classes and the `#stage` transform are restored and no DOM is left behind.

## Sound

The roar moved to the rage burst (`fx/dragon-growl`, louder). The haymaker's rear-back adds the biggest roar, the synth
growl and a rumble, all building to the blow. Every combo hit has its own smack, rip and punch, louder and higher up the
combo. The knockout layer is `fx/universfield-ground-impact-352053` (the tuner's "haymaker" cue). No ElevenLabs credits
were spent.

Clips still wanted: a short, aggressive rage roar (the dragon growl stands in); a punchy body blow with a tight low end;
a heavy, cracking haymaker impact.

## Open for the owner

- The Tier IV concept is the berserker rampage. The tuner can switch the haymaker off per tier, and change the slam count
  and the acceleration.
- The first play of a session still has one long task at the preview's opening; every later play is clean. The
  above-portrait canvas and the damage formation are shared, so any fix belongs in a separate change.
