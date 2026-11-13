# 2026-11-12: Power Chord, a hero attack you can see the sound of (style `chord`, Epic, dev-only)

One of sixteen attack styles scaffolded on `feat/hero-attacks-16` (`npm run attack:new`, see
`2026-11-11-attack-scaffold.md`) and built in parallel. This one was scaffolded from Storm Call and rebuilt from the
config up; nothing of Storm Call's look is left. It has NO cosmetic yet, so it plays only through the dev "Attack
style" override and its tuner (Dev menu, "Hero Attack: Power Chord (Epic)").

## The signature

VISIBLE SOUND. A five-line musical STAFF is strung between the two heroes like plucked strings, music notes ride it,
and on the top look the striking hero itself becomes the speaker and blows a bass wave down it. No other attack draws a
staff, a note or a sound wave. (The first pass drew a stack of speaker cabinets for the top look; the second pass cut
it. See "Second pass" at the end: the "What it does", "How" and "Sound" sections below describe the attack as it is
NOW.)

The staff is the stage and it is never a static line: each string is drawn in from the striker's end and twangs as it
pulls taut, a riding note drags a shiver behind it, a chord landing makes all five thrum, and the bass wave pushes a
ripple down them as its front crosses.

## What it does

An Epic has three looks; the shared four damage tiers map onto them the way Storm Call maps them (I small, II and III
medium, IV and every knockout big). Flat 2D, no hit-stop, the blow lands once.

- **Small, the note** (about 1.4 s from the first string): the staff strings itself across (five glowing strings, one
  after another), the hero plucks, and ONE big glowing note rides the middle line to the struck portrait, the line
  shivering behind it. It bursts on the portrait in a ring of small notes. That arrival is the blow.
- **Medium, the chord** (about 1.7 s): the staff strings out and THREE notes, one colour each, stacked on the first,
  third and fifth lines, travel together and land at once: a brighter burst, a second ring, and the whole staff thrums.
- **Big, the drop** (about 3.1 s): the staff strings out while the striking portrait POWERS UP as a speaker: three rings
  of light settle round it. It pumps three times, a beat apart and harder each time (the portrait swells, rings punch
  out of it, three small notes pop onto the staff, the view thumps down). Then the INHALE: the rings pull in tight, the
  view lets go of its push, nothing new sounds. Then THE DROP: a train of three thick wave fronts rolls out of the
  portrait, 250 ms apart, each a bright crescent with a coloured twin behind it, dragging streaks of air. As the first
  front crosses, the staff kinks hard and the waiting notes are swept away. That front reaching the struck portrait is
  the blow: a flash across the view, a slow heavy shake, the portrait shoved 58 px downwind and skewed 26 degrees (its
  top leans the way the wave travels, like hair in a dryer). It stays pinned there, fluttering, while the second and
  third fronts batter it again, then springs upright.

Reduced motion: no staff, speakers, shake or zoom; the numbers fade and the blow lands.

## How

- `heroChordConfig.ts`: the tuned values, the pure plan (`chordPlan`, `chordCues`), the pure geometry (`chordGeometry`)
  and the pure camera. Big's count-in is one `beatMs`: thud, pump, pump, drop.
- **The speaker is the striking portrait.** No spot to pick and nothing to draw: the rings sit on the portrait's own
  centre and radius, the wave leaves from its centre, and the blow's direction (shake, shove, skew) is striker to struck
  hero. The portrait itself moves (transform only): it swells on each pump, draws in through the inhale and kicks back
  on the drop and on each later front.
- `heroChordScene.ts` extends the shared `FxPool` and slots one extra layer in for the staff. The staff is eleven strips
  (one soft dark band under the whole staff, then a glow and a string per line, 28 points each; the strings and glows are
  ADDITIVE, so a string is light and not a drawn line); everything that moves a string (sag, vibration, a rider's
  shiver, the wave's ripple) is ONE sideways offset per point, rewritten in place each frame. The first wave front is
  pooled crescents whose anchor is the centre of the circle they are a slice of, so scaling one grows the arc outward
  from the speaker; the later fronts are fire-and-forget crescents on the same trick.
- **No filter anywhere.** The brief allowed a displacement filter only if measured; the bend is faked instead, as the
  default asked: the staff ripple, the swept notes and the portrait's skew.
- **The struck portrait** moves by one `transform` string (translate, `skewX`, scale) written from the clock through
  the shared `PortraitMover`, which saves the wrapper's own transform at the start and restores it on every exit.
- `heroChordTextures.ts`: painted once per session on 2D canvases: the two line strips (a soft bell and a white-hot
  core), an eighth note and a beamed pair (white with an ink outline and a gloss spot, so a tint colours them; each note
  on the staff also carries a halo, and a riding note an additive copy of itself, so it glows), and the thick wave
  crescent. The cabinet, amp head and cone textures are gone.
- Scatter (which line a waiting note sits on, how the ring of notes is thrown) is seeded from the fight's `rollSeed`
  folded with the blow. Nothing uses `Math.random`.

## Sound

Rebuilt in the second pass from measurements. Five clips of its own (5.84 s), four more ElevenLabs calls (seven in all
across both passes). Each was trimmed, faded, folded to mono 44.1 kHz at 128 kb/s and peak-normalised with ffmpeg. I
cannot hear them; everything below is measured (envelope, three frequency bands, zero-crossing pitch).

| clip | length | measured | used for |
| --- | --- | --- | --- |
| `fx/chord-pluck` | 0.62 s | the first pass's pluck, re-levelled 5 dB up; a clear 525 Hz note decaying over half a second | Small's note; the five strings as the staff strings itself (walking up a pentatonic scale); a low string under each pump |
| `fx/chord-strum` | 1.80 s | REPLACED. A distorted power chord: level for 1.4 s (mid band -9 dB, plenty above 2 kHz), then it rings off | Medium's chord (the first 1.1 s); Big's drop, with its whole sustain |
| `fx/chord-bass` | 1.90 s | REPLACED (regenerated, as asked). A real DROP: the pitch falls from about 110 Hz to 30 Hz. It came back at full level throughout, so it is given a decay from 400 ms, and the same take an octave up is mixed under it so small speakers carry it | Big's drop |
| `fx/chord-kick` | 0.32 s | NEW. A kick drum, 60 to 70 Hz with its octave | every pump of the count-in (louder each time), each later front, and soft under every landing |
| `fx/chord-feedback` | 1.20 s | NEW. Amp feedback: a 2.3 kHz howl with vibrato, swelled in over a second. Played low (0.28) and at 0.75x | Big: it swells through the count-in and peaks exactly on the drop |

Reused: `fx/heavy-rock-impact` (under Big's impact), `fx/whoosh-03` (the air each front pushes) and `flurryhit`.

Measured in play (the attack played with sound in headless Chrome, the output tapped and cut into 100 ms windows, RMS
in dBFS; "own" is from the attack's first beat to 400 ms after its end, so the shared damage formation is left out):

| | own RMS | loudest own window |
| --- | --- | --- |
| Big, first pass | -27.8 dB | -23.4 |
| Big, now | -20.3 dB | -14.0 (the drop holds -14 to -19 for about 900 ms) |
| Medium, first pass / now | -31.4 / -24.9 dB | -30.5 / -20.0 |
| Small, first pass / now | -30.3 / -27.2 dB | -27.7 / -20.3 |
| Storm Call IV (the shipped Epic) | -22.6 dB | -17.9 |
| Soccer IV / Frost IV | -28.3 / -27.7 dB | -22.8 / -21.6 |

Big, beat by beat: the strings -23 to -28; the three kicks -21, -19 and the drop; the inhale dips to -31 and -35 on
purpose; then the drop. The only stretch of Big under -30 dB is that 200 ms inhale. The shared formation's loudest
window is about -14 dB, so the drop is as loud as the loudest thing already in the game; if that is too much, the dials
are `sfxBassGain` and `sfxStrumGain`.

## Verified

- (First pass.) `heroChord.test.ts` rewritten (38 tests): the tier mapping; the plan and cue order per look; the geometry in both
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
- The sounds are unheard. Levels and cue times come from measurements; the mix needs an ear.
- The wave's "bend" is the staff ripple, the swept notes and the portrait skew only. Cards and the board do not flinch.
- The Collection sandbox (`space: 'local'`) was not looked at; only the unit tests exercise a mounted host.
- Phones were not checked.

## Second pass (2026-11-12): sound, weight, and no drawn speaker

The owner played the batch: the attacks "need sound effects", the big looks are "quick and not impactful", and drawn
objects that look like clip art are out of place. For this attack that meant three things.

**The speaker stack is gone.** I chose to replace it, not keep it: the look does not fall apart without it. The
striking portrait pulsing with rings punching out of it reads as a speaker at once, it needs no spot on a crowded
screen (the stack used to land over the lobby rail when the foe struck), and it puts the hero at the centre of its own
attack. About 140 lines of painted cabinet, amp and cone, and the spot-picking code, were deleted.

**The staff and the notes are light now.** The strings were 6.5 px ink-edged lines with a faint glow, gold on a tan
board. They are now 9 px additive white-hot cores with a 5x glow, 24 px apart (was 18), over one soft dark band, and
the board dims further (0.22 / 0.34 / 0.56, was 0.14 / 0.26 / 0.42). Notes are about 12 percent bigger, the waiting
notes each carry a halo, and a riding note carries an additive copy of itself.

**The bass wave is the heavy moment.** One front of three thin arcs became a train of three thick fronts (a repainted
crescent about twice as thick, a coloured twin behind each, streaks of air along the lead front). The staff bend went
from 26 to 64 px, the portrait's shove from 26 to 58 px and its lean from 18 to 26 degrees, held 560 ms (was 150) with a
flutter and two more hits. The camera: shake 30 px (was 17), slower and longer, a thump on every pump, a recoil on the
drop, a thump on each later front, and a flash across the view on the blow.

**Running time of Big:** 2307 ms before, 3092 ms now (Soccer IV 3308, Frost IV 3083). The extra time is anticipation
(a third pump and the inhale: the wave leaves at 1310, was 1075) and aftermath (the portrait pinned while two more
fronts pass; the end is 1380 ms after the blow, was 900). The blow lands once, at 1710 (was 1405). No hit-stop.

**Sound:** see "Sound" above (rewritten).

### Verified (second pass)

- `npx vitest run packages/ui/src/heroChord packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 896 tests, all passing (38 tests in
  `heroChord.test.ts`: the count-in, the inhale and the wave train in the plan and the cue order, the new running time,
  the speaker geometry, the camera's thumps, recoil and echo kicks, the runner end to end with the portrait swelling
  and the struck portrait pinned through both later fronts, the strings additive over the dark band, the caps).
  `npm run typecheck` clean. `npm run lint` 0 errors, no warning in these files.
- Looked at in headless Chrome at 1920 x 1080 (real-time screencast, sound off): Big in both directions, Medium in both,
  Small. After every run both portraits and the stage had no transform left.
- Frame times, DEV build, headless Chrome, vsync off, no capture, on a machine other builders were using (its idle
  median was about 2 ms at the time). Big, three runs: median 1.8 to 2.1 ms, 99th percentile 7.7 to 8.9 ms, worst 19 to
  36 ms. The worst frames are on the shared opening (the first 60 ms) and the shared teardown in every run; one run had
  a 20 ms frame as the wave left. The attack's own per-frame step: 0.3 to 0.5 ms at the 99th percentile; worst 1.8 ms
  in one run and a single 7.7 ms and a single 10.7 ms frame in the other two (not reproduced, not profiled). Medium:
  99th percentile 4.8 ms, worst 18 ms (the teardown). Not measured on a production build.

### Still weak or unverified

- Unheard. In particular the feedback is a steady 2.3 kHz tone with a volume swell, not a rising pitch; it is kept low
  for that reason and may want to go.
- When you are struck (bottom left corner) the shove pushes part of your portrait off the screen for half a second.
- At the moment of the blow the lower left of the screen is close to white when the foe strikes (three bands and the
  flash overlap there). Dials: `waveSize`, `flashAlpha`.
- The notes are still painted glyphs with an ink outline (a note has to be a note); they glow now, but they are the one
  drawn thing left.
- The Collection sandbox and phones were not looked at.
