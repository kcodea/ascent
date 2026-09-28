# 2026-09-28: Quake, the second hero attack, and a shared hero-attack core

Owner ask (2026-09-28): "branch off and make a new attack animation called quake. same attack dmg threshold logic as
blast. the concept being an earthquake attack essentially with varying degrees of strength/cracks/explosions".

Owner review: "quake looks solid" (the visual direction approved). Owner bug report, same day: "you can see the foe area isnt centered. can you fix that? may be wrong for blast too".

Nothing changes for players until the owner deploys `progression-inventory` (the catalog sync adds `attack_quake`). The
equip SQL already accepts the `hero_attack` slot, so no new migration.

## The rework (same day)

Owner: "the quake animation is not up to par with the others. can you take a quick pass at improving that? maybe only the
huge hit should quake, and the others can be slightly different? i think the line animation is over used. i also think
the quake itself could look a bit better, maybe faster but then have pixi burst out of it almost like an eruption." The
bar is Arcana ("arcana looks so god damn good"), so the rework copies its rules: one bold hero element per tier, normal
blend for solid stone and additive only for light, short fills and lingering line work, ticks before the impact.

- **Tiers I-III: boulders, no crack line.** The hero stomps (no cracks), a boulder is ripped out of the ground and lobbed
  (the arc rises toward screen-up with a ceiling, a shadow slides along the ground under it, dust streams off it), and a
  crown of STONE SPIKES bursts out round the struck portrait (pointing outward, so the face is never covered) with a
  spray of molten grit. I: one boulder; II: two (the first lands as a tick); III: three hot, glowing boulders, magma in
  the spray. Only the last boulder lands the blow.
- **Tier IV: the only earthquake, faster.** The fracture now takes 280 ms (was 720) and the board cracks are fewer, then
  the ERUPTION: a short light burst, two shock rings, the spike crown, a violent upward spray of molten streaks, the
  pillar with jets, embers, the crater, follow-up booms. The impact fills were cut down (shorter, smaller) so the `-N`
  never sits in a white disc.
- New tuner dials per tier: Earthquake (toggle), Boulders, Boulder size, Boulder flight, Throw gap, Arc height, Stone
  spikes, Spike height, Magma spray; a "throw" sound cue (`woosh2`); a Tier II (8) Play button.

Timeline after the rework (ms at 1x, 1600 px apart; end includes both hit-stops):

| tier | concept | slam | impact | end |
| --- | --- | --- | --- | --- |
| I (3) | one boulder | 875 | 1335 | 2046 |
| II (8) | two boulders | 1120 | 1710 | 2571 |
| III (14) | three hot boulders | 1490 | 2150 | 3205 |
| IV (40) | quake + eruption | 1860 | 2140 | 3490 |

Perf after the rework (PROD build, same rig): IV you 1432 frames p50 4.2 / p99 4.3 / worst 20.8 (1 over budget); IV foe
worst 12.5 (0 over); III, II and I p99 4.3, worst 16.7 (1 over each).

The first pass, below, is kept as the history; its per-tier crack ladder (I one crack ... IV the cataclysm) is replaced.

## What shipped (first pass)

- **Shared core** (`packages/ui/src/heroAttack/`), factored out of Blast with its behaviour unchanged (all 27 Blast
  tests, including the pinned per-tier timeline, pass untouched): `tiers.ts` (the owner-approved thresholds 6 / 12 / 20,
  one `tierOf`, the combine counts and timeline), `combineNumbers.ts` (the Tier / Minion numbers flying into one total,
  the rising ticks, the slam, the absorb, the dim, the big `-N`), `sequence.ts` (one clock with hit-stops and freezing
  beats, the consequence landed exactly once, finish / cancel, the safety timer, Pixi drain and unhook),
  `stageCamera.ts` (the `#stage` camera mirrored onto the Pixi root, portrait transforms restored), `attackSound.ts`
  (voices, pre-warm, riser placement, duck), `options.ts` (one options / handle shape for every runner),
  `attackDemo.ts` (the tuners' Play buttons).
- **Quake** (`packages/ui/src/heroQuake/`): combine, then the hero RISES (pebbles lift) and SLAMS the ground (a squash, a
  downward camera kick, a dust shockwave, a starburst of cracks); a crack races to the target on an accelerating front,
  opening behind its tip, kicking up dust and grit, while the camera RUMBLES (mostly vertical, deterministic sines,
  building); the ground ERUPTS under the struck hero (a flash, a magma bloom, a spurt of light, a burst of cracks, rock
  chunks with shadows and one bounce, a dust cloud, the hit-stop, the portrait jolted up then down). The consequence
  (`settleCombat`, Armor then Resolve) lands on that beat.
  - Tiers: I a single thin crack and a pop of dust; II branches, a stronger rumble, rocks; III fissures, magma seams,
    secondary bursts along the path, a crater; IV the slam cracks the whole board, a pillar of magma with jets, follow-up
    explosions, a lingering crater, the longest rumble.
  - Cracks are triangle-strip meshes (lip, chasm, magma glow, magma seam) on seeded angular paths with mitred joints,
    rewritten in place each frame (each under 100 vertices so Pixi batches them). The same fight draws the same cracks.
  - Sound: the shared ticks and slam, a windup riser landing on the slam, a ground impact, a low thump, splitting rock, a
    rock eruption, a big blast on III+, bursts and booms, debris patter, and a synth ROLLING RUMBLE (`playRumble` in
    `sfx.ts`: looped brown noise, high-passed so the low end stays punchy, its low-pass opening as it builds).
- **Cosmetic**: `attack_quake`, placeholder name "Tectonic Slam", Legendary, crate, style `quake`. The Collection's
  Attack Animations tab lists it with the in-place preview; the dev "Attack style" switch has Quake.
- **Tuner** "Hero Attack: Quake" (hub): every timing, crack, rumble, eruption, debris, magma, colour and sound dial per
  tier, Play both directions at Small 3 / Medium 12 / Huge 40 plus the foe versions, reduced motion, 1x / 0.5x / 0.25x,
  Copy JSON. DEV-only localStorage; production plays the baked defaults.
- **Anchor fix (Blast too)**: both attacks now measure the round portrait ART (`.heroimg`, `.combatopp-img`) at rest.
  The foe's `combatoppdrop` entrance was still running when a tuner preview mounted it, so the impact landed ~90 px
  above the portrait; any running animation is now seeked to its end for the one measure and put back
  (`portraits.ts restingRect`, oracle R-PROG-ATTACK-04).

## Timeline (ms at 1x, 1600 px apart; end includes both hit-stops)

| tier | wind-up | slam | impact | end |
| --- | --- | --- | --- | --- |
| I (3) | 645 | 885 | 1265 | 1976 |
| II (8) | 850 | 1150 | 1610 | 2476 |
| III (14) | 1160 | 1560 | 2140 | 3205 |
| IV (40) | 1480 | 2020 | 2740 | 4100 |

## Crate odds (first crate)

Common 47.0%, Rare 31.2%, Epic 19.1%, Legendary 2.7%; a non-title item 31.3%; the two hero attacks together 1.1% (each
0.55%). Was 47.3 / 31.3 / 19.2 / 2.2 / 31.0 before Quake.

## Perf (dev server, headless Chrome, 1600x900, 240 Hz, real ticker)

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms |
| --- | --- | --- | --- | --- | --- | --- |
| IV you quake (40) | 1568 | 4.2 | 4.3 | 4.3 | 20.8 | 2 |
| III (14) | 1399 | 4.2 | 4.3 | 4.3 | 33.3 | 3 |
| I (3) | 1098 | 4.2 | 4.3 | 4.3 | 20.9 | 1 |

PROD build (vite build + preview, same rig, a temporary uncommitted hook to reach the runner): IV 1577 frames p50 4.2 /
p99 4.3 / worst 16.7 / 0 over budget; IV foe worst 20.8 (1 over); III p99 8.3, worst 37.4 (3 over); I worst 20.8 (1 over).

No DOM left behind and the `#stage` transform restored after each run. Sprites are pooled per layer (cap 1600), crack
meshes are capped (320) and destroyed as they fade, textures are painted once per session.

## Open for the owner

- The name "Tectonic Slam" is a placeholder; Legendary to match Blast.
- Sounds are layered from existing clips plus the synth rumble. Purpose-made clips would lift it: a heavy ground slam
  (short, punchy), a rolling rumble bed (1 to 3 s), a rock split / crack, a magma eruption burst, and a debris patter.
