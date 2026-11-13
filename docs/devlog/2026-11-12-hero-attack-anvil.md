# Hero attack: Look Out Below (style id `anvil`, a Rare)

Built on the `anvil` scaffold (copied from the Coin Flick by `npm run attack:new`). DEV-only: no cosmetic yet, so
it plays only through the dev "Attack style" override and its tuner.

## The idea

THE CARTOON DROP. A shadow grows on the struck portrait while a slide whistle falls, something heavy drops from
above the top of the screen, and the portrait squashes flat under it, then pops back like an accordion. No other
attack drops an object onto the portrait or flattens it.

## The two looks

- **Small** (shared tiers I-II): a black iron anvil. Cue 220 ms, fall 480 ms, flat 270 ms, pop back 470 ms
  (1440 ms after the formation).
- **Big** (shared tiers III-IV and every knockout): an upright piano. A shadow about 1.7 portrait radii wide, a
  longer and lower whistle (fall 720 ms), a flatter squash, more dust, and 14 loose piano keys that fly out, fall
  and bounce twice on the ground line (1870 ms after the formation).

The beats, both looks: the striking hero hops and sends a small star straight up; the shadow appears on the struck
portrait and grows for the whole fall; the object comes into view over the last ~200 ms; THE LANDING lands the blow
(once, through the shared `Sequence.land()`); the portrait is held flat under the weight; on the pop the object is
tossed off toward the striking hero's side of the screen, turning and fading, while the portrait springs tall,
short, tall and settles on exactly 1.

## How

- `heroAnvilConfig.ts`: the pure plan (`anvilPlan`, `anvilCues`), the pure squash (`anvilSquashAt`: pressed flat,
  then a damped spring that returns exactly `{1, 1}` once under `ANVIL_REST_EPS`), the resting offset the object
  sits at (`anvilRestOffset`), and the pure camera (a push in through the fall, a straight-down shake on the
  landing).
- `heroAnvil.ts`: the runner on the shared clock. The struck wrapper is scaled about the BOTTOM of its round art,
  so it flattens onto its own ground line. The wrapper is not the art and sits inside scaled ancestors, so its
  transform origin and its px-to-screen ratio are measured ONCE at the start (`squashPivot`, using the shared
  `restingRect`); after that only `transform` is written, from the clock. Opacity, filter and classes are never
  touched, and `PortraitMover` restores the transform on every exit.
- `heroAnvilScene.ts`: on the shared `FxPool` (cap 160 sprites; a piano landing peaks near 60). The scene owns the
  shadow, the object (fall, rest, tip) and the keys (a tiny bounce integrator); the dust, rings and stars are pool
  effects. The resting object reads the same squash value the DOM gets the same frame, so the two cannot drift.
  A falling or resting object whose next beat never comes clears itself after 3 s.
- `heroAnvilTextures.ts`: six canvases painted once per session (anvil, piano, white key, black key, dust puff,
  shadow), on top of the shared Arcana set.
- A portrait near the top of the screen: the object still starts above y = 0, and it is sized down (never under
  1.6 radii wide) so the whole of it is on screen while it rests on the flattened portrait. A portrait in a corner:
  the object is nudged in from the screen edge by at most half a radius.
- Variation is seeded from the blow and `rollSeed`.

## Sound

Three ElevenLabs clips (3 calls, no retries), trimmed to the hit, mono 44.1 kHz 128 kb/s, about -20 to -21.7 LUFS,
peaks at or under -1.6 dB (the clang and the piano go through a limiter; the whistle is a steady tone and peaks at
-16 dB). Onsets measured at 0 to 14 ms, so cues play from the clip start.

| clip | length | use |
| --- | --- | --- |
| `fx/anvil-whistle` | 1.0 s | the fall; a window exactly as long as the fall, pitch x1.3 (anvil) or x0.94 (piano) |
| `fx/anvil-clang` | 0.9 s | Small: the landing |
| `fx/anvil-piano` | 1.6 s | Big: the landing |

Reused shared clips: the swish (the cue, the pop) and `universfield-ground-impact` (a low thump under the piano).
Total new audio 3.5 s.

## Verified

- `heroAnvil.test.ts`: tiers, tuner values, plan per look, drop length, squash (flat, three shrinking overshoots,
  exact rest), camera, the runner in both directions at four damages, a portrait at the top of the screen, the blow
  landing exactly once, finish / cancel / natural end restoring transform, opacity, filter and classes, replay
  from the seed, reduced motion, the pooled scene draining.
- Looked at in headless Chrome at 1920 x 1080 from the dev server: both looks in both directions.

## Not done, weak, or unverified

- No cosmetic, no patch note (the style is DEV-only).
- Nobody has LISTENED to the clips or the mix. Levels and cue points come from measurements only.
- The shared `-N` hit number pops on top of the object at the landing and hides most of the flattened portrait for
  a few hundred ms, more so on a big number.
- When you strike the foe, its portrait sits at the very top of the screen, so the fall itself is almost entirely
  off screen there; the shadow and the whistle carry the anticipation and the object is seen landing and resting.
- Perf was measured on the DEV build in headless Chrome only (no production build, not the owner's machine).
  Median frame 5.6 ms; two frames of 40 to 70 ms about 70 ms after the cue and 20 to 40 ms at the end appear in
  every run, and the shipped Coin Flick shows the same two spikes in the same harness, so they look like the shared
  camera start and reset rather than this scene. Not confirmed on a production build.
- The Collection sandbox (`space: 'local'`) was not looked at. There the squash pivots on the wrapper's own centre
  plus a radius, without the one-time measure.
- Phones and reduced motion were covered by tests only.
