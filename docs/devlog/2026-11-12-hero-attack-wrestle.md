# 2026-11-12: Top Rope, the wrestling hero attack (style `wrestle`, Legendary, dev-only)

One of the sixteen attacks scaffolded on `feat/hero-attacks-16` (see `2026-11-11-attack-scaffold.md`). Scaffolded from
`baseball`; nothing of the baseball look is left (no pitcher, batter, ball, bat or brawl cloud). The style has no
cosmetic yet: it plays only through the dev "Attack style" override and its tuner.

## The signature

The two portraits WRESTLE EACH OTHER. The striking portrait walks over, stands beside the struck one and throws it
about: lifts, slams, an elbow from the top of the screen, ring ropes and a three count. Both portraits' DOM elements
are moved, turned and squashed.

## What it does

Four looks on the shared tiers (a knockout always plays IV). The blow lands once, on the impact named below. No
hit-stop and no slow motion: the clock never changes speed.

- **I, the chop:** it strides up beside the struck portrait, leans away as it winds an arm back, and chops (THE
  impact): a wide flat slap arc, a red hand print, the struck portrait staggers a step. WOO!
- **II, the body slam:** it dips under the struck portrait, lifts it overhead (tilted flat, a held beat with a shadow
  growing on the mat), and slams it down (THE impact): flat rings of canvas dust, a shake, one bounce. SLAM!
- **III, the elbow drop:** a shove leaves the struck portrait flat on its back. The striker crouches and leaves through
  the TOP of the screen; a spotlight comes on, hunts, and settles on the one on the mat; then a flat dive with an elbow
  star leading (THE impact).
- **IV, the finisher:** ring ropes stand up at both sides of a ring (two posts with turnbuckle pads and three ropes a
  side). An Irish whip sends the struck portrait PAST the striker into the far ropes, which bow out and fling it back
  into a clothesline (THE impact): it flips once in the air and lands flat. The striker hops on top for the pin: 1, 2,
  3 slam down with a slap of the mat each, the bell rings, WINNER!, the ropes go away and both go home.

Where it happens: the striker always stands beside the struck portrait (the side it came from when there is room), and
every lift and fall is in screen up and down, so the moves read in either direction and from the corners. II to IV pull
the mat in off the screen edge. The one deliberate exception to "every point on screen" is III's exit through the top.

## How

- `packages/ui/src/heroWrestle/heroWrestleConfig.ts`: the tuned values (per-tier dials t1 to t4 plus each move's own
  timings), the pure plan and cues, the geometry (`wrestleGeo`, per move), the pure poses of both portraits
  (`strikerPose`, `victimPose`), the ring (`ringLayout`, `wrestleRing`), the spotlight, the elbow star, the shadow and
  the camera.
- `heroWrestleScene.ts`: the shared `FxPool` (cap 260; the finisher peaks well under it) plus own objects: the ring (4
  posts, 12 rope lengths: each rope is two stretchable sprites meeting at a bend that is pushed out), the spotlight
  cone and its pool, the elbow star, the shadow.
- `heroWrestleTextures.ts`: painted once per session on 2D canvases: rope, post, spotlight cone, hand print, slap arc,
  impact star, dust puff, shadow, bell, the numbers 1 2 3 and the words WOO!, SLAM!, WINNER!.
- `heroWrestle.ts`: the runner on the shared Sequence / StageCamera / PortraitMover. The squash is written OUTSIDE the
  rotation, so a portrait lying on its back still flattens against the floor. Every exit (the end, `finish()`,
  `cancel()`, the safety timer) restores both transforms, the striker's opacity and the z-order class and hides the
  own objects.
- `HeroWrestleTuner.tsx` on the Rare tuner builder with four tier groups.
- Shared files: only the `wrestle` entry of `audio/codeClips.ts`.

## Sound

Four ElevenLabs calls, four clips kept (3.6 s in all), each trimmed to its hit, faded, mono 44.1 kHz 128 kb/s:
`fx/wrestle-chop` (0.32 s), `fx/wrestle-slam` (0.8 s, also the landings and, pitched up and cut short, the count's mat
slaps), `fx/wrestle-bell` (1.5 s), `fx/wrestle-woo` (0.95 s, the crowd). Slam, bell and woo are levelled to -20 LUFS;
the chop is too short for a loudness reading and was set by peak (about -2.5 dB). Each clip's onset is at 0 ms, so cues
fire on the beat. Reused: the shared whoosh, `fx/heavy-rock-impact` (a low layer), `fx/cheering`. Nobody has LISTENED
to these: levels and character are judged from the waveform only.

## Verified

- `heroWrestle.test.ts` (34 tests): tiers, tuner, plan and cue order per tier, geometry on screen in seven layouts at
  two frame sizes, poses on screen and without jumps, each move's staging, the ring / spotlight / star / shadow, the
  runner (the blow once, every exit restores, both directions, determinism, reduced motion, a knockout for 2), the
  scene.
- Looked at on a private dev server with headless Chrome on a manual clock: contact sheets for I to IV with the player
  striking, and III and IV with the foe striking.

## Not done / weak

- Frame times were measured in a DEV build on a machine running fifteen other builders: the median frame was at the
  display interval but there were scattered long frames, also present while idle and (more of them) in the shipped
  baseball attack measured the same way. No beat of this attack stood out, but the 6.25 ms bar is NOT proven. Measure
  the production build on a quiet machine.
- I: the red hand print sits under the big shared hit number, so mostly its glow shows.
- IV: the ring is two sides only (no ropes across the front or back: they would be drawn over the portraits' faces).
- The spotlight cone shows faint bands where its layers overlap.
- No cosmetic, patch note or rules entry (the coordinator adds those).

---

# Second pass (same day): weight, sound, the ring, the empty socket

The owner played the first version: "the 'huge' animations need some more umph ... especially reaper, the constellation,
the wrestling one etc. they are quick and not impactful", "they need sound effects", and no drawn objects that look like
clip art. Everything above describes the first pass; where the two disagree, this section is current.

## The black disc in the player's socket (a SHARED cause, fixed here for this attack only)

It is not the hero's own backing element. It is the board backdrop: `.boardbg-shade` (`styles.css`) paints the player
portrait's drop shadow as a static, fully black radial gradient (`--psh-a` is 1) plus the "hero shade" circle
(`--bd-shade-*`) in the backdrop layer, at the spot `StatusBar` measured for the RESTING portrait ("never mid-lunge, so
the shadow stays put"). With the portrait in place it reads as a shadow; with the portrait gone it is a soft black disc
about 400 px across. **Every attack that takes the player's portrait out of its socket uncovers it** (measured: Baseball
IV shows the same disc; none of Baseball, Soccer, Basketball or Backstab hide it). They are away for a moment, this one
for up to five seconds.

The fix lives in `heroWrestle.ts` (`SocketShade`): while a portrait is out of its socket, an inline override on the
`.boardbg-shade` elements turns off only that portrait's circles (`--psh-a: 0`, `--bd-shade-r: 0px` for the player;
`--bd-oshade-r: 0px` for the foe's shade in combat), leaving the hero power's shade alone. Two style writes per portrait
per attack, never per frame; every prior inline value is put back exactly just before the portrait is home and on every
exit (end, `finish()`, `cancel()`, the safety timer). A proper shared fix (the shade following or fading with the
portrait for every attack) belongs in its own PR.

## The ring

The two steel posts with red pads are gone, and so is the brass bell on its wooden block (painted props). IV's ring is
now light: a lit square of canvas seen in perspective, a pillar of light with a glowing cap at each of the FOUR corners,
and three ropes of light (red, white, blue) on EVERY side. It is about 7 portrait radii wide and 3.5 deep and frames the
whole play area: the back ropes pass above the two portraits and the front ropes below their middle. The far ropes go
out fast with the struck portrait, HOLD at full stretch (a thinner, longer rope), and snap back past straight; the near
ropes kick when it is thrown off them; the back and front ropes sag when the ring shudders under a landing, the cover and
each count. 33 own sprites, two textures (`tube`, `mat`).

## Weight

Held, then fast, then heavy, then a beat of aftermath:

- **II:** held overhead 520 ms (was 280), heaved a notch higher just before the drop, a 130 ms drop, shake 16 px (was
  10), a whole-frame flash, the new `matShock` (a wide ring, grit thrown flat and up, dust that hangs for over a second),
  a harder squash and a higher bounce, then the striker straightens up over the body and flexes. 3.0 s (was 2.2 s).
- **III:** 800 ms off screen while the spotlight hunts (was 480), a 220 ms dive, shake 26 px (was 14), full flash, both
  bounce off the mat, the striker rolls to its feet and flexes. 3.7 s (was 2.8 s).
- **IV:** the lock-up, a longer whip, 460 ms on the ropes (was 260), then the clothesline (shake 30 px, was 16). The
  blow now lands 1.71 s in (was 1.39 s). The flip is higher and the landing is a second heavy hit (shock ring, flash, a
  0.75 jolt). A 300 ms beat over the body, a high leap, and the cover lands as a hit of its own. 1, 2, 3 are about twice
  the size, slam in from three times that, and each shakes harder than the last (0.34 / 0.42 / 0.5 of the shake). 5.76 s
  (was 4.17 s). For comparison Baseball IV is 3.95 s and Soccer IV 3.31 s; this one is longer because of the count.
- No hit-stop and no slow motion: the clock still never changes speed, and the blow still lands once.

Also: the hand print (I) now sits on the side of the portrait away from the shared hit number, inside the screen, and
stays a full second. The spotlight cone is painted from 24 thin layers, so the bands are gone.

## Sound

Five ElevenLabs calls this pass (one of them a retry of the mat slap), four clips kept (4.5 s; 8.0 s with the first
pass's four): `fx/wrestle-thud` (0.66 s, the deep hollow thump of the ring: the low end under every body that lands),
`fx/wrestle-rope` (0.85 s, the ropes creaking taut, stretching, snapping), `fx/wrestle-slap` (0.35 s, the mat slap on
each count), `fx/wrestle-roar` (2.6 s, the crowd erupting on the elbow and on the bell). Shared `fx/soccer-crowd-ooh` is
the crowd drawing breath through every held beat, timed so its loudest part ends on the hit. Every beat now has a cue;
every landing is the canvas slap over the ring thud, the big ones with the boom under that.

Measured by recording the audio output of the tuner demo and slicing it into 100 ms windows (dBFS RMS), the attack's OWN
sound after the shared formation:

| | mean | loudest 100 ms | silent windows (< -45 dB) |
|---|---|---|---|
| Top Rope IV, first pass | -34.3 | -24.2 | 12 of 42 |
| Top Rope IV, now | -27.8 | -20.2 | 0 of 58 |
| Soccer IV (reference) | -32.0 | -26.1 | 0 |
| Top Rope III / II, now | -28.6 / -29.7 | -19.7 / -20.3 | 2 / 2 |
| Top Rope I, now | -32.1 | -25.5 | 1 |
| Soccer I (reference) | -36.1 | -29.7 | 5 |

So it is about 4 dB louder than Soccer on average and 6 dB louder on its biggest hits, which sit about 2 to 3 dB under
the loudest moment of the shared damage formation (-17 to -18). A first mix 3 dB hotter than this was pulled back. Nobody
has LISTENED to any of it: these are measured levels, and the character of the generated clips is judged from their
envelopes only (the mat slap came back very quiet and dull, was normalised by 25 dB, and is layered with the chop for
its smack).

## Verified (second pass)

- `heroWrestle.test.ts`, 36 tests: the new plan and cue order, the WEIGHT contract (held beats, short drops, shake
  ordering, aftermath lengths, the count's rising jolts), the ring's geometry (four corners, ropes clear of faces, size),
  the rope stretch curve shared by the portrait and the ropes, the ring drawn (4 pillars, 24 rope lengths, the bend, the
  sag), and the socket shade (off while away, back exactly on the end, finish and cancel, both directions).
- Contact sheets of all four looks with the player striking and III and IV with the foe striking, read frame by frame.
- Frame times, DEV build, headless Chrome at 240 Hz, IV both directions: the attack's own work per frame (cues, both
  transforms, the camera, the scene update) median 0.1 ms, 99th percentile 0.3 to 0.6 ms, worst 0.8 to 1.5 ms. The frame
  interval was 4.2 ms median, 4.3 to 8.4 ms at the 99th percentile, with 2 or 3 frames over 25 ms per run; Baseball IV
  measured the same way in the same session had 2. Those long frames are not in this attack's own step, but where they
  come from was not found, so the 6.25 ms bar is still NOT proven: measure the production build.

## Still weak / not done

- The front ropes cross the lower fifth of the portrait lying on the mat. It sells "inside the ring", but it is a choice.
- The lit canvas is additive and drawn over everything, so it lightens the Shop cards under it a little.
- III and II still happen close to the screen edge when the struck portrait is in a corner.
- The comic impact star and the red hand print are still painted shapes (kept: this attack is a joke).
- Sound character is unheard (see above). The crowd bed is one cheering clip re-entered several times in IV.
