# 2026-11-02: Golazo, the soccer hero attack (attack_soccer, Legendary)

Owner ask: "branch off and make 2 attack animations, a soccer one, and a baseball one. get creative and fun with them,
like a corner kick for soccer then a breakaway etc." This is the soccer one; the baseball one was built in parallel on
its own branch.

## The signature

A GOAL (two posts, a crossbar and a net) stands on the struck hero, and every blow ends with the ball BULGING THE NET:
the net bursts out along the shot and springs back, and the frame shakes. The striking PORTRAIT is the player (it
juggles, jogs, dribbles, leaps and flips), as the Basketball's is. No other attack has the goal, the net bulge, the
rolled corner kicks, the breakaway defenders or the upside-down slow-mo kick.

## What it does

The style `soccer`, the cosmetic `attack_soccer` ("Golazo", a placeholder name for the owner to rename; the id stays),
Legendary like the Basketball (four tiers). A referee's whistle opens every tier. Flat 2D, no hit-stop, the blow lands
once, when the ball hits the net.

- **I, the volley:** keepy-uppies where it stands (the ball bobbing off its feet, a grass puff each touch), one higher
  flick, a hop, and a crisp volley on a low line into the goal. GOAL!
- **II, the corner kick:** it jogs out to a CORNER FLAG on the struck hero's goal line (the side with more room), sets
  the ball, steps back with an arm raised, and strikes. One of three corners, rolled per fight:
  1. the **Olimpico**, an inswinger that bends all the way in, straight from the corner;
  2. an **outswinger and a header**: the cross curls to the penalty spot, the portrait sprints in and leaps to head it home;
  3. a **short corner**: rolled off the edge of the screen, the one-two comes back, and a first-time curler.
- **III, the breakaway:** it dribbles up the pitch past two DEFENDERS (tokens in the defending side's colour that lunge the
  wrong way and fall away), with one of three skills rolled per fight: **stepovers** (the portrait sways, OLE!), a
  **nutmeg** (the ball rolls straight through the defender while the portrait goes round it, NUTMEG!), or a **rainbow
  flick** over its head. Then the clock eases into slow motion (0.45x) for the last touch and the placed finish.
- **IV, the bicycle kick:** two keepy-uppies, a flick SKY HIGH (the ball grows toward the camera, its shadow marking where
  it will land), a sprint to that spot with speed lines, a crouch, a launch (a shock ring of grass and dust) and a
  backward FLIP. Upside down at the top, in deep slow motion (0.25x), the bicycle kick (a white-hot pop and fire
  streaks). The clock eases back and runs a touch fast (1.3x) as a THUNDERBOLT with a fire trail rockets into the goal:
  the net bursts out, the frame rings, an explosion, confetti, GOLAZO! and the crowd's roar. Then a knee slide and home.
  A knockout always plays IV.

The roll is `variantOf(rollSeed)`: the stable per-blow seed Recruit already passes (the run seed and the round), so a
replay rolls the same. The DEV tuner's Variation row forces one. Every point the portrait visits is clamped on screen,
the goal always sits on the struck portrait, and every shot lands on its centre. Every exit (the end, `finish()`,
`cancel()`, the safety timer, an unmount) restores the portrait's transform, opacity and z-order class exactly and
hides the ball, the shadows, the goal, the flag and the defenders.

## How

- `packages/ui/src/heroSoccer/`: `heroSoccerConfig.ts` (per-tier dials t1-t4 on the shared `configStore`, the pure plan /
  cues / geometry / keyframed portrait pose / ball path / defenders / goal + net bulge / flag / camera / slow mo),
  `heroSoccerScene.ts` (the shared `FxPool`, cap 340, plus nine own objects: the ball, its shadow, the portrait's shadow
  in the air, the net, the goal frame, the corner flag, three defenders), `heroSoccerTextures.ts` (canvas-painted once,
  the Basketball's treatment: the ball with its pentagon patches, the soft shadow, the goal frame, the net, the flag, the
  defender token, a confetti strip, the words GOAL!, GOLAZO!, NUTMEG! and OLE!), `heroSoccer.ts` (the runner on the
  shared Sequence / StageCamera / PortraitMover), `heroSoccer.test.ts` (26 tests).
- `HeroSoccerTuner.tsx` on the Rare tuner builder with four tier groups and the Variation row (buttons on top).
- Wired: the style registry, Recruit dispatch, the Collection preview, DevMenu (⚽), `tunerAll`, the cosmetic and its Edge
  mirror, the knockout / camera / formation / tuner-button lists, the crate pins (Legendary 88 -> 89 after the baseball, 9 / 89 = 0.101%
  each) and the Collection counts (24 attacks, 415 items).
- Oracle: R-PROG-ATTACK-37 (and R-PROG-ATTACK-01's crate history). GAME-RULES and the patch note updated.

## Sound

The owner's own ElevenLabs clips (2026-11-02, from `C:\Game Assets\Ascent Art\SFX\Socce4r\`), copied, trimmed to
their hit, faded, levelled to about -20 LUFS (the repo target, -1 dB peak ceiling; the kick's transient keeps it at -22.8)
and encoded like the other fx clips (mono, 44.1 kHz, 128 kb/s), in `packages/ui/src/audio/fx/`:

| clip | source | kept | hit point |
| --- | --- | --- | --- |
| `soccer-kick` | Powerful_kick_of_a_l_#2 | 0.8 s | the thump about 20 ms in |
| `soccer-net` | Soccer_ball_ripping__#3 | 1.1 s | the rip about 60 ms in |
| `soccer-whistle` | Referee_blowing_a_sh_#1 | 1.3 s | about 30 ms in |
| `soccer-crowd-ooh` | Big_stadium_crowd_go_#3 | 2.4 s | rises, peaks about 1 s in |
| `soccer-goal-roar` | Huge_football_stadiu_#3 | 2.8 s | swells over the first 0.3 to 0.7 s |
| `soccer-golazo` | Excited_Latin_Americ_#4 | 3.2 s | the voice about 80 ms in |

Cues: the whistle opens every tier; the kick on every strike and the header, pitched up for the touches; the net on every
goal; the crowd's "Ooooh" starts as the ball leaves for a long ride so its peak lands near the goal (II's corner kick,
III's first defender, IV's flick sky high); the goal roar on every goal (soft on I, fuller up the tiers); on IV the roar
and the commentator's GOLAZO! with the word. Still reused: the whoosh, the boom (`fx/universfield-ground-impact-352053`) and
the post ring (`fx/bball-rim`, pitched up). The earlier synthesised placeholders are gone.

**The phone audio budget.** Every clip named in code used to be decoded ahead on a phone, so the six clips (11.8 s,
2.27 MB) could not fit `phoneAudioQuality.test.ts`. Fixed at the root in PR #2538 (R-AUDIO-PREWARM-ATTACKS-01): phones now
decode ahead only the hero-attack styles in play, and the budget counts the shared clips plus the two largest attacks.
Soccer is now the largest (with baseball second); to keep a margin under the unchanged ceiling, IV's boom is the shared
`fx/universfield-ground-impact-352053` (always decoded, so free) instead of `fx/heavy-rock-impact`. Working set 37.42 MB
against 37.75 MB, with the owner's clips at the lengths above.

## Perf (PROD bench build, `VITE_PERF_BENCH=1` + `vite preview`, headless Chrome, 1920 x 1080, vsync and frame cap off, sound off)

A temporary, uncommitted bench hook reached the runner between the real portraits in a Practice shop. Frame times in ms.

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (first play) | 5842 | 1.1 | 1.7 | 2.8 | 22.4 | 2 | 0 |
| IV foe | 4636 | 1.4 | 2.0 | 2.6 | 11.4 | 0 | 0 |
| III stepovers / nutmeg / rainbow | 3550-3900 | 1.4-1.5 | 2.0-2.2 | 2.6-2.9 | 13.6-24.1 | 0-1 | 0 |
| II Olimpico / header / short | 3790-4020 | 1.4 | 2.1 | 2.8-3.1 | 13.7-16.5 | 0 | 0 |
| I | 2880 | 1.3 | 2.0 | 2.8 | 13.5 | 0 | 0 |
| IV you (again) | 4299 | 1.5 | 2.4 | 3.4 | 14.8 | 0 | 0 |
| IV foe (again) | 4549 | 1.5 | 2.1 | 2.9 | 12.3 | 0 | 0 |

Headless frame times are indicative only (docs/performance.md §3i); a real-display check on 5173 is still worth doing.

## Open for the owner

- The name "Golazo" is a placeholder.
- The two new clips are synthesised placeholders until the ElevenLabs key is available.
- The defenders are plain tokens in the defending side's colour (no code-drawn people); the goal, net, flag and ball are
  canvas-painted the way the Basketball's hoop is.
- Every portrait-moving attack (Basketball too) leaves the hero slot's dark backdrop showing while the portrait is away;
  that is the shared slot, not this attack.
