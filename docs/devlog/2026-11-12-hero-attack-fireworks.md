# 2026-11-12: Grand Finale, a fireworks hero attack (Epic, dev-only)

Style `fireworks`, working name "Grand Finale". Built on the scaffold from `npm run attack:new` (copied from Storm
Call) and rewritten end to end: nothing of the storm is left. It is still DEV-ONLY with no cosmetic; it plays through
the dev "Attack style" override and its tuner (`HeroFireworksTuner.tsx`).

## The idea

Fireworks, and above all the HELD BEAT OF QUIET before a big shell blooms. No flame anywhere (Inferno owns fireballs,
live flame and meteors): fuses, coloured sparks, glitter trails and star bursts in gold, magenta, cyan and green.

An Epic has three looks. The shared tier maps exactly as Storm Call's does: I plays look 1, II and III play look 2, IV
and any knockout play look 3.

| look | what happens | impact (ms from the first beat) | end |
| --- | --- | --- | --- |
| 1, the bottle rocket | A little rocket on a stick is planted beside the striking hero, leaning at the target. Its fuse fizzes (300 ms), it squeals off on a wiggly path dropping a thin spark trail, and pops on the struck portrait in a small star burst of ONE colour (rolled from the seed). | 790 | 1450 |
| 2, the roman candle | A tube is planted and thumps out three glowing balls 180 ms apart, each a different colour on its own arc. The first two pops are ticks (FX and sound only, a small nudge); the third pop is the blow. | 1060 | 1780 |
| 3, the mortar shell | A mortar is planted and its fuse fizzes (440 ms). A heavy thump (the tube squashes, the view kicks down, the hero flinches) and one comet whistles up and leaves the TOP of the screen (400 ms). Then the held beat: 620 ms with the screen dimmed and nothing moving. Then THE BLOOM (the blow): a white core flash and a light across the whole view, two shock rings, four rings of stars (gold, magenta, cyan, a white heart), a slower willow ring that hangs and falls, the view kicked hard, the struck portrait lit, knocked and rocked. Then THE FINALE: three smaller shells crack open round it 270 ms apart (FX and sound only), each rocking the portrait again, while glitter crackles lower and lower for a second and a half. | 1590 | 3390 |

The table above is the SECOND pass (see the end of this file). The first pass's mortar ran 1250 / 2450.

## How

- `heroFireworksConfig.ts`: the tuned values, the pure plan and cues, the pure geometry and the pure camera.
  - The firework stands beside the striker on the target's side, on the line of the portrait's lower edge, leaning at
    the target but never past a limit (rocket 0.82 rad, candle 0.55, mortar 0.1), so it always reads as standing on the
    ground. A target below is reached by a lobbed arc. Every fuse is painted on the left; the firework is mirrored when
    its hero stands to its right.
  - A flight is a quadratic curve that leaves along the lean and bends onto the face. The rocket adds a sideways
    wiggle pinned to zero at both ends. The point that bends a curve is pulled back along the lean until it is inside
    the view, so no flight leaves the screen (a test found the candle's arc going 29 px off the top).
  - The bloom's radius is 4.4 portrait radii, never more than 0.44 of the view's shorter side. With room above the
    struck portrait it hangs straight above it. With no room above (the foe in the top right corner) it opens in the
    open sky on the side of the portrait that faces the middle of the view, so it blooms over the board with the
    portrait on its rim (second pass; the first pass crushed it into the corner on top of the portrait).
  - The held beat is STAGED, not a pause: the clock runs straight through it. The camera returns the same zoom and no
    offset for the whole beat, the launch kick and the hero's flinch are cut off after 200 ms, the thump's puffs are
    short, and no cue fires inside it.
- `heroFireworksScene.ts`: on the shared `FxPool`. The rocket is ONE sprite: planted, then the same sprite flies. The
  bloom's stars are the only crowd, so they live in flat typed arrays (one sprite each, nothing allocated per frame),
  capped at 400, additive, no filters. Every sprite the bloom frame asks for (stars, glitter, flashes, the finale's
  stars) is created ahead of time, 14 per frame while the damage formation plays, so the bloom frame creates none.
  The whole scene is capped at 760 sprites; the bloom and its finale peak around 520.
- `heroFireworksTextures.ts`: three props painted once per session on 2D canvases at 2x (the rocket, the candle, the
  mortar), with cylinder shading, a dark outline, wood grain and fuses. Everything else reuses the shared glow, spark,
  streak, ring and star.
- `heroFireworks.ts`: the runner, on the shared clock, formation, camera and portrait movers like every other style.

## Sound (first pass; replaced, see "Second pass" below)

Six ElevenLabs calls (the Epic budget), four clips kept, 3.94 s in all, in `packages/ui/src/audio/fx/`. Each was
trimmed to its hit, faded, made mono 44.1 kHz 128 kb/s, and levelled toward -20 LUFS with a -1 dB peak ceiling.

| clip | kept | level | measured |
| --- | --- | --- | --- |
| `fireworks-fuse` | 0.60 s | -22.4 LUFS | a steady hiss from the first sample |
| `fireworks-squeal` | 0.82 s | -21.4 LUFS | a sustained whistle around 3.3 to 4.3 kHz for 0.66 s, then a fade. A second take: the first was only a 0.15 s burst |
| `fireworks-thump` | 0.37 s | peak -3.6 dB (too short for a loudness reading) | the hit is 34 ms in |
| `fireworks-boom` | 2.15 s | -27.1 LUFS, peak -1.5 dB | the boom is 26 ms in; a separate crackle take is mixed under it from 0.17 s to about 0.7 s (the boom's own crackle was 30 dB down) |

Cues: the fuse plays for exactly as long as it burns; the squeal runs the length of the rocket's flight; the candle
plays the thump softer and higher three times (pitch 1.45, 1.55, 1.65) and its pops are the boom pitched up and cut
short; the mortar plays the thump low (0.85) and the full boom (0.92) with a short tail. Nothing is cued in the held
beat. The plant reuses the existing `placelow`. The storm's two shared clips are no longer named by this style.

Nobody has listened to these. They were placed from ffmpeg measurements only.

## Verified

- `npx vitest run packages/ui/src/heroFireworks packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 899
  tests, all passing. `npm run typecheck` clean; `npm run lint` 0 errors and no warning in these files.
  `heroFireworks.test.ts` is rewritten (42 tests): the tier mapping, the tuner, cue
  timing per look, geometry in both directions on the real layout, the camera exactly still through the held beat, the
  blow landing once, the held beat sampled every 4 ms (scene, camera and both portraits at rest while the clock
  advances), prefilled star sprites, replay, finish / cancel / safety timer restoring transform, opacity, filter and
  class, and the headless scene.
- Looked at in headless Chrome at 1920 x 1080 with the clock driven by hand through the runner's `frames` seam, so
  every picture is at an exact sequence time. Contact sheets for every look in both directions.
- Capture runs block every non-local host (the later ones; the first handful did not, see below).

## Perf (DEV build on the vite dev server, headless Chrome, 1920 x 1080, vsync and frame cap off, sound off)

Measured while fifteen other builders were using the same machine, so treat it as a ceiling, not a clean bench. Frame
times are requestAnimationFrame deltas in ms; "step" is the JS time of this attack's own per-frame step (formation
paint, camera, portraits, scene update), timed around the step itself.

| run | frames | p50 | p95 | p99 | worst | over 6.25 ms | step p99 | step worst |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mortar, you (first play) | 4700 | 0.6 | 2.0 | 4.0 | 17.0 | 14 | 0.2 | 1.9 |
| mortar, you | 4368 | 0.7 | 2.2 | 5.7 | 29.5 | 37 | 0.2 | 0.9 |
| mortar, foe | 4755 | 0.6 | 2.1 | 4.2 | 16.5 | 16 | 0.2 | 1.4 |
| mortar, you | 4802 | 0.6 | 2.0 | 3.8 | 24.3 | 16 | 0.2 | 0.6 |
| candle, you | 3023 | 0.8 | 2.6 | 6.1 | 16.6 | 28 | 0.3 | 0.7 |
| rocket, you | 3091 | 0.8 | 2.3 | 4.4 | 17.5 | 9 | 0.2 | 0.6 |

The bar (no frame over 6.25 ms) is NOT met in this measurement: every run has a handful of frames over it. The
repeating ones sit on the attack's FIRST beat (about 18 ms in: the shared camera and dim start) and on its END (the
shared teardown), in all three looks; the bloom frame itself never appears among the worst four of any run, and the
attack's own step never costs more than 1.9 ms. The rest move from run to run. This needs a clean production bench on
the owner's machine before it is trusted either way.

## Not done, or weak

- No cosmetic, no patch note, no rules entry: the coordinator adds those.
- The sounds are unheard (see above).
- (Fixed in the second pass.) With the foe in the top right corner the bloom opened beside and over the portrait.
- The shared hit number lands on top of the bloom's centre for a moment.
- No frame-time number from a production build (see Perf).
- The first headless capture runs (about ten page loads) did not block the live backend, so they may each have made
  an anonymous sign-up there; one logged a 429 from a remote host. Every later run aborts all non-local requests.
- Not seen on a real display, at a phone size, or in the Collection preview box (a geometry test covers the small box).

## Second pass (2026-11-12): sound, and the bloom as the payoff

The owner played the batch: the attacks "need sound effects" and the big looks are "quick and not impactful". This
pass re-did the sound from measurements and rebuilt the mortar's second half. The rocket and the candle look the same
(a touch more burst and shake); they sound different.

### Sound

Measured first. The attack was played with sound in headless Chrome, the audio output was tapped and recorded, and the
recording cut into 100 ms windows (RMS, dBFS). Every style shares the opening damage formation (its loudest window is
about -14 dB); the numbers below are the attack's OWN sound, from its first beat to 400 ms after its end.

| | own RMS | loudest own window |
| --- | --- | --- |
| mortar, first pass | -30.8 dB | -29.9 (the boom) |
| mortar, now | -21.0 dB | -14.0 (the boom; five windows in a row between -14 and -16) |
| candle, now | -25.5 dB | -19.3 (the third pop) |
| rocket, now | -27.3 dB | -21.1 (the pop) |
| Storm Call IV (the shipped Epic) | -22.6 dB | -17.9 |
| Soccer IV | -28.3 dB | -22.8 |
| Frost IV | -27.7 dB | -21.6 |

The first pass's boom was a 100 ms click 15 dB under the formation: that is why it read as silent.

Six more ElevenLabs calls (the pass's budget), no retries. Seven clips now, 7.2 s in all:

| clip | length | what it is (measured) |
| --- | --- | --- |
| `fireworks-boom` | 2.40 s | REPLACED. Two takes mixed: a sub boom (40 Hz, a second long) under a mid crack-bang with a rolling echo (700 Hz, two seconds). The first 500 ms hold about -9 dB RMS with both low and mid energy. |
| `fireworks-crackle` | 1.70 s | NEW. Dense crackle, 6 to 7 kHz, level for 1.3 s then fading. |
| `fireworks-thump` | 0.35 s | REPLACED. A hollow launch thump with an 80 Hz body under it (the sub take at double speed). |
| `fireworks-pop` | 0.55 s | NEW. A crisp crack (2 to 3 kHz) with the crack-bang at 1.5x under it for body. |
| `fireworks-whistle` | 0.75 s | NEW. A whistle rising from 2.9 to 4.8 kHz over 300 ms, then fading. |
| `fireworks-fuse`, `fireworks-squeal` | 0.60 s, 0.82 s | kept, played louder. |

Clips are peak-normalised to -1.5 dB (not to -20 LUFS: the boom has to carry) and levelled with their gains.

Cues, per beat:
- plant: `placelow`, and under the mortar a soft low thump (the heavy tube set down).
- fuse: the fizz for as long as it burns, at 1.8.
- launch: the rocket's squeal with a small kick under it; the candle's thumps (1.3x, 1.4x, 1.5x); the mortar's hollow
  thump at 1.3 with the whistle climbing for as long as the comet is in view.
- THE HELD BEAT: nothing (measured: -50 to -63 dB for 600 ms).
- pops: the pop, with the boom short and at 1.5x under THE blow, and a breath of crackle after it.
- THE BLOOM: the boom at 1.6, the crackle from 170 ms, a second lower take of the crackle from 850 ms (so it runs for
  about 2.2 s), and each finale shell a pop with the boom at 1.25x to 1.5x under it.

Still quiet: the fuse (-29 dB) and the rocket's squeal (-30 dB) sit well under their pops on purpose (a hiss and a
whistle are thin sounds; louder would be the "plinky" the owner dislikes). Nobody has HEARD any of this: every level
is measured from the recorded output, not listened to.

### Impact

- The mortar ran 2450 ms; it now runs 3390 (Soccer IV 3308, Frost IV 3083). The extra time is anticipation (a longer
  fuse and a longer whistling rise; the held beat is 620) and aftermath (1.8 s from the bloom to the end, was 1.2).
  The blow still lands once, on the bloom, 1590 ms in (Soccer IV 1978, Frost IV 2283). No hit-stop.
- The bloom is 4.4 portrait radii (was 3): about 950 px across on a 1080p screen. Four rings and a willow instead of
  three rings; a core flash that lights the whole view (sky light 0.30, was 0.14); two shock rings; 90 crackle
  twinkles spread over 1.3 s that sit lower the later they fire (was 26).
- THE FINALE: three smaller shells (magenta, cyan, green) open round the bloom at +330, +600 and +870 ms, each with
  its own flash, ring, stars, crack and a pulse of light across the view.
- Camera: shake 28 px (was 15), slower and longer (12 Hz), a harder punch in, and a nudge on every finale shell.
- The struck portrait is LIT (a warm additive glow and a white flash on it that ride its knockback, again in each
  finale shell's colour), knocked 22 px on a slower spring, ROCKED 5 degrees, and rocked again by every finale shell.
- Staging in the top right corner: see "How". The hit number now sits on the portrait, clear of the bloom's core.

### Style

No new drawn object. The three painted fireworks from the first pass are kept (they are small, and the look is the
sparks, not the tube).

### Verified (second pass)

- `npx vitest run packages/ui/src/heroFireworks packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 903
  tests, all passing (43 in `heroFireworks.test.ts`: the finale's plan and cue order, the new running time, the bloom's
  size and both stagings, the finale's points, the portrait rocked, the star counts, the caps). `npm run typecheck`
  clean. `npm run lint`: 0 errors (148 warnings repo-wide, none in these files).
- Looked at in headless Chrome at 1920 x 1080 (real-time screencast, sound off): the mortar in both directions, the
  rocket, the candle in both directions. After every run both portraits and the stage had no transform left.
- Frame times, DEV build, headless Chrome, vsync off, no capture, while other builders used the machine. Mortar, four
  runs: median 0.7 to 0.8 ms, 99th percentile 4.7 to 7.1 ms, worst 25 to 43 ms. The worst frames sit on the shared
  opening (about 25 ms in) and the shared teardown (the end) in every run, as in the first pass; the attack's own
  per-frame step costs 0.5 ms at the 99th percentile and 1.3 to 5.2 ms at worst, 1.3 to 2.7 ms on the bloom frame.
  Not measured on a production build.

### Still weak or unverified

- Unheard (see Sound). The boom is as loud as the formation's loudest moment; if that is too much, `sfxBoomGain`.
- The bloom frame is very bright for about 100 ms (the core flash plus the sky light). Dials: `skyFlash`, `flashAlpha`.
- The last half second of the aftermath is thin: a few falling willow stars and twinkles.
- With the foe in the top right corner the bloom's top edge leaves the screen for a moment and it covers the lobby rail.
- Not seen on a real display, a phone, or in the Collection preview box.

## Third pass (2026-11-13): launched from light, live Pixi shells, whimsy, an overboard finale

The owner's note: "this one's okay. i wish it had some more whimsy and pixi to it. the firework cannons and jpegs are
pretty ugly ... the grand finale can be more overboard". Everything above this section describes the retired launchers
and is kept as history only.

### What changed

- **No launcher, no painted object.** The rocket, the roman candle and the mortar (and their painted textures) are gone.
  A spark ignites on the rim of the striking hero's portrait (turned between the target and straight up), a fuse of
  crackling sparks crawls round the rim into it, and every shell leaves from that light as a hot head and a glow on a
  short streak, dropping a glittering trail. The only texture of this style's own is a soft smoke puff.
- **Every shell is particles** in flat typed arrays (`MAX_PARTICLES` 2000, sprites pooled, `MAX_FIREWORKS_SPRITES`
  2400, made ahead while the formation plays): stars thrown out on a projected sphere with drag and gravity droop,
  stretched along their speed, some changing colour part way, some trailing glitter, flickering as they die; crackle
  stars that pop late; ring, heart, smiley and spiral (a spinning emitter) shells; willow stars that hang and fall;
  smoke that hangs and drifts after every burst.
- **Tier names**: Tier 1 (shared tier 1), Tier 2 (shared tiers 2 and 3), Tier 3 (shared tier 4 and every knockout),
  in the tuner groups, play buttons, hints and tests.
- **Variants** rolled from `rollSeed` (`fireworksVariantOf`), forced by the tuner's Variation row:
  1 the smiley, 2 the pinwheel, 3 the fake-out.

| tier | what it does | variant 1 | variant 2 | variant 3 |
| --- | --- | --- | --- | --- |
| Tier 1 | the spark, the fuse, one shell bursts beside the struck portrait, sweeping it | a smiley that winks and slowly melts | a catherine wheel spins up on the hero's rim, flies still spinning, bursts in a spiral | a dud climbs a little, sputters, flops and goes "pfft"; a pause; the real one zips in |
| Tier 2 | a ring round the struck face and a heart beside it (ticks: a flinch, a singe), then the blow | a smiley | a spiral | it hangs and sputters faster and faster, then every crackle star pops at once |
| Tier 3 | three waves of shells (6, 8, 10) from the hero's spark and the bottom of the screen across the whole sky, one per wave on the struck portrait; a comet rises off the top; THE HELD BEAT (smoke hanging, a crowd "ooh"); ONE ENORMOUS SHELL (radius = the screen's shorter side) with a camera push and a big shake, a crackling glitter rain over everything and a crowd "aah"; a final flash on the struck portrait | a smiley in the sky, a smiley inside the enormous shell | a pinwheel off the hero's rim, a spiral inside it | the show opens with a dud, a heart inside it |

Running time (ms from the attack's first beat): Tier 1 1720 to 2460; Tier 2 2340 to 2780; Tier 3 impact about 3060
(3590 with the dud), end about 5560 to 6090 (the mortar was 1590 / 3390).

The struck portrait flinches and twists at every tick, is lit by every burst on it, and is SINGED: soot smudges, sparkles
and wisps of smoke that ride its knockback and fade by the end.

### Sound

Six ElevenLabs calls (one a retake of the volley), five clips kept, 8.2 s in all: `fireworks-ignite` (0.55 s, the
spark striking), `fireworks-dud` (0.68 s, a sputter and a deflating pfft), `fireworks-pinwheel` (1.54 s, a whirring
spark hiss), `fireworks-volley` (2.12 s, a barrage of bursts then a rumble, under every Tier 3 wave),
`fireworks-aah` (2.0 s, a small crowd's "aaah"). Peak-normalised to -1.5 dB (the pinwheel and the crowd levelled to
-19 and -21 LUFS). The held beat reuses `soccer-crowd-ooh`, softly. Every beat has a cue (see the runner's header). The
plant clip `placelow` is no longer used. Measured, not heard.

### Verified

- `npx vitest run packages/ui/src/heroFireworks packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 904
  tests, all passing. `heroFireworks.test.ts` rewritten (39 tests): the variant roll (deterministic, all three reached,
  each forceable), every tier and variant and both directions landing the blow exactly once, the ticks not landing it,
  the held beat (no cue, camera still, portraits at rest), the geometry inside the view, no body-layer sprite ever drawn,
  the smiley's shape, the dud throwing no stars, the caps, every exit restoring the portraits and the camera.
- Contact sheets of every tier and variant (you striking) and Tier 3 the other way.

### Loudness (measured, not heard)

The attack's own sound (from its first beat to 400 ms after its end), recorded off the audio output in headless Chrome,
100 ms windows: Tier 3 -23.1 dB RMS (loudest window -15.1), Tier 2 -27.7 (-19.1), Tier 1 -28.3 (-19.1). The second
pass measured -21.0 / -25.5 / -27.3; the references Storm Call IV -22.6, Soccer IV -28.3, Frost IV -27.7. The means
are a little lower than the second pass because the looks are longer and Tier 3 has a deliberately hushed held beat and
a long glittering aftermath; the loudest moments are the same order.

### Perf (DEV build, vite dev server, headless Chrome, 1920 x 1080, vsync and frame cap off, sound off, no capture)

The machine was shared with other builders, so these are ceilings. Tier 3, five runs: frame p99 4.5 to 12.8 ms across
the attack and 8 to 28 ms in the 1.3 s after the enormous shell; worst 16.5 to 35.8 ms. The attack's own JS step
(formation paint, camera, portraits, the whole particle update) is p99 0.7 to 2.6 ms, worst 5.7 ms: the particle crowd
is cheap on the CPU. The frames over budget sit on the enormous shell and the glitter rain, which is GPU fill (hundreds
of additive sprites, a full-screen sky light, big smoke puffs over the dim layer). The particle cap (2000) is reached
for a moment at the enormous shell, when the last of the barrage is still in the air (a few late sparks are then
skipped, by design). The bar (no frame over 6.25 ms) is NOT shown met here; it needs a production bench on the owner's
machine, and the dials to pull if it is too heavy are `giantStars`, `rain`, `smoke` and `v3Stars`.

### Still weak or unverified

- Unheard. The new clips were placed from envelopes only.
- Tier 1 is small on screen, as the lightest look should be; the smiley's eyes sit under the shared hit number for a
  moment, and the dud's flop is subtle (the "pfft" puff reads better than the fall).
- Not measured on a production build or a phone; not seen in the Collection preview box (a geometry test covers it).

## Fourth pass (2026-11-13): the finale lands ON the struck portrait, and runs longer

The owner's note: "the last major explosion should be on the enemy portrait, or at least some of the explosions should
be. you can lengthen it a bit too to make it more over the top". Tier 3 mainly; Tier 1 and 2 got one light touch.

### What changed

- **The enormous shell bursts ON the struck portrait.** Its heart sits on the face, nudged a third of a portrait radius
  toward the middle of the view and kept at least 1.1 portrait radii inside every edge, so in a corner the bloom runs off
  the screen while its core flash, the portrait and its reaction stay on it. Its stars are thrown over the part of the
  circle that faces the middle of the view (about three quarters of it in a corner), so few are wasted off screen. The
  portrait at its heart gets its own white star, a tight shock ring and a stronger light, all riding its knockback;
  the old "sparks fall onto the portrait" became a fountain thrown up out of the burst that falls back onto the face.
  The variant's inner shape (smiley, spiral, heart) opens a little toward the middle so it stays readable.
- **The target takes hits throughout.** Every barrage wave now has two ticks (`waveHits`): one beside the struck
  portrait, one ON it (a little jitter). Then THE CRESCENDO: five shells off the hero's spark 115 ms apart, every one
  bursting on the face, each a little bigger, the last a crackle, with the volley rolling under it. The comet goes up as
  it ends; the held beat follows as before (560 ms, nothing cued inside it).
- **Longer.** Four waves (6, 7, 8, 9 shells: one more per wave, was two), the crescendo, a held beat of 560 (was 520),
  the final flash at +1450 (was +1350) and an aftermath of 3000 ms (was 2200). THE AFTERMATH (`smoulder`): crackle snaps
  and glowing embers on the struck face, crackle pops spitting short sparks, glitter drifting down onto it and dark smoke
  curling up off it, thinning out to the end; the glitter rain is thicker (240 specks over 2.6 s, was 170 over 2.3).
- **Tier 3 length** (ms from the first beat): about 7250 (the dud variant about 7730), impact about 3950 (4430). Was
  5560 to 6090.
- Tier 1 and 2: the impact peony, spiral and crackle open 0.75 portrait radii off the face (was 1.15), so they sweep
  it more.
- Soot: the ticks may make at most 10 soot smudges in a show (there are now 13 ticks); the blow always adds its own,
  a little darker.

### Frame cost

The busiest moment moved: it is the last wave and the crescendo together, about 1.2 s before the enormous shell, not the
shell itself (which sits around 1000 to 1100 particles). Barrage shells in Tier 3 throw 62 % of a burst's stars (ticks
and the crescendo 75 %). Peak particles in headless runs, both directions, all variants: 1365 to 1861 of the 2000 cap
(the third pass hit the cap). No new clip: every new beat reuses existing ones (pops, booms, the volley, two more
crackle cues in the aftermath).

DEV build, vite dev server, headless Chrome, 1920 x 1080, vsync and frame cap off, sound off, five Tier 3 runs (shared
machine, so ceilings): frame p99 4.7 to 7.0 ms across the attack, 4.5 to 7.1 in the 1.3 s after the enormous shell
(third pass: 8 to 28); worst 16.7 to 25.3, on the shared opening, the shared teardown or a one-off. The attack's own JS
step p99 0.5 to 0.6 ms, worst 1.6 to 8.1. The bar (no frame over 6.25 ms) is still NOT shown met here; it needs a
production bench.

### Verified

- `npx vitest run packages/ui/src/heroFireworks packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 906 tests,
  all passing (42 in this attack's file; new: four waves with their ticks and the crescendo, the 6.8 to 8.2 s length in
  every variant and seed, the bloom within half a portrait radius of the face and its core on screen with the struck
  portrait in all four corners, every tick and crescendo shell on or beside the face, the aftermath emitter running
  and draining). `npm run typecheck` clean; `npm run lint` 0 errors.
- Contact sheets of Tier 3 both directions and close crops of the bloom on the portrait in both corners.

### Still weak

- The aftermath's smoke is faint over a bright portrait; the embers and crackle carry it. Dials: `singe`, `smoke`.
- The shared hit number sits on the bloom's core for its first moment (now it is also the portrait).
- Unheard: no new sound, but the crescendo stacks five pops and booms in half a second.
