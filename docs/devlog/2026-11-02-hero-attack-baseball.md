# 2026-11-02: Charge the Mound, the baseball hero attack (attack_baseball, Legendary)

Owner ask: "baseball - have the opponent be the pitcher and the batter be the player dealing dmg. the final lvl
4/knockout should be the player getting struck by the ball and charging the mound and beating up the opponent in an
over the top fast attack sequence", and "get creative and fun".

## The signature

No other attack flips the roles. The STRUCK hero acts first: its portrait is the PITCHER (a glove pop, a windup that
rocks it back with a little leg-kick lift, a lunge on the release) and the striker's portrait is the BATTER, with a
bat at its side. Both portraits move in every tier.

## The tiers (shared thresholds; a knockout plays IV)

- **I up the middle:** the pitch, CRACK, a line drive straight back that BONKS the pitcher (the blow), the ball pops away.
- **II the hot shot,** a bigger stepping swing and one of three hits rolled per blow (`variantOf(rollSeed)`, the
  Basketball's roll; the DEV tuner's Variation row forces one):
  1. a screaming liner, flat and fast, that spins the pitcher a full turn (SMACK!);
  2. a one-hop grounder that skips in the dirt (a puff and a hop sound) and hops up into the pitcher;
  3. a foul tip that loops wide round the field (a cubic curve, kept on screen) and smacks the pitcher from BEHIND, knocking it toward the batter.
- **III the moonshot:** slow mo on the contact (0.4x, about 340 ms real, Basketball's subtle ramp), a huge CRACK, a BAT
  FLIP (it spins up and clatters down beside the batter), the ball rockets up off the top of the screen shrinking and
  twinkles; the pitcher shuffles side to side in a panic while a shadow grows under it and a slide whistle falls (timed
  to bottom out on the crash); the ball drops from the sky GROWING and craters the pitcher: HOME RUN!, a dust ring,
  fireworks, the cheer.
- **IV charge the mound (the owner's frame):** the pitcher BEANS the batter (slow mo on the bean, a BONK! and dizzy
  stars on the STRIKER, the crowd "ooh", no damage); the batter reels (a wobble), slams the bat into the dirt, fumes
  (steam puffs, a shiver) and CHARGES THE MOUND to the ballpark organ's "Charge!" (speed lines, dust); the collision
  bursts into a cartoon DUST-CLOUD BRAWL: the pitcher is dragged into the cloud, the benches clear (streaks and dust
  rushing in from both edges of the screen), both portraits shake and pop out of the cloud, and a fast flurry of nine
  comic hits (POW! / BAM! / SMACK! kapow bursts, stars, thumps, camera jolts) plays with the clock at 1.3x; then the
  batter rears back and lands one HAYMAKER: the cloud blows apart, the pitcher is launched spinning (kept on screen) and
  springs home: YER OUT!, the umpire's call, the crowd.

The blow lands exactly ONCE (the bonk, the crater, the haymaker). The pitch, the crack, the hop, the bean on the
striker, the collision and every brawl hit are ticks.

## Judgement calls (flagged for the owner)

- **Name:** "Charge the Mound" is a placeholder (the id `attack_baseball` stays).
- **Rarity:** Legendary, like the Basketball (four tiers). Crate pins: Legendary 87 -> 88 items, 9 / 88 = 0.102% each.
- **The brawl's spot:** the foe portrait sits tucked in the top-right corner beside the rail, so a brawl on its slot
  was half off screen. The brawl (and the cloud) is pulled in off the edges so the whole cloud shows, and the pitcher is
  dragged into it; after the haymaker it is launched and springs back to its slot.
- **No helmet:** the batter throws its bat down; a helmet would be another painted prop for little gain.
- **The brawl is a cloud, not fists:** the portraits themselves pop out of the cloud on the hits (no drawn limbs).
- **Big words** (HOME RUN!, YER OUT!) drop BELOW the target when there is room, clear of the hit number that punches in
  above it.

## How

- `packages/ui/src/heroBaseball/`: `heroBaseballConfig.ts` (per-tier dials t1-t4 on the shared `configStore`, the pure
  plan / cues / geometry / batter and pitcher poses / ball / bat / slow mo / camera), `heroBaseballScene.ts` (the shared
  `FxPool`, cap 320, plus four own objects: the ball, its shadow, the bat, III's target shadow),
  `heroBaseballTextures.ts` (canvas-painted once: the ball with red stitches, a bat, a dust puff, a comic kapow burst,
  seven words), `heroBaseball.ts` (the runner on the shared Sequence / StageCamera / PortraitMover; BOTH portraits
  restored on every exit), `heroBaseball.test.ts`.
- The tuner (`HeroBaseballTuner.tsx`) on the Rare tuner builder with four tier groups, a Variation row, and one clip /
  gain / pitch row per cue. Play buttons: Small (3) = I, Tier II (8) = II, Medium (12) = III, Huge (40) = IV, and the
  Foe versions.
- Wired: the style registry, Recruit dispatch, the Collection preview, DevMenu, `tunerAll`, the cosmetic + its Edge
  mirror, the knockout / camera / formation / tuner-button test lists, the style-list pins, the crate pins and the
  Collection counts (23 attacks).
- Oracle: R-PROG-ATTACK-36 (and R-PROG-ATTACK-01's crate history). GAME-RULES and the patch note updated.

## Sound

The owner generated the clips in ElevenLabs (`C:\Game Assets\Ascent Art\SFX\Baseball\`, copied, never moved); they
replaced the first build's synthesised placeholders. Seven clips in `packages/ui/src/audio/fx/`, each trimmed to its hit,
given a short fade, levelled to about the other fx clips' loudness and encoded like them (mono, 44.1 kHz, 128 kbps mp3):
`baseball-glove` (the mitt pop, the opener), `baseball-crack` (the bat), `baseball-bonk`, `baseball-fall` (the slide
whistle: the whole 3 s fall kept but played about four times faster, tempo only, so it bottoms out on the moonshot's
crash), `baseball-charge` (the organ: the two pickup notes and the held note, cut short), `baseball-brawl` (NEW: the fast
cartoon fight flurry, played once on IV's collision under the whole cloud; each comic hit keeps a soft `flurryhit` thump)
and `baseball-out` (the gruff umpire's "Yer OUT!").

THE PHONE AUDIO BUDGET decided the lengths: a phone decodes every code-named `fx/` clip ahead of a fight
(R-TOUCH-AUDIO-QUALITY-01), and the worst-case working set (`phoneAudioQuality.test.ts`) had about 4.7 s of 48 kHz mono
left for this attack. The seven clips total about 4.5 s, so the headroom left for the NEXT attack is close to zero (the
soccer build will need room: prewarming only the equipped attacks' clips would free it).

Reused: the pitch / swing / charge whoosh, the hop (the dribble, pitched up), the brawl hit thumps (`flurryhit`), the KO
and crater (`fx/heavy-rock-impact`), the crowd "ooh" (`fx/bball-ooh`) and the cheer (`fx/cheering`).

## Perf

Compositor-only DOM writes (both portraits' `transform`, from the one clock), layout read once at the start, pooled
sprites under the cap (the brawl peaks well under it in the tests at 1920 x 1080), textures painted once and pre-warmed
during the formation; the cloud is a stream of short-lived pooled puffs (one every 28 ms of attack time, under 20 alive).
Measured on the PROD build (`vite build` + `vite preview`, a temporary uncommitted hook played the real runner between
the real portraits in the shop), headless Chromium at 1920 x 1080 with vsync off, sound off. Frame intervals in ms
(headless intervals are indicative only; the main-thread numbers from CDP are the trustworthy ones):

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | script ms / frame | task ms / frame |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I (3, first play) | 2989 | 1.0 | 2.3 | 4.2 | 39.1 | 5 | 0.10 | 1.16 |
| II (8) | 2430 | 1.3 | 2.4 | 3.3 | 13.7 | 0 | 0.09 | 1.14 |
| II (8) | 2596 | 1.3 | 2.3 | 3.0 | 15.9 | 0 | 0.09 | 1.11 |
| II (8) | 2440 | 1.4 | 2.3 | 2.9 | 13.3 | 0 | 0.09 | 1.14 |
| III (14) | 3423 | 1.4 | 2.5 | 3.7 | 25.3 | 1 | 0.10 | 1.12 |
| IV (40) | 3858 | 1.5 | 2.8 | 4.3 | 12.6 | 0 | 0.10 | 1.20 |
| IV foe (40) | 4010 | 1.6 | 2.2 | 3.0 | 15.1 | 0 | 0.10 | 1.18 |
| IV again | 4045 | 1.4 | 2.8 | 5.1 | 16.6 | 0 | 0.09 | 1.15 |
| III again | 3641 | 1.4 | 2.1 | 3.4 | 17.2 | 1 | 0.09 | 1.07 |

The cold first play spikes (the first overlay render and texture upload), as every style's does; the brawl adds no
long frames. Not re-measured on a real 240 Hz display or a phone.

## Open for the owner

- The name. The clips are the owner's; the organ and the slide whistle are cut short / sped up to fit the phone budget.
- Both portraits leave their slot in IV; the slot's dark well shows behind while the batter is at the mound (as with
  every attack that moves a portrait).
