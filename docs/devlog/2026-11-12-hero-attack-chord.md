# 2026-11-12: Power Chord, a hero attack you can see the sound of (style `chord`, Epic, dev-only)

One of sixteen attack styles scaffolded on `feat/hero-attacks-16` (`npm run attack:new`, see
`2026-11-11-attack-scaffold.md`) and built in parallel. This one was scaffolded from Storm Call and rebuilt from the
config up; nothing of Storm Call's look is left. It has NO cosmetic yet, so it plays only through the dev "Attack
style" override and its tuner (Dev menu, "Hero Attack: Power Chord (Epic)").

## The signature

VISIBLE SOUND. A five-line musical STAFF is strung between the two heroes like plucked strings, music notes ride it,
and the top look is a stack of speakers whose bass wave bends what it passes through. No other attack draws a staff, a
note or a sound wave.

The staff is the stage and it is never a static line: each string is drawn in from the striker's end and twangs as it
pulls taut, a riding note drags a shiver behind it, a chord landing makes all five thrum, and the bass wave pushes a
ripple down them as its front crosses.

## What it does

An Epic has three looks; the shared four damage tiers map onto them the way Storm Call maps them (I small, II and III
medium, IV and every knockout big). Flat 2D, no hit-stop, the blow lands once.

- **Small, the note** (about 1.4 s from the first string): the staff strings itself across (five lines, one after
  another), the hero plucks, and ONE big glossy note rides the middle line to the struck portrait, the line shivering
  behind it. It bursts on the portrait in a ring of small notes. That arrival is the blow.
- **Medium, the chord** (about 1.7 s): the staff strings out and THREE notes, one colour each, stacked on the first,
  third and fifth lines, travel together and land at once: a brighter burst, a second ring, and the whole staff thrums.
- **Big, the drop** (about 2.3 s): the staff strings out while a SPEAKER STACK (two cabinets and an amp head) falls in
  beside the striker and lands with a thud, each piece hopping a little later than the one under it. Its cones pump
  twice (the count-in: every pump pops three small notes onto the staff), and on the next beat the BASS WAVE rolls out:
  three wide arc bands from the speakers to the struck hero. As the front crosses, the staff ripples and the waiting
  notes are swept away downwind. The front reaching the portrait is the blow: the portrait is shoved downwind and skewed
  (its top leans the way the wave travels, like hair in a dryer), is held there while the rest of the wave passes, then
  springs upright.

Reduced motion: no staff, speakers, shake or zoom; the numbers fade and the blow lands.

## How

- `heroChordConfig.ts`: the tuned values, the pure plan (`chordPlan`, `chordCues`), the pure geometry (`chordGeometry`)
  and the pure camera. Big's count-in is one `beatMs`: thud, pump, pump, drop.
- **Where the speakers go.** Both heroes sit in corners, so "straight behind the striker" is off the screen.
  `chordStackSpot` scores eight spots round the striker by how far the view would have to push the stack back in, plus
  how far round from "behind" they are, and takes the best: above you when you strike, below the foe when they do. The
  wave then leaves from the stack, and the blow's direction (shake, shove, skew) is stack to struck hero.
- `heroChordScene.ts` extends the shared `FxPool` and slots one extra layer in for the staff. The staff is ten strips
  (a glow and a string per line, 28 points each); everything that moves a string (sag, vibration, a rider's shiver, the
  wave's ripple) is ONE sideways offset per point, rewritten in place each frame. The stack is seven pooled sprites laid
  out from its foot each frame. The wave is pooled crescents whose anchor is the centre of the circle they are a slice
  of, so scaling one grows the arc outward from the speakers.
- **No filter anywhere.** The brief allowed a displacement filter only if measured; the bend is faked instead, as the
  default asked: the staff ripple, the swept notes and the portrait's skew.
- **The struck portrait** moves by one `transform` string (translate, `skewX`, scale) written from the clock through
  the shared `PortraitMover`, which saves the wrapper's own transform at the start and restores it on every exit.
- `heroChordTextures.ts`: painted once per session on 2D canvases: the two line strips, an eighth note and a beamed
  pair (white with an ink outline and a gloss spot, so a tint colours them), a cabinet, an amp head, a cone, and the
  wave crescent.
- Scatter (which line a waiting note sits on, how the ring of notes is thrown) is seeded from the fight's `rollSeed`
  folded with the blow. Nothing uses `Math.random`.

## Sound

Three clips generated with ElevenLabs (3 calls, no retries), then trimmed, faded, folded to mono 44.1 kHz at 128 kb/s
and levelled with ffmpeg. I cannot hear them; the notes below are measured (envelope and a coarse spectrum).

| clip | length | measured | used for |
| --- | --- | --- | --- |
| `fx/chord-pluck` | 0.62 s | onset at 0 ms, decays over about 0.5 s, -20.5 LUFS, peak -6.5 dB; strongest near 80 Hz with harmonics to 1.3 kHz | Small's note; and, quiet and pitched up a pentatonic scale, the five strings as the staff strings itself |
| `fx/chord-strum` | 1.00 s | soft first 25 ms (skipped on play), sustains to about 0.6 s then falls, -20.5 LUFS, peak -9 dB; 110 and 220 Hz (an A power chord) | Medium's chord; under Big's drop |
| `fx/chord-bass` | 1.20 s | onset at 0 ms, 60 to 80 Hz, -24 LUFS, peak -11 dB | Big's bass wave; a 190 ms slice pitched up 1.6x for the two count-in thumps |

The raw bass came back as a flat 1.6 s drone, so it was shaped into a thump with a cubic fade from 90 ms (and a 900 Hz
low-pass); it reads low on LUFS because the meter discounts sub bass. Reused: `fx/heavy-rock-impact` (the stack
landing, and under Big's impact) and `flurryhit` (the impact). Total new audio: 2.82 s.

## Verified

- `heroChord.test.ts` rewritten (38 tests): the tier mapping; the plan and cue order per look; the geometry in both
  directions (the staff ends inside the struck face, the stack lands wholly inside the view and beside the striker); the
  camera; the runner (the blow lands exactly once per look, a knockout plays Big, finish / cancel / the safety timer /
  reduced motion, and every exit puts both portraits' transform, opacity, filter and class back, including a cancel in
  the middle of the skew); and the headless scene (strips under the batch limit, rewritten in place, the wave bends the
  staff only at its front, the caps, drain, destroy).
- LOOKED AT in headless Chrome at 1920x1080 through the tuner's own demo handle, with the clock stepped by hand so every
  still is frame-exact: all three looks with you striking, Big and Small with the foe striking. After each run both
  portraits' inline transform and the stage's were empty and no attack DOM was left.
- Frame times, DEV build (not production), headless Chrome with a GPU, on a machine that was running fifteen other
  builders at the time; `requestAnimationFrame` deltas across the attack, three or four runs each. Idle on the same page:
  median 5.6 ms, 99th percentile 6.5, worst 6.7.
  - Big: median 5.6 to 5.9 ms, 99th percentile 16 to 46 ms, worst 41 to 96 ms.
  - Medium: median 5.6, 99th percentile 16 to 22, worst 40 to 95. Small: median 5.6, 99th percentile 12 to 22, worst 40 to 63.
  - **This does NOT meet the 6.25 ms bar in this measurement.** The slow frames sit in the same two places for every
    look: 60 to 130 ms after the first string, and the 300 ms after the impact. Storm Call (a shipped Epic), measured the
    same way in the same session, shows the same two clusters with the same sizes (worst 38 to 100 ms at about 100 ms in;
    12 to 100 ms round its impact), so they look like the shared opening and impact (the stage being promoted for the
    camera, the dim, the hit number) in a dev build rather than this style. Between those, Big's count-in and wave ran
    at 6 to 7 ms on the cleaner runs and showed scattered 10 to 40 ms frames on the others; Storm Call's middle was
    cleaner (mostly 6 to 12). Not profiled further, and not measured on a production build or a quiet machine.

## Not done, or weak

- No cosmetic, no patch note, no Collection card: the style is dev-only until the coordinator wires one.
- The sounds are unheard. Levels and cue times come from measurements; the mix (especially how the pitched-up string
  plucks and the chord sit together) needs an ear.
- When the foe strikes, the stack lands over the top of the lobby rail for about two seconds, and falls past the foe's
  portrait on its way in. It reads, but it is the less tidy direction.
- The wave's "bend" is the staff ripple, the swept notes and the portrait skew only. Cards and the board do not flinch.
- The Collection sandbox (`space: 'local'`) was not looked at; only the unit tests exercise a mounted host.
- Phones were not checked.
