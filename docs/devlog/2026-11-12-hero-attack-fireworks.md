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
| 3, the mortar shell | A mortar is planted. A heavy thump (the tube squashes, the view kicks down, the hero flinches) and one faint comet rises and leaves the TOP of the screen. Then the held beat: 600 ms with the screen dimmed and nothing moving. Then a chrysanthemum opens over the struck portrait (a gold ring, a magenta ring inside it, a smaller cyan bloom 120 ms later, green and white crackle, a brief light across the screen) and sparks fall on true ballistic paths onto the portrait and twinkle out there. The bloom is the blow. | 1250 | 2450 |

## How

- `heroFireworksConfig.ts`: the tuned values, the pure plan and cues, the pure geometry and the pure camera.
  - The firework stands beside the striker on the target's side, on the line of the portrait's lower edge, leaning at
    the target but never past a limit (rocket 0.82 rad, candle 0.55, mortar 0.1), so it always reads as standing on the
    ground. A target below is reached by a lobbed arc. Every fuse is painted on the left; the firework is mirrored when
    its hero stands to its right.
  - A flight is a quadratic curve that leaves along the lean and bends onto the face. The rocket adds a sideways
    wiggle pinned to zero at both ends. The point that bends a curve is pulled back along the lean until it is inside
    the view, so no flight leaves the screen (a test found the candle's arc going 29 px off the top).
  - The bloom's radius is 3 portrait radii. Its centre hangs above the struck portrait and is kept at least 0.65 of a
    radius inside the view, so over the foe in the top right corner it opens beside and over the portrait rather than
    off the screen.
  - The held beat is STAGED, not a pause: the clock runs straight through it. The camera returns the same zoom and no
    offset for the whole beat, the launch kick and the hero's flinch are cut off after 200 ms, the thump's puffs are
    short, and no cue fires inside it.
- `heroFireworksScene.ts`: on the shared `FxPool`. The rocket is ONE sprite: planted, then the same sprite flies. The
  bloom's stars are the only crowd, so they live in flat typed arrays (one sprite each, nothing allocated per frame),
  capped at 240, additive, no filters. Their sprites are created ahead of time, 14 per frame while the damage formation
  plays, so the bloom frame creates none. The whole scene is capped at 420 sprites; a bloom peaks around 230.
- `heroFireworksTextures.ts`: three props painted once per session on 2D canvases at 2x (the rocket, the candle, the
  mortar), with cylinder shading, a dark outline, wood grain and fuses. Everything else reuses the shared glow, spark,
  streak, ring and star.
- `heroFireworks.ts`: the runner, on the shared clock, formation, camera and portrait movers like every other style.

## Sound

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
- With the foe in the top right corner there is no room above it, so the bloom opens beside and over the portrait and
  the falling sparks lob into it rather than rain down. Striking the player's own portrait (bottom left) shows the
  bloom properly above it.
- The shared hit number lands on top of the bloom's centre for a moment.
- No frame-time number from a production build (see Perf).
- The first headless capture runs (about ten page loads) did not block the live backend, so they may each have made
  an anonymous sign-up there; one logged a 429 from a remote host. Every later run aborts all non-local requests.
- Not seen on a real display, at a phone size, or in the Collection preview box (a geometry test covers the small box).
