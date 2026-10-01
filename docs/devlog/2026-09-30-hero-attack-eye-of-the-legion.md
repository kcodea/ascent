# 2026-09-30: Eye of the Legion, the fel hero attack (attack_fel, Legendary)

Owner ask: "create a brand new attack animation that is on par with hearthstone/modern world of warcraft level animation
art style performance readability and everything", theme fel / chaos bolt. A first pass (fel-fire chaos bolts and a
rune circle meteor, kept as a WIP commit on this branch) was ruled "a green fire animation which is not what i want ...
this may be our first mythic rarity item". Three signature concepts were pitched; the owner picked **the Eye of the
Legion**. Legendary for now (no Mythic rarity exists; none added).

## What it does

Style `fel`, cosmetic `attack_fel` ("Eye of the Legion"). After the shared damage formation a fel rift tears open in
the air and a demonic eye opens inside it. Nothing else in the roster has a watcher: the eye shows intent.

- **Anticipation:** a glowing seam in the tear; the lids crack (a slow first 15 %), then snap open with an overshoot;
  the pupil darts in fast saccades (away from the target first); it LOCKS (the pupil slams to a slit, the lids narrow
  into a glare, a flash on the iris).
- **Release:** the gaze leaves the pupil (a flash, the hero jolted back).
- **Dissipation:** the eye blinks shut and the rift seals, shedding embers.
- **I:** a small eye over the attacker; a lancing gaze pulse (the blow).
- **II:** two eyes out of sync (one over the attacker, one beside it toward the middle); both gazes hold and cross on
  the target. The first is a tick; the second lands the blow.
- **III and IV: ESCALATING EYES** (owner review the same day: "i think the t3 eye of the legion attack is pretty bad,
  and i think t4 is kinda anti-climactic. i think it may be cooler if 2 open and fire a beam, and then more and more open
  and blast the target until a massive fel explosion happens or something and add some screen shake to it"). The first
  version's single sweeping eye (III) and colossal imploding eye (IV) were replaced.
- **III:** the pair opens and fires, then two more eyes tear open and join; the four beams burn together on the target
  (a knot of light growing with every beam) while the shake builds; a solid fel impact lands the blow; every eye snaps
  shut together.
- **IV:** the pair fires, then MORE AND MORE eyes tear open round the edges of the screen and the sky (fourteen in all,
  each gap 0.8 x the last), each a short sharp performance (a tear, a snap open, a glance, a slit, a gaze); every gaze is a
  tick; the beams converge into a blinding knot under a fel veil while the shake builds with every eye; then the MASSIVE
  FEL EXPLOSION (the blow): a white-green core and a screen flash, two starbursts, three shockwave rings and a dark
  pressure ring, a towering fireball (a column when there is room above the target, a ring of fire when it sits at the
  top), burning debris, smoke and a scorch, a sharp kick and a heavy shake. It is centred on the struck portrait but
  drawn in from an edge (at most 1.3 portrait radii), so a target in a corner never has its climax cropped (a camera pan
  cannot do it without showing the stage's edge). Every eye snaps shut together and the rifts seal.
- **The shake escalates:** a kick along the gaze on every hit, harder with every eye; a rumble that builds through the
  barrage; the explosion's sharp kick and heavy ring. All on the shared StageCamera; no freeze.

## Perf (Tier IV, 14 eyes)

DEV server (an upper bound: StrictMode and Vite dev are slower than the prod build), headless Chrome over CDP on the
RTX 4080 (D3D11), vsync and the frame cap OFF (raw frame cost), sound off, frames from the attack's start to its end:

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms |
| --- | --- | --- | --- | --- | --- | --- |
| IV you (first play) | 4170 | 1.4 | 2.4 | 2.8 | 9.2 | 0 |
| IV foe | 4313 | 1.4 | 2.1 | 2.4 | 5.5 | 0 |
| IV you (again) | 4352 | 1.3 | 2.3 | 2.8 | 9.9 | 0 |
| III (4 eyes) | 4059 | 0.8 | 1.7 | 1.9 | 7.5 | 0 |

The eye rigs are built two a frame while the formation plays (never in one burst), the beams and one-shots are pooled
(420 sprites, 1000 fire particles, 16 eyes at most), and only transforms and alpha change per frame.

## How

- `packages/ui/src/heroFel/`: `heroFelConfig.ts` (per-tier dials, the pure plan / cues, the eye placement
  `eyeMotions`, the pure `eyePose` (rift, lids, look, pupil, glow, seam) and `beamPose`, the camera),
  `heroFelScene.ts` (`FxPool` one-shots + `PixiFire` for the fel fire + one rig per eye built at construction),
  `heroFelTextures.ts` (painted once: sclera, veins, iris fibres, slit pupil, lid band, lid glow, the torn rift and its
  rim, the gaze cross-section, the starburst, the veil, a crackle, a shard), `heroFel.ts` (the runner on the shared
  Sequence / StageCamera / PortraitMover), `heroFel.test.ts`.
- The eye's lids are a `Graphics` almond mask drawn once and scaled in y; the lid band and its glow scale with it, so a
  shut eye is a glowing seam. Only transforms and alpha change per frame.
- Wiring: style registry, Recruit dispatch, Collection preview, DevMenu ("Hero Attack: Eye of the Legion"),
  `tunerAll`, the cosmetic + Edge mirror, the all-styles lists, the crate / collection counts (Legendary 21 items,
  5 / 21 each), oracle R-PROG-ATTACK-34, GAME-RULES, patch note.
- Sound reuses the library (no new clips): the rift (`spirittendril`), a growl as it opens, a tick per saccade, the
  lock (`triggerglow`), the gaze (`fel-spike-echo`), the hit, IV's implosion riser (`runeselectimplosion`) and the
  starburst boom, a blink; a synth hum from the rift to the gaze and a rumble under IV.

## Open for the owner

- The name "Eye of the Legion" is the builder's pick (the id stays).
- A Mythic rarity, if wanted, is its own change.
