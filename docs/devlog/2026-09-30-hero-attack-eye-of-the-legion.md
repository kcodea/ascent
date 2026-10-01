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
- **III:** a large eye; the board dims; the beam fires beside the target (always on screen) and sweeps onto it (the
  blow as it arrives); it holds and sprays sparks.
- **IV:** a colossal eye up top (pushed along so it never covers the struck portrait); a fel-negative veil (one
  vignette sprite); a heavier open; three saccades; the iris IGNITES (live fel fire round its ring); a thick gaze lands
  and holds while the target is drawn in (a dark core, three collapsing rings, motes streaming in, the portrait
  shrinking and trembling); it IMPLODES into a STARBURST (two counter-rotating ray bursts, flashes, rings, shards, fel
  fire): the blow.

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
