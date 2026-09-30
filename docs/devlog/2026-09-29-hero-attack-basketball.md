# 2026-09-29: Nothing But Net, the basketball hero attack (attack_basketball, Legendary)

Owner ask: "branch off and make a basketball attack animation. tier 1 = basketball shot from place / tier 2 = a
fadeaway, the attacker hero slides to mid court, then slides to the left or right kind backwards and shoots a basketball
at the target / tier 3 = a slam dunk on the target / tier 4 = a self alley oop ... add a whistle and Ooo's sound effect
as well as basketball sounds and sneaker sounds. use the elevenlabs api if needed".

Owner review of the first build (live on 5173), the same day: "the fadeaway is the best, let's make the tier 3 another
like it - let's have the attacker scoot straight upwards and get a pass thrown to him from off-screen from the right side
and he pump fakes, dribbles back and then pulls up for a 3. for the huge self alley oop - have the attacker chuck the
ball from its starting position, and then run up and leap from half court, catching the ball and massively slamming on
the target." The slam dunk and the bounce-off-the-target alley-oop were replaced.

## What it does

The fourteenth Legendary hero attack, the style `basketball`, the cosmetic `attack_basketball` ("Nothing But Net", a
placeholder name for the owner to rename; the id stays). After the shared damage formation a referee's whistle sounds and
the striking PORTRAIT itself plays ball (like Classic, Enraged and Shadow Step), with a hoop (a glass backboard, an orange
rim and a white net) drawn on the struck hero. Flat 2D, no hit-stop, the blow lands once.

- **I, the jumper:** a dribble where it stands, a small jump, a high arcing shot with backspin and a soft trail, swish
  (a net ring, sparkles, the word SWISH): THE impact. The ball drops through and away.
- **II, the fadeaway (unchanged after the review, the owner's favourite):** it dribbles out to mid court, pushes off
  BACKWARDS and to the side with more room, leans back, releases at the top of the fade, swish and a small crowd "ooh",
  then slides home.
- **III, the pull-up three:** it scoots straight up court from its slot (down court for a foe striking from the top); a
  pass whips in from off the RIGHT edge of the screen and it catches it (a flash, a squeak); a pump fake (the ball
  snapped up and pulled back); it dribbles back, away from the target; then pulls up for a long, high three: a bigger
  swish with rings rippling out, confetti and the crowd's "ooh" (THE impact), then it slides home.
- **IV, the self alley-oop:** a dribble, it chucks the ball high from its slot, runs up to half court (sneaker squeaks),
  leaps from there, catches the ball in the air above the struck hero (a catch flash) and slams it down: the backboard
  shatters into glass shards, four shockwave rings, confetti, the whole board shakes, rim + slam + a loud "ooh" + a cheer
  (THE impact). A knockout always plays IV.

Every point the portrait visits is clamped on screen; the catch point "above" the target swings round it toward the
middle of the screen when the target is tucked in a corner (the foe at 1920 x 1080), and every shot and slam lands on the
struck hero's centre. The striker is raised over the target (`.duel-attacker-*`) from the whistle. Every exit (the end,
`finish()`, `cancel()`, the safety timer, and an unmount, which cancels) restores its transform, opacity and class
exactly and hides the ball, both shadows and the hoop (tests pin each path; the Banana's grey disc is the reason).

## How

- `packages/ui/src/heroBasketball/`: `heroBasketballConfig.ts` (per-tier dials t1-t4 on the shared `configStore`, the
  pure plan / cues / geometry / keyframed portrait pose / ball path / hoop / camera), `heroBasketballScene.ts` (the
  shared `FxPool`, cap 320, plus six own objects: the ball, its shadow, the portrait's shadow in the air, the backboard,
  the net, the rim over the ball), `heroBasketballTextures.ts` (canvas-painted once: the ball with its seams, the soft
  shadow, rim, net, backboard, a glass shard, a confetti strip, the words SWISH and SLAM), `heroBasketball.ts` (the
  runner on the shared Sequence / StageCamera / PortraitMover), `heroBasketball.test.ts`.
- The tuner (`HeroBasketballTuner.tsx`) is built on the Rare tuner builder with four tier groups; `rareTunerSpec` gained
  an optional `tierHints` for a four-tier attack's Play button hints. Buttons on top, no Speed / Reduced motion.
  Dials for the new motions: scoot height, pass flight / entry / arc, pump fake time and lift, dribble back time and
  distance, half court, catch height, hang time, and the chuck's arc (Tier IV Arc). One clip / gain / pitch row per cue.
- Wired: the style registry, Recruit dispatch, the Collection preview, DevMenu, `tunerAll`, the cosmetic + its Edge
  mirror, the knockout / camera / formation / tuner-button lists, the style-list pins, the crate pins (Legendary 16 ->
  17 items, 5 / 17 = 0.294% each; hero attacks together 12.6%) and the Collection counts (20 attacks, 93 items).
- Oracle: R-PROG-ATTACK-33 (and R-PROG-ATTACK-01's crate history). GAME-RULES and the patch note updated.

## Sound

The existing library had no whistle, crowd "ooh", dribble, net swish, rim rattle or sneaker squeak, so those six are
new clips in `packages/ui/src/audio/fx/`: `bball-whistle`, `bball-ooh`, `bball-dribble`, `bball-swish`, `bball-rim`,
`bball-squeak`. **They are SYNTHESISED placeholders, not ElevenLabs**: the ElevenLabs key was not in the primary
checkout's `.env` (it only holds the Supabase key) nor the environment, so nothing could be generated. They were made
with ffmpeg (`aevalsrc`: a pea-whistle tone with its trill; a detuned vowel chorus over a low-passed slice of the
game's own crowd clip; a pitch-dropping thud with the ball's ping; a fluttering noise burst; inharmonic metal partials
with a rattle; a rubber stick-slip chirp) and levelled to the same -20 LUFS the card clips use (the two short ones by
their looped loudness, which the two-pass loudnorm cannot measure under 400 ms).

The ElevenLabs prompts are ready in `packages/tools/vo-lines.json` (`sfx`: `vo-bball-whistle`, `vo-bball-ooh`,
`vo-bball-dribble`, `vo-bball-swish`, `vo-bball-rim`, `vo-bball-squeak`). With the key in the repo-root `.env`:
`npm run vo:generate -- --sfx`, listen in `vo-drafts/`, `npm run vo:approve -- vo-bball-whistle 1` (etc.), then
`npm run sfx:normalize -- --only vo-bball-whistle,...` and point the tuner's clip rows (or the defaults) at
`fx/vo-bball-*`. The placeholders do not block that (different file names).

Reused: the throw / pass / chuck whoosh (`fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3`), the slam
(`fx/heavy-rock-impact`), the glass (`divineshieldbreak`), the cheer (`fx/cheering`); the catch is the dribble pitched up.

Cues: the whistle at the start of every tier (softer on I); a dribble on each bounce; sneaker squeaks on the push-offs,
the stops, the catch, the pump fake, the step back, the take-off and the slide home; the whoosh on shots, the pass and
the chuck; the swish on I-III (louder on III) with the "ooh" soft on II and full on III; IV: rim + slam + glass + a loud
"ooh" + the cheer.

## Perf (PROD build, `vite build` + `vite preview`, headless Chrome over CDP, 1920 x 1080, RTX 4080 D3D11)

A temporary, uncommitted hook reached the runner between the real portraits in a Practice lobby. Frame times in ms.

Vsync and the frame cap OFF (raw frame cost, sound off), as the Banana devlog measured:

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (40, first play, cold page) | 2464 | 2.1 | 3.1 | 20.7 | 125.9 | 29 | 2 |
| IV foe (40, first foe play) | 976 | 3.4 | 23.2 | 26.9 | 75.1 | 137 | 2 |
| III (14) | 8935 | 0.6 | 1.0 | 3.0 | 8.6 | 0 | 0 |
| II (8) | 7902 | 0.6 | 1.0 | 1.7 | 7.4 | 0 | 0 |
| I (3) | 7377 | 0.6 | 1.0 | 1.5 | 9.4 | 0 | 0 |
| IV you (40, again) | 9332 | 0.6 | 1.1 | 1.9 | 9.0 | 0 | 0 |
| IV foe (40, again) | 9494 | 0.6 | 1.0 | 1.5 | 14.2 | 0 | 0 |

At 240 Hz vsync with sound ON: p50 4.2 / p95 4.3 / p99 4.3 on every warm run; one or two 21-29 ms frames per play (one
about 50 ms after the whistle, where the camera and the z-order come on, and one at the teardown). The cold first plays
spike (the page's first overlay render, first formation and first foe portrait mount), as every style's does.

## Open for the owner

- The name "Nothing But Net" is a placeholder.
- The six new clips are synthesised placeholders until the ElevenLabs key is available (see Sound).
