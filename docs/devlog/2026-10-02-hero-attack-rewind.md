# 2026-10-02: Rewind, the Ancient of Time hero attack (attack_rewind, Ancient)

Owner ask (2026-10-02): "build a new ancient animation for this ancient, the ancient of time. rewinding/stopping time
concepts could be cool, and repeating time for the final hit or something to repeat the same attack maybe?" The owner
picked the concept **REWIND & REPLAY**: each hit lands, time rewinds, and the same hit replays.

Two owner reviews on 5173 reshaped it the same day:

- First build: "the idea for rewind is okay, but it is so boring and slow paced. it's a 3.5/10". This round fixed PACE
  (fast reverse scrubs, rubber-band replays, no dead air) and SPECTACLE (time visibly breaking, every replay bigger).
- Second build: "still a 4/10 ... the attack is an ancient power, literally a god's attack. make it cooler". This round
  fixed SCALE: the god manifests over the board, and time bends the whole board, not just the projectile.

It is the first hero attack built for the **Ancient** rarity. Nothing changes for players until the owner deploys
`progression-inventory` (the catalog sync adds `attack_rewind`). The equip SQL already accepts the `hero_attack` slot,
so there is no new migration.

## What shipped

- **Cosmetic**: `attack_rewind`, "Rewind", rarity `ancient`, crate, style `rewind` (`packages/progression/src/cosmetics.ts`,
  mirrored to the Edge function by `npm run progression:shared`).
- **The runner** (`packages/ui/src/heroRewind/`), on the shared hero-attack core (one clock, the damage formation, the
  `#stage` camera applied once, finish / cancel / safety, reduced motion = fades only).

### The one idea: a strike is a story that can be played backward

Every frame reads one STORY TIME `s` from the plan (`rewindStateAt`). Forward, `s` climbs from 0 (the sand leaves the
hand) through the landing and the splash. A rewind runs `s` back down at the scrub's pace. The torrent, its ribbon
trail, the grains, the striker's snap and the struck portrait's jolt are all drawn from `s`. So a rewind is literally
the forward frames in reverse:

- the struck portrait re-jolts into the hit;
- the torrent retracts along its EXACT path;
- its trail LEADS it, as on a reversed film.

It can never read as a second throw. `rewindStateAt` + `strikePos` are pure and tested: every rewind point lies on the
forward path.

### God scale

- **The god manifests.** The Ancient of Time's own art (`art/ancients/time.webp`, the owner's reference picture) is
  decoded once per session and feathered into a bust, drawn twice:
  - NORMAL blend, so its colour survives the light board;
  - ADDITIVE, so it glows.

  A violet aura sits behind it, with gold and violet eye sprites. It rises over the ready and leaves after the impact
  (IV: snaps away in 140 ms). Its raised hand, on the far side from the target, pours the torrent across the board.
- **Its halo** (a broken bevelled clock ring with hour ticks, a tilted orbit with orbs) fills the sky round its head.
  From II its clock hands sweep the stage. The spin is integrated from `haloRateAt`: a forward drift, a hard backward
  snap through every scrub, and IV spins backward the whole time, harder every loop.
- **Time bends the whole board on every rewind:**
  - the god blazes and both eyes flare violet;
  - a gold wash covers the screen (one flat quad);
  - every card on both boards twitches backward (ONE transform per board row, found once at the start, restored on
    every exit);
  - the torrent splits into magenta and cyan RGB ghosts;
  - VHS scrub bars tear across the screen;
  - both portraits jitter like a tracking error;
  - the splash is sucked back into the hit in a spiralling sand vortex (own objects, reused).

### The tiers (ms after the damage formation, 1600 px apart; impact / end)

| tier | what plays | impact | end |
| --- | --- | --- | --- |
| I (3) | the god rises and pours one torrent onto the struck hero | 560 | 900 |
| II (8) | it lands (a tick), scrubs back into the god's hand (160 ms), and snaps in again, harder | 955 | 1335 |
| III (14) | two scrubs; each landing leaves an afterimage at the contact; on the last pour they fly just ahead of it: bam, bam, BAM | 1301 | 1741 |
| IV (40, every knockout) | a board-spanning clock face, hands spinning backward; five accelerating loops (x0.72 a loop), each freezing an echo in mid flight; the hourglass forms; the god closes its grip (its rings clamp onto the target); every echo lands at once; the whole screen shatters like glass (a 6x4 grid of panes, a white flash, shock rings, crystal-sand rain, a gong) on a slow-mo dip | 1987 | ~3040 (incl. ~410 ms of dip) |

For comparison, Bleed ends at 1470 / 1740 / 1990 / 4159, Banana at 1596 / 1838 / 2343 / 7064, and Basketball at
1695 / 2332 / 3138 / 4210. I and II sit under all three.

- **The contract**: every landing before the last (the loop landings and III's stutter) is a tick. The consequence
  lands exactly ONCE, on the last landing (IV: the shatter).
- **No freeze.** IV's dip is the Soul Stitch / Basketball technique: the frame source hands the one clock a scaled step
  (0.28x easing back over 460 ms of attack time, never 0; `rewindTimeScale`, R-PROG-ATTACK-10). No grey drain either:
  the Ancient crate reveal owns "time stops".
- **Knockout bolt-on.** `rewindPlan({ extraRewinds })` adds loops on top of the tier's. The Ancient "Knockout" remix of
  Huge (built on `feat/ancient-knockout-tier`) can add one more replay and echo before the shatter with no plumbing
  here. That is tested.

## Sound (existing clips; no rune explosion, no turnexplosion)

No ElevenLabs key was in the main checkout's `.env` files, so every cue is an existing clip, and each cue has a
clip / gain / pitch row in the tuner. To play a clip BACKWARD, `playTailedClip` and `AttackVoices.cue` / `riser` gained a
`reverse` option. It uses the cached reversed buffer `playFxSound` already had.

| cue | clip |
| --- | --- |
| tick (ready, back in the hand, reversed stutter of three per rewind) | `thymepiece` |
| throw | `fx/djartmusic-christmas-sparkle-whoosh-1-275404` |
| replay snap (rubber band) | `fx/universfield-whip-snap-242215` |
| hit / thud / chime | `fx/blue-impact-hit` / `crit` / `divineshieldbreak` (deeper every loop) |
| rewind (reversed riser into the hand) | sparkle whoosh, REVERSED |
| tape zip | `fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3`, REVERSED, pitched up |
| boom | `fx/universfield-cinematic-swoosh-impact-454392` |
| riser (god rising, hourglass) | `windup` |
| IV shatter / glass / gong / rumble | `rebornshatter` / `divineshieldbreak` / `equipclang` at 0.5x / `fx/heavy-rock-impact` |

ElevenLabs prompts for real clips, when credits are available:

1. *Tape rewind zip*: "a short analog cassette tape rewinding at high speed, a rising whirring zip, 0.3 seconds,
   clean, no music".
2. *Reverse time whoosh*: "a reversed magical whoosh that swells and snaps shut, glittering sand and wind sucked
   backwards, 0.4 seconds".
3. *Clock tick stutter*: "three fast mechanical clock ticks stuttering backwards, brass gears, dry, 0.25 seconds".
4. *Sand torrent pour*: "a heavy torrent of glittering golden sand pouring from the sky, crystalline shimmer, 0.6
   seconds".
5. *Time gong*: "a deep ancient temple gong with a long shimmering metallic tail, divine, 2.5 seconds".
6. *Hourglass shatter*: "an enormous glass hourglass shattering, crystalline shards and sand bursting outward, a deep
   boom underneath, 1.5 seconds".

## Perf

The rules: no looping paint-property animation; DOM writes are `transform` / `opacity` only; the board rows are found
once (no per-frame queries or layout reads). Sprites are pooled under a hard cap (440). The own objects are made once
and reused: the torrent and its two RGB ghosts, the halo, the clock, at most six echoes, the hourglass and the vortex
grains. The ribbon strips are made once, the god's art is decoded once per session, and the other textures are painted
once and pre-warmed during the formation.

T4 per-frame CPU (the sequence step plus the Pixi submit), driven frame by frame on the dev server through the
`frames` seam:

| run | frames | p50 | p95 | max | peak sprites |
| --- | --- | --- | --- | --- | --- |
| Rewind IV | 388 | 0.1 | 0.3-0.4 | 0.9-2.1 | 340 |
| Bleed IV | 577 | 0.1 | 0.4 | 1.3 | 553 |
| Basketball IV | 463 | 0.1 | 0.2 | 4.2 | 119 |
| Arcana IV | 357 | 0.1 | 0.7 | 11.6 | 179 |

The god, the washes and the clock face are a handful of large quads: GPU fill, not CPU. They were not profiled on the
PROD build in this session.

## Verification

Tests:
- `packages/ui/src/heroRewind/heroRewind.test.ts`: the plan, story time, the god and the board twitch, the stutter, the
  dip, the Knockout bolt-on, the runner, the scene and the cosmetic.
- `packages/ui/src/heroAttack/` (camera once, knockout tier, no clock pause, tuner buttons).

Pins: crate odds (Ancient 3 / 11 = 0.273 each; categories 11.8 / 38.4 / 14.8 / 8.3 / 26.7), the Collection counts
(Attack Animations x/21, album +1), and the oracle R-PROG-ATTACK-35.

## Judgement calls

- **The god's grip.** The art is a still, so "the god closes its hand" is drawn as its halo rings clamping onto the
  target like a fist.
- **The torrent's source.** It pours from the god's raised hand on the far side from the target, so it sweeps the
  whole board. The art is mirrored when needed, which swaps which eye is gold.
- **The oracle id.** R-PROG-ATTACK-35 was used, leaving 34 for Soul Stitch, which is in flight on its own branch.
