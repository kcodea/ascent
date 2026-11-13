# Hero attack: Fourth Wall (`glass`, Ancient, dev-only)

Built on the `npm run attack:new` scaffold (copied from `bullettime`); nothing of the Timebreak look remains. The style
still has no cosmetic: it plays only through the dev "Attack style" override and its tuner (Dev menu, "Hero Attack:
Fourth Wall (Ancient)").

## The idea

The screen itself is a pane of glass between the player and the game, and the blow breaks it. The cracks are drawn on
the screen surface, over the board, the rail and the portraits alike; in the top look the whole view shatters into shards
that jump at the viewer and fall away, and the game is simply there behind them. No other attack treats the screen as
an object.

## Second pass (same day, after the owner played the first)

Owner: "add more ways of cracking the glass so it's not throwing a rock every time. get creative"; on the batch, "they
need sound effects" and "the 'huge' animations need some more umph ... they are quick and not impactful".

### Seven causes, rolled per fight

The pebble and the rock are gone (their texture and the punch on IV with them: no drawn object is left in this attack).
WHAT cracks the glass is rolled from the stable roll seed (`causeOf(rollSeed)`, the way Soccer rolls its corner), so a
replay rolls the same. The tuner's **Variation** row forces one; left on Random, each press of a Play button plays the
next cause in turn. Each cause is light, force or portrait motion, and each draws its own crack shape:

| cause | what you see | its crack shape | its sound |
| --- | --- | --- | --- |
| `butt`, the headbutt | the striker's own PORTRAIT launches across the board (raised over the target with Classic's duel z-order class), swells, flattens against the glass for a beat and bounces home | a tight impact star: ten spokes, close rings, a crushed heart | a whoosh, then a body on plate glass over a low thud |
| `knock` | tap, tap, KNOCK: a ripple on the glass and a jab of the striker at each; a knuckle pit per knock | a bullseye of broken concentric rings with short ties | three knuckle knocks, the third lower and louder over a thud |
| `hum`, resonance | standing rings shimmer over the target (their pulses quicken), the struck portrait shivers; it gives way all at once | a sunburst of fine straight needles, no rings | a glass harmonic that rises into the break (two voices a fifth apart) |
| `creep`, pressure | no impact: one crack is born on a screen EDGE (the nearest that still leaves it a run of about 420 px) and creeps to the portrait a jerk at a time, forking, then blooms | a long edge-born fracture tree | a low groan under it, an ice-like creak and ping per jerk |
| `shock`, the shockwave | the striker hops and stamps; a ring of force rolls out, timed to cross the target exactly on the crack | a frosted craze (a net of short cracks) in a haze | a stamp, a rising rush, a dry crackle and a dull pop |
| `beam` | a pinpoint of light from the striker heats a spot that swells from orange to white and spits, then the glass pops and leaves an ember | a few long wandering thermal cracks | a thin rising whine, sizzle ticks, a thermal pop |
| `ricochet` | one bolt of light with a tail bounces off the inside of two or three screen edges (a chip at each) and hits home | a skid star thrown forward along the last leg | a whoosh, a rising tick per bounce, a hard tick over a thud |

Every cause scales over the looks (`lvl` 1 to 3 in `heroGlassConfig.ts`): a small mark, a spreading one, a large one. A
test checks that no two causes draw the same glass and pins each shape's signature (spokes from one point, mostly
ring pieces, all-radial needles, a path that starts on a screen edge, short pieces with no spokes, and so on).

### The four looks now (shared thresholds; a knockout plays IV)

| look | what happens | blow lands | length after the formation |
| --- | --- | --- | --- |
| I, the chip | the cause's small mark; it heals after a beat with a faint shimmer | the first crack | 1.4 to 1.7 s |
| II, the web | the mark spreads in creaking jumps to a portrait and a half, then heals | the first crack | 1.7 to 2.0 s |
| III, the pane | the mark grows to three portrait radii; the pane round the portrait (eight shards) cracks through, breaks out and falls; a dark hole stays 560 ms; it repairs | the first crack | 2.0 to 2.3 s |
| IV, the shatter | the cause cracks the glass (a mark, not the blow); ONE BOLD FRACTURE tears from it across the whole screen, both ways through both portraits, with two bright heads and a flash at each of up to eight forks; a 900 ms held beat (the rest of the web creaks out, the glass trembles harder and harder, a cold light and a whine rise); then the whole screen shatters | the shatter | 4.2 to 4.5 s (was about 2.4 s; Soccer IV 3.3 s, Frost IV 3.1 s, measured the same way) |

IV's weight, piece by piece: the tear is its own texture (an open dark gap between two bright lips, about three times a
crack's weight) and its forks are heavy too; the shatter is a 0.62 white-blue flash, a longer and harder shake with a
slow heave under it, shards that JUMP AT THE VIEWER (each swells by up to about 60 % and spreads from the middle of the
screen in the first tenth of a second, held there by the slow-mo dip), then tumble, glint and fall; sixty splinters
from all over the pane; and seventy motes of glass dust that keep twinkling down for about a second and a half after
the camera, the dim and the portraits are back. The struck portrait reels (a slow rock) instead of one knock.

### The Knockout variant

The first pass coded it but nothing could play it. It is still NOT in `KNOCKOUT_VARIANT_STYLES`, and cannot be yet:
that set's shared test requires every style in it to be an Ancient COSMETIC in the catalog (`attackRarityOf`), and
`glass` has no cosmetic (and `packages/progression` is not this branch's to touch). What changed: the tuner now has the
**Knockout (40)** and **Foe knockout (40)** buttons (`knockoutHint`), which play the variant directly, so it has been
looked at (sheet `t4ko-shock.jpg`). When the coordinator adds the cosmetic, registering is one word in that set.

### The glass no longer rides the camera

Found: the shared above-portrait canvas sits inside `#stage`, so the DOM camera zooms and shakes everything drawn on it,
and the shared camera test requires the scene's ROOT to follow the camera (so effects stay on the portraits). Fixed
without touching either: every LAYER inside the root gets the camera's exact inverse each frame
(`HeroGlassScene.fixGlass`, fed the same numbers `StageCamera.apply` writes), so cracks, shards and their sparks stay
nailed to the screen while the game moves behind them. The few things that belong to the world (the beam's start, the
bolt's first leg, the stamp's ring) are mapped through `toGlass`. A test walks all of IV with the canvas inside and
outside the camera and checks a point on the glass never moves more than the tremble. Checked at stage scale 1 only.

## How (unchanged from the first pass unless said)

- **IV's geometry is one thing.** `screenWeb` is a fan of jittered spokes and rings round the struck portrait whose
  cells are the shards, so the screen breaks where it cracked; it picks its counts so 40 to 70 shards tile the screen.
- **Cracks** are one stretched sprite per piece, made hidden during the damage formation and grown by scaling. A
  finished web costs nothing per frame. At most 560 pieces (the busiest blow measured draws 314).
- **Shards** are a few sixteen-shard meshes (96 vertices, so they batch); positions are a closed form of the time since
  the break, written into the vertex arrays in place.
- **The causes' lights** (beam, hot spot, bolt, tear heads, tension wash) are pooled sprites moved per frame.
- **No slow motion except IV's dip** on the shatter (0.26x easing back over 460 ms of attack time), through the frame
  source: a smooth ramp that never reaches 0.

## Sound

First pass: five clips (5 ElevenLabs calls). Second pass: five more (5 calls that produced audio, plus one refused for
concurrency), trimmed, faded, levelled toward -20 LUFS under a -1 dB ceiling, mono 44.1 kHz 128 kb/s.

| clip | kept | used for |
| --- | --- | --- |
| `glass-tick` 0.34 s | first pass | every first crack, a bounce, a fork of the tear, the creeping crack's ping |
| `glass-creak` 1.49 s | first pass | each creak jump (a 230 ms window), the creep's groan (half speed), IV's held groan |
| `glass-race` 0.63 s | first pass | IV's tear |
| `glass-pane` 1.20 s | first pass | III's pane; the hum giving way |
| `glass-shatter` 2.59 s | first pass | a second layer under IV's crash |
| `glass-body` 0.94 s | new | the headbutt; pitched down, the boom under IV's shatter |
| `glass-knock` 0.44 s | new | the three knocks |
| `glass-sing` 0.89 s | new | the hum's rising tone; the beam's whine; the harmonic climbing through IV's held beat |
| `glass-pop` 0.55 s | new | the beam's pop; quieter under the shockwave and the creep's bloom |
| `glass-crash` 3.34 s | new | IV's shatter: a plate-glass crash whose own tail is the long tinkle |

New clips total 6.2 s (12.4 s with the first pass's). `phoneAudioQuality.test.ts` passes. Reused shared clips: the
swish (lunge, bolt, the ring of force, the tear), `fx/universfield-ground-impact-352053` (weight under every hard
crack, the stamp, the pane and the shatter), `equipmentsheen` (III's repair, and now a faint shimmer as I and II heal).

**Levels are measured, not heard.** The tuner demo was played with sound in headless Chrome, the audio output tapped
and sliced into 100 ms RMS windows, taking the attack's own sound from 300 ms after the charge:

| | mean | loudest window |
| --- | --- | --- |
| Fourth Wall IV, first pass | about -38 dB | -31 dB (the shatter) |
| Fourth Wall IV, now (seven causes) | -29.6 to -30.5 dB | -22.3 to -23.0 dB (the shatter) |
| Soccer IV (reference) | -32.0 dB | -25.6 dB |
| Frost IV (reference) | -32.0 dB | -24.5 dB |
| Fourth Wall II, now | -33.7 to -37 dB | -24 to -27 dB |
| Storm III (an Epic, reference) | -38.3 dB | -28.8 dB |

So it now sits about 2 dB above the two references. IV has no stretch of action in silence. I to III go quiet (under
-45 dB) for the 400 to 700 ms the finished mark simply sits before it heals; the heal has a faint shimmer.

## Verified (second pass)

- `npx vitest run packages/ui/src/heroGlass packages/ui/src/heroAttack packages/ui/src/audio`: 899 tests pass (36 are
  this style's).
- `npm run typecheck` exit 0; `npm run lint` 0 errors (149 warnings, none in this style's files).
- Looked at it: headless Chrome at 1920 x 1080, the tuner's demo on a manual clock, the live backend blocked. Contact
  sheets of every look in every cause, IV in both directions in every cause, the Knockout variant, and close crops of
  each cause's mark. See the list in the scratchpad folder `attacks/glass/sheets2/`.

## Not done, weak or unverified

- **The 6.25 ms bar is not proven.** Measured on the DEV build (`vite`, not production) in headless Chrome with vsync
  and the frame cap off, on a machine other builds were sharing. rAF deltas over IV from the charge to the end of the
  drain, eleven runs across the causes and both directions: p50 1.4 to 1.7 ms, p95 3.4 to 5.6 ms, p99 6.7 to 10.5 ms,
  worst 17 to 48 ms; 41 to 121 of about 3,200 frames over 6.25 ms (the shockwave and the ricochet the most). The idle
  shop in the same session: p99 3.4 ms, worst 5.4 ms. This attack's own frame callback (the sequence step, the paint
  and the scene update): p99 0.2 to 0.3 ms, worst 1.3 ms, with one 10.7 ms frame on the very first play; building the
  scene during the formation costs 9 to 14 ms inside the demo call. So the slow frames are in drawing (full-screen
  blended quads: the flash, the tension light, the offset tints, the ring of force), not in script. The first pass
  measured the same way: p99 4.0 to 11.8 ms, worst 16 to 45 ms. It needs a run on the production bench build.
- The shards are tinted glass; they do not carry the real picture.
- The struck portrait sits in a screen corner in real fights, so most of a mark and one arm of IV's tear run off the
  screen; the damage number also covers the heart of the mark for its first half second.
- The headbutt moves the whole portrait element, so its dark socket shows where it was until it comes home.
- Not registered for real knockouts (above). The Collection preview (`space: 'local'`) was not looked at. Reduced motion
  plays only the shared fades. A scaled stage (a small window, a phone) was not looked at.
- IV is now about a second longer than Soccer IV and Frost IV; `t4HoldMs` and `t4SettleMs` are the dials if it drags.
