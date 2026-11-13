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

## Second pass (2026-11-12, after the owner played the batch: "great, but they need sound effects")

**Sound (measured, not heard).** The attack's output was recorded in headless Chrome (a tap on the audio destination)
and read in 100 ms windows. Before, Big: the whistle sat at -38 to -41 dB RMS for the whole fall (close to inaudible),
the landing reached -30 dB RMS (peak -18 dBFS) and the pop -39. The reference Rare (the Coin Flick) runs -32 to -40 dB
RMS with -20 peaks; the shared formation boom that opens every attack is -17 to -20 dB RMS, peak -10.

- `fx/anvil-whistle` REPLACED: a descending slide whistle (about 1700 Hz down to 800 Hz), levelled 9 dB hotter. The cue
  plays the loud glide for exactly the fall and stops on the landing.
- `fx/anvil-boing` NEW (0.62 s): a springy boing for the accordion pop (lower under the piano).
- `fx/anvil-keys` NEW (0.6 s): loose wooden keys clattering, a quarter of a second after the piano lands.
- The ground thud is now the shared `fx/heavy-rock-impact` (pitched down, under BOTH objects). The old thud clip has
  its hit 400 ms into the file and was cued from the start, so it arrived late and quiet. The swish cues (the spark, the
  toss) now play the loud part of the shared swish.
- 3 ElevenLabs calls this pass; the five own clips total 4.8 s.
- After, Big: whistle -24 to -26 dB RMS through the whole fall, the landing -18 to -20 for 0.7 s (peak -9), fading
  through the boing and the keys. Small: whistle -24, landing -19 (peak -10). The landing is the loudest moment and
  matches the formation boom. No stretch of the attack is silent.

**The top of the screen: the portrait ducks.** Against a foe in the top right corner the fall was off screen and the
piano was shrunk to fit. Now a struck portrait with no headroom SINKS under the growing shadow (`anvilPull`, at most one
radius, eased over the first half of the fall), is flattened down there, and comes back up as it pops; the shadow, the
dust and the object follow it. That gives the piano its full size and about 180 px of visible fall at 1080p. With
headroom (the foe striking you) nothing ducks. The transform is restored exactly on every exit (tested). The cost: for
that second the ducked portrait sits behind its own health plate.

**Impact (Big).** Shake 13 to 19 px and longer (300 to 380 ms), a bigger punch-in, a second slow dust ring 8 radii
wide, 26 dust puffs (from 18), rings 20% larger. Running time 1.87 s to 1.93 s after the formation (the settle only).
No new drawn objects.

**Perf.** The struck portrait now holds `will-change: transform` while it is squashed (the browser re-rastered it at
every new scale), restored on every exit. DEV build, headless, a loaded machine, top look, both directions: median
4.2 ms (240 Hz), 99th percentile 4.3 ms, worst 25 to 33 ms on the two frames where the shared camera starts and
resets (the Coin Flick shows the same two). Not measured on a production build.

Sheets: `scratchpad/attacks/anvil/sheets-v2/`. Still weak: nobody has listened; the ducked portrait overlaps its plate;
the big `-N` still covers the object on the landing frame.
