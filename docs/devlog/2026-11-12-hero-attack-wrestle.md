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
