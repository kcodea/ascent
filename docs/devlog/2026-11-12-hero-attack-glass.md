# Hero attack: Fourth Wall (`glass`, Ancient, dev-only)

Built on the `npm run attack:new` scaffold (copied from `bullettime`); nothing of the Timebreak look remains (no blades,
no clock, no slow-motion crawl). The style still has no cosmetic: it plays only through the dev "Attack style" override
and its tuner (Dev menu, "Hero Attack: Fourth Wall (Ancient)").

## The idea

The screen itself is a pane of glass between the player and the game, and the blow breaks it. The cracks are drawn on
the screen surface, over the board, the rail and the portraits alike; in the top look the whole view shatters into shards
that fall away and the game is simply there behind them. No other attack treats the screen as an object.

## The four looks (shared thresholds; a knockout plays IV)

| look | what happens | blow lands | length after the formation |
| --- | --- | --- | --- |
| I, the chip | a pebble flicked from the striker taps the glass over the struck portrait: a star-shaped chip, three short cracks, a glint; it heals after a beat | the tap | about 1.3 s |
| II, the web | two pebbles 170 ms apart; the first is a tick (a chip, its first cracks), the second is the blow; both webs spread in creaking jumps and join into a spider web the size of the portrait, then heal | the second tap | about 1.7 s |
| III, the pane | a rock; the web grows to about three portrait radii in jumps, then the pane round the portrait (eight shards) breaks out, tips forward and falls off the bottom; a dark hole stays 560 ms; the pane repairs in a shimmer and the cracks fade | the rock | about 1.8 s |
| IV, the shatter | the striker winds up and punches the glass (it swells at the screen); one crack races from it through the struck portrait and out to both screen edges, branching; a held beat where the rest of the web creaks out and the picture sits a hair apart across the crack; then the whole screen shatters into 40 to 70 shards that burst a little, tumble, flash and fall under gravity over a white-blue flash | the shatter | about 2.1 s plus a slow-mo dip (about 0.3 s) |

A Knockout variant is wired in the plan and the scene (the Ancient prism through the break, a bigger shake, a deeper dip,
the KO sting) but `glass` is NOT in `KNOCKOUT_VARIANT_STYLES` (a shared file), so no caller asks for it yet.

## How

- **One geometry.** `buildWeb` makes a fan of jittered spokes and rings round the impact point from the blow's seed
  (`glassSeed`: the total, the distance, the side and `rollSeed`). The spokes, rings and diagonals are the crack lines
  and the same cells are the shards, so the screen breaks exactly where it cracked. IV's web (`screenWeb`) points
  spoke 0 at the striker (the main crack runs through both portraits), reaches past the farthest corner, and picks its
  spoke and ring counts so the shards on screen number 40 to 70. A test samples the whole screen for gaps.
- **Cracks** are one stretched sprite per crack piece (a bright thread over a dark line), made hidden during the damage
  formation and grown from their near end by scaling along their length. Nothing is repainted; a finished web costs
  nothing per frame. Capped at 420 pieces.
- **Shards** are a few small meshes of sixteen shards each (96 vertices, so they batch with the sprites and need no
  shader of their own). A shard is its triangle plus an inset copy: the band between is its bright cut rim, the middle
  its pale see-through face, both read from one small lookup texture; sliding the lookup's v makes a shard flash as it
  turns face-on. Positions are a closed form of the time since the break (burst, gravity, spin, an edge-on flip, a slow
  swell or shrink for depth), written into the vertex arrays in place. The shards do not carry the real picture.
- **The offset across the main crack** is two faint tints either side of it that slip a notch with each creak.
- **Layering.** The scene mounts on the shared above-portrait overlay (`canvas.pixifx-above`: fixed, full screen,
  z-index 200, inside `#stage`). It therefore rides the stage camera like every attack's FX, which is what the shared
  camera test requires. Anything the game puts above z 200 (modals, dev panels) still draws over the glass.
- **No slow motion except IV's dip** on the shatter, through the frame source (the Knockout technique): a smooth ramp
  that never reaches 0.
- Textures are painted once per session on 2D canvases (`heroGlassTextures.ts`): the crack line, the chip, the pebble,
  the shard lookup, a splinter, a glint, a wash. Glows, rings, stars and sparks are the shared Arcana set.

## Sound

Five clips generated with ElevenLabs (5 calls, no retries), trimmed, faded, levelled toward -20 LUFS under a -1 dB peak
ceiling and encoded mono 44.1 kHz 128 kb/s into `packages/ui/src/audio/fx/`. I cannot hear them: the cue points below
come from ffmpeg envelopes, and the levels are untested by ear.

| clip | kept | measured | used for |
| --- | --- | --- | --- |
| `glass-tick` | 0.34 s | onset 20 ms, peak 40 ms, peak -3.9 dBFS | every tap (lower for III's rock and IV's punch) |
| `glass-creak` | 1.49 s | sparse crackles near 160, 320, 600, 760 ms; -29 LUFS (peak-limited) | each creak jump plays a 230 ms window starting just before one of those crackles |
| `glass-race` | 0.63 s | swells to its peak 300 ms in; -24 LUFS (peak-limited) | IV's racing crack (rate follows the race length) |
| `glass-pane` | 1.20 s | immediate; -22 LUFS | III's pane breaking out |
| `glass-shatter` | 2.59 s | immediate, a full crash for about 1.2 s then the fall; -20.6 LUFS | IV's shatter |

Total 6.25 s. Reused: the swish for the flick, `fx/universfield-ground-impact-352053` for weight under III's rock, IV's
punch and the shatter, `equipmentsheen` (quiet, pitched up) for III's repair. `ATTACK_FX_CLIPS.glass` updated.

## Verified

- `npx vitest run packages/ui/src/heroGlass packages/ui/src/heroAttack packages/ui/src/audio`: the 28 glass tests and
  the shared sweeps pass. The same filter also matches `packages/ui/src/audioWarm.test.ts`, whose `beforeAll` hook timed
  out at 10 s once on the loaded build machine and passed when re-run alone.
- `npm run typecheck` exit 0; `npm run lint` 0 errors (149 warnings, none in this style's files).
- Looked at it: headless Chrome at 1920 x 1080 against a private dev server, the tuner's demo on a manual clock,
  contact sheets for I to IV with you striking and IV and III with the foe striking, plus full-size stills.
- Perf, DEV build (`vite`, not production), headless Chrome with vsync and the frame cap off, while fifteen other builds
  shared the machine. rAF deltas over IV, from the charge to the end of the drain: p50 0.8 to 1.0 ms, p95 2.3 to 4.2 ms,
  p99 4.0 to 11.8 ms, worst 16 to 45 ms. The idle shop in the same sessions: p99 2.7 to 7.4 ms, worst 12.8 to 21.4 ms.
  The shipped source attack (`bullettime` IV) in the same session: p99 6.1 to 7.1 ms, worst 21 to 26 ms. The slow frames
  were scattered and did not sit on the shatter; one recurs at the end of every attack (the shared teardown). The cost of
  this attack's own frame callback (the sequence step, the paint and the scene update, including the scene's teardown):
  p99 0.3 ms, worst 3.0 ms (on the shatter); building the scene during the formation: 6 to 8 ms inside the demo call.

## Not done, weak or unverified

- **The 6.25 ms bar is not proven.** On this machine and build the noise floor was above it even at idle. It needs a
  run on the production bench build on a quiet machine.
- The shards are tinted glass. Capturing the game view into a texture so they carry the real picture was not attempted.
- The glass rides the stage camera (it zooms and shakes with the game) rather than staying fixed on the screen.
- The Knockout variant is not registered (see above), so its look was never played in the browser, only in tests.
- The Collection preview (`space: 'local'`) was not looked at; there the "screen" is the box round the two portraits.
- Reduced motion plays only the shared fades (no glass at all).
- I, the chip, is deliberately small; whether it reads at combat speed on a phone-sized stage was not checked.
- The capture runs were not blocked from the network: the page logged a 429 from a remote host on each run, so they
  most likely reached the live backend (the capture scripts now abort those requests).
