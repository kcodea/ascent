# 2026-11-12: Written in the Stars, the constellation hero attack (style `stars`, Ancient, dev-only)

One of the sixteen attacks scaffolded on `feat/hero-attacks-16`. The style id is `stars`; it has NO cosmetic yet, so it
plays only through the dev "Attack style" override and its own tuner (dev menu, "Hero Attack: Written in the Stars").
Scaffolded from `bullettime`; nothing of that look is left (no blades, no clock, no slow motion: the clock is never
scaled or held).

## The signature

CONSTELLATIONS. The board dims to a night sky, stars light one at a time as thin lines reach them, and the finished
figure comes alive and strikes. The drawing-on of the lines is the charm: each line grows from a lit star to the next,
a bright pen point riding its tip, and the star pops and ticks as the line arrives. No other attack draws line figures.
Everything is cold white-gold starlight on blue-black. The Inferno owns meteors and fire, so IV's falling star is a
clean point of light with a thin trail and lands in stardust, never a fireball.

## What it does

Four looks on the shared thresholds (a knockout plays IV). Length after the damage formation, on a 1700 px board:

- **I, the arrow (about 1.4 s):** three stars light in a row above the striking hero and link into an arrow, with two
  small barb stars at its head. The figure brightens, pulls back a little, and looses itself: the same arrow, now a
  sprite of starlight the same length, flies along its own line into the struck portrait. A small burst of stardust.
- **II, the bow (about 1.7 s):** eight stars: a five-star limb, the string through a nock star, and a two-star arrow.
  The bow DRAWS: the nock and the arrow pull back, the two string lines bend into a V, the tips flex in, the moving
  stars tremble at full draw. It holds, then the string snaps forward and rings out as the arrow leaves.
- **III, the hunter (about 2.2 s):** a sixteen-star archer, traced in the order a person would draw one: head and
  shoulders, the bow arm, the bow (two pens at once, one per limb), the string from both tips, the drawing arm, the
  arrow, then the torso and both legs in a braced stance (two pens again). A faint ghost body fills in along the limbs
  with a soft head and torso for a beat. The hunter draws and shoots, and the arrow's whole line of light hangs across
  the sky for half a second. The archer stands upright and faces the struck hero; only its bow arm takes the aim.
- **IV, written in the stars (about 3.0 s):** the veil deepens and the sky fills (130 stars). A medallion is traced
  above the board: a ring of twelve stars, a five-point crown, and a simple bust (a head and shoulders) inside. As the
  bust is drawn, the striking hero's REAL portrait fades in inside the ring as a cold ghost, and the bust lines step
  back to let it read. An arm of stars reaches from the ring toward one bright star, a ring closes on it, the star
  burns brighter, detaches, and FALLS onto the struck portrait: a white-gold glint with a thin trail. It lands in a
  clean ring of stardust and a soft flash, and a wave of brightness runs outward through every star in the sky. Then
  the night fades. The blow lands on the falling star.
- **Knockout (the tuner's Knockout buttons):** IV with a prismatic ring of stardust, a harder shake and the shared KO
  sting. The style is NOT in `KNOCKOUT_VARIANT_STYLES` (a shared file this branch does not touch), so a real knockout
  plays plain IV until the coordinator adds it with the cosmetic.

### One honest deviation: the star cannot always fall straight down

The brief asks for the star to fall "straight down onto the struck portrait". On the real layout the foe's portrait
sits in the top right corner, its top edge at the top of the screen, so when YOU strike there is no sky above it to
fall from. `pluckPoint` handles both cases from the two portrait rects: with sky above the struck hero (the foe
striking you) the star is plucked from straight above and falls straight down, the full length; with none, it is
plucked from further along the sky and comes in on the steepest line the screen allows (about 11 degrees below level
on a 1920 x 1080 screen), a shooting star rather than a drop. It always moves downward, never up. If the owner wants
the vertical drop in both directions, the foe portrait would have to sit lower, or the star would have to start off
screen.

## How

- `heroStarsConfig.ts` (pure): the plan, the geometry, the motion and the camera. A trace is made of STROKES: a path
  of stars drawn one edge per slot. Strokes may share slots (two pens). The slot count per look is fixed
  (`STARS_SLOTS`: 3, 8, 12, 18), so the timeline never depends on the geometry. A star lights when the first line
  reaches it. Every moving star is `rest + pull x drawAmount`, which is how the string bends, the arrow rides the
  string and IV's arm reaches, with no per-look animation code.
- Placement comes from the two portrait rects: `placeFigure` puts I to III above the striking hero when there is sky
  above it and beside it (toward the other hero) when there is not, always whole on screen. IV's medallion sits over
  the board. The tests run six layouts in both directions, including a 1280 x 720 screen and a sandbox box.
- `heroStarsScene.ts`: one `FxPool` (cap 640). The sky is one veil sprite with alpha (never a filter), a soft band of
  haze and up to 160 seeded small stars. The constellation is one glint and one halo sprite per star and ONE stretched
  sprite per line (position, rotation and x scale each frame). All of it is made once per attack and only moved and
  faded after that; the runner passes one reused frame object. The night is two layers: the shared DOM dim (which
  keeps the two heroes lit) and the scene's blue-black veil.
- `heroStarsTextures.ts`: eight small textures painted once per session (glint, dot, line, trail, arrow, halo, limb,
  veil). The portrait ghost copies the portrait image already on screen into a round soft-edged 256 px texture, once
  per image src, cached. If the image is missing or not loaded, the medallion shows its star bust alone.
- Deterministic: the sky scatter is seeded from `rollSeed` when the fight gives one, else from the blow.
- Every exit restores: the normal end, `finish()`, `cancel()`, the safety timer and reduced motion all go through the
  shared `Sequence` teardown (portraits' transform, the camera, the dim, the duck) plus `endSky()`. Only `transform`
  is ever written on a portrait; opacity, filter and classes are never touched.

## Sound

Seven ElevenLabs calls (budget nine). Four clips kept, 4.77 s in total; three takes dropped (a first falling star
that came back as a loud low rumble, a bowstring take with no snap, and a bow creak that was only hiss, so the draw is
silent). Each kept clip was trimmed, faded, made mono 44.1 kHz 128 kb/s and levelled (about -20 LUFS for the two long
ones; the two very short ones are peak-levelled, since loudness cannot be measured on 0.1 s).

| clip | what | length | measured |
| --- | --- | --- | --- |
| `fx/stars-sky` | a soft glassy shimmer blooming in (0.4 s fade in baked) | 2.23 s | -20.5 LUFS, peak -11 dB at 0.38 s |
| `fx/stars-tick` | one soft dry tap as a line reaches a star | 0.10 s | peak -3.8 dB at 16 ms |
| `fx/stars-loose` | the bowstring's snap | 0.32 s | peak -1.4 dB at 8 ms |
| `fx/stars-fall` | a thin high whistle gliding down, then a soft low landing (the landing raised 11 dB to balance) | 2.12 s | -20.5 LUFS; the landing starts at 1150 ms |

Cues, placed from those numbers: the sky clip on the charge; one tick per star (every second star on III and IV, so
it never rattles), played quietly with a fixed hair of pitch variation per star; the snap on the loose with the shared
`fx/whoosh-03` under it (started 420 ms in, past its slow start) for the airy pass of the arrow; for IV the falling
star clip is split at its landing: the descent is placed so it ENDS on the blow, and the landing starts on the blow,
with the sky shimmer blooming again softly under it. I to III reuse the landing half of the same clip, softer and a
little higher, for the arrow's hit. Nobody has listened to these in the game yet: the gains are set low on purpose
and every cue has a clip, gain and pitch row in the tuner.

## Verified

- Tests: `heroStars.test.ts` rewritten (27 tests): the plan and cue timing per tier, the constellations (a line never
  starts from a dark star, every figure on screen at rest and at full draw on six layouts in both directions, the
  star never falls upward), the draw, the runner (one blow; both directions at every tier; finish, cancel, the safety
  timer and reduced motion all put the portraits' transform, opacity, filter and class and the camera back), the
  sprite cap, determinism. The shared sweeps under `heroAttack/` and the clip scan pass with it.
- Looked at: contact sheets from a CDP screencast of headless Chrome at 1920 x 1080 for all four looks with you
  striking, and III and IV with the foe striking (the straight-down fall). Nothing was left on screen and no portrait
  was left moved in any run.
- Perf, DEV build only (Vite dev, headless Chrome, a machine also running fifteen other builders): the page idles at
  a 5.6 ms median (the headless frame cap), and the attack's median stays there (5.5 to 6.0 ms). There ARE long frames:
  40 to 75 ms about 90 ms after the charge and again at the end, and p99 of 12 to 35 ms. The shipped Timebreak measured
  on the same harness in the same minutes shows the same frames at the same beats (52 to 132 ms worst, p99 22 to 48 ms),
  so they come from the shared start and teardown (the stage camera's layer, the dim, the hit number) in a dev build,
  not from this scene. That is a comparison, not a pass: the 6.25 ms bar has NOT been checked on a production build.

## Not done, weak, or unverified

- The sounds are placed by measurement only. Nobody has heard them in context.
- When you strike, IV's star comes in on a shallow line (see above). It reads as a shooting star, not a drop.
- The archer's bow overlaps its own torso when it has to aim steeply down (the foe striking from the top corner).
- The bust in IV is deliberately generic and steps back once the portrait ghost is in. No edge detection of the art.
- No draw sound for the bow.
- Not in `KNOCKOUT_VARIANT_STYLES`, no cosmetic, no patch note: those belong to the PR that ships the style.
- Not looked at in the Collection preview box or on a phone.
- The first headless capture runs (before the coordinator's notice) did not block the live backend, so each of those
  page loads may have made an anonymous sign-up there. Every later run aborts requests to it.

---

# Second pass (same day): weight, payoff and sound

Owner verdict on the first pass: the big looks are "quick and not impactful", and the batch "needs sound effects".
The look (night sky, stars linked by lines, no props) is kept. Everything above about the shot, the blow, IV's fall,
the timings and the sound is superseded by this section. Store key bumped to `ascent.herostars.v3`.

## What changed on screen

- **Every shot is a bolt of starlight on a path.** The shot now rides a quadratic curve (`shotFrom`, `shotCtrl`,
  `shotTo`; a straight line for the arrows). Its tail is twenty segments laid along the path (a bright thread over a
  wide soft glow), wider with the tier, and it HANGS along the path after the blow, draining toward the hit as it
  fades (I and II trail part of the path, III and IV all of it). The arrow carries a bright point and a glow at its
  tip and sheds stardust.
- **Every blow is a nova.** Stardust thrown every way that is stopped by the air within a third of a second and then
  hangs and sinks; a hot flash and long rays; one to three rings; a flash over the whole sky (`skyFlash`, IV in full,
  I to III 22 / 34 / 55 percent of it); a JOLT that travels outward through every star, sky and constellation alike
  (they are shoved away from the hit and spring back, so the lines flex); the struck portrait is knocked further,
  tipped and squashed, and reels longer the bigger the look. All of it scales with the tier.
- **The drawing-on has presence.** A soft glow builds behind the figure as each star joins it. Lines are 9 px at I and
  30 percent wider per tier (17 px at IV, was 7 px everywhere), brighter, and the stars 10 percent bigger per tier.
- **IV is rebuilt round its key moment.** After the arm plucks the star there is a HELD BREATH (640 ms): the star
  swells and blazes (a second set of rays, a wide glow, motes of light streaming into it), every other star dims 70
  percent and leans toward it, the veil deepens and the view creeps in. Then it falls as a COMET (a head 2.2 portrait
  radii across with a white core, a tail half a radius wide) over 620 ms, and lands in the biggest moment of the
  attack: the wide nova with its even ring of stardust, the sky flash, a hard shake along the comet's line over a
  slower sway (26 px, was 14), the lines FLARING. 300 ms later the lines and stars SCATTER into about 160 sparks that
  drift down for 1.2 s while the night fades.
- **Staging when you strike** (the foe's portrait is on the top edge, so nothing can fall straight onto it). Chosen:
  the star is plucked on the FAR side of the sky, beyond the medallion, and thrown in an ARC over the top of the sky.
  It climbs, crosses above the medallion's crown and comes DOWN onto the portrait at about 20 degrees, with the whole
  width of the sky as its path (about 1,500 px on a 1920 screen, was 450 px at 11 degrees). When the foe strikes you
  there is sky above your portrait, so the comet falls straight down, now the full height of the sky (6.5 radii or
  the top of the screen, was 3.6 radii). `pluckPoint` picks between the two from the portrait rects; the tests hold
  that it always ARRIVES moving downward and never leaves the screen.
- No props were added. The one drawn object from the first pass, the arrow of starlight, is kept as the bolt's head.

## Running time (after the damage formation)

| look | first pass | now | reference |
| --- | --- | --- | --- |
| I | 1404 ms | 1619 ms | |
| II | 1725 ms | 2018 ms | |
| III | 2209 ms | 2654 ms | |
| IV | 3000 ms (blow at +2200) | 4836 ms (blow at +3136) | Soccer IV 3308 ms, Frost IV 3083 ms |

IV was already as long as Soccer IV and Frost IV, so length alone was not why it felt weightless. The extra 1.8 s is
anticipation (the held breath, 0.6 s; the longer fall, 0.2 s) and aftermath (0.9 s more: the flare, the scatter, the
drifting sparks). The trace itself is no slower. No hit-stop: the blow still lands once, on the comet.

## Sound

Measured, not heard: each look was played with sound in headless Chrome, the audio output tapped and recorded, and
the recording sliced into 100 ms windows (`snd.mjs` in the scratch folder). "Own" is everything after the formation.

| | own mean | impact window mean (blow -50 to +500 ms) | impact peak |
| --- | --- | --- | --- |
| Stars IV, first pass | -36.6 dB | -42.2 dB | -28.1 dB |
| Stars IV, now | -30.9 dB | -24.3 dB | -10.6 dB |
| Frost IV (reference) | -30.9 dB | -26.7 dB | -13.3 dB |
| Soccer IV (reference) | -31.5 dB | -31.5 dB | -13.3 dB |
| Stars III / II / I, first pass | -36.1 / -35.5 / -36.2 dB | -41.6 / -41.8 / -41.6 dB | -22.6 / -23.7 / -23.0 dB |
| Stars III / II / I, now | -31.4 / -31.8 / -32.2 dB | -27.2 / -29.2 / -31.8 dB | -14.8 / -15.3 / -17.2 dB |

The III / II / I row was measured before the last trim (the boom's gain went from 0.9 to 0.6 after it), so their
blows are a little quieter than the row says. They were not measured against Coin or Storm.

Three ElevenLabs calls (budget six), three clips kept, 4.22 s; the attack's seven clips total 8.99 s:

| clip | what | length |
| --- | --- | --- |
| `fx/stars-rise` | an airy rising swell that ends at its peak | 1.50 s |
| `fx/stars-boom` | a deep sub boom, all body, 2 s decay | 2.00 s |
| `fx/stars-release` | the deep thrum of a bowstring | 0.72 s |

Cues now: the sky shimmer at about twice the gain; a tick on every star (every second star on III and IV) that
CLIMBS about an octave through the trace; a short bloom of the shimmer when the figure comes alive; the DRAW is no
longer silent (the rise, placed to peak on the loose, on II and III; one low tick at I); the loose is the snap over
the new thrum over the whoosh; every arrow's landing has the first moment of the boom under it, quieter and higher.
IV: a low tick on the pluck, the rise under the swelling star peaking as it falls, the whistle and a heavy slowed
whoosh timed to peak just before the blow, then the full boom with the landing and the shimmer blooming over it, and
the shimmer once more, lower, as the lines scatter. Quietest stretches in IV now: about 200 ms at -37 to -45 dB
between the last tick and the pluck, and the comet's first 300 ms at about -36 dB (the breath before the boom).

## Verified in this pass

- `npx vitest run packages/ui/src/heroStars packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 891 tests
  pass (`heroStars.test.ts` is now 31 tests: the arc and the straight fall, the held breath, the flare and scatter,
  the tier-scaled blow, the tail, the jolt, the falling sparks, the pace). `phoneAudioQuality.test.ts` is green.
- Contact sheets read for all four looks with you striking and IV with the foe striking (III with the foe striking
  was captured but not read). Nothing left on screen, no portrait left moved. The sheets were captured before two
  last changes that were NOT re-captured: the comet's tail widened from 0.34 to 0.5 radii, and the sound gains.
- Perf, DEV build, headless Chrome, no screencast, two runs per look: idle 4.2 ms median; IV median 4.2 ms, p95
  4.3 ms, p99 4.3 to 12.5 ms. Long frames remain at the shared start (42 to 83 ms about 60 ms after the charge) and
  the shared teardown (29 to 46 ms), as in the first pass. NEW and not explained: one IV run of six had a 70 ms
  frame about 100 ms after the blow, and most IV runs have one 16 to 25 ms frame near the scatter (about 160 sprites
  spawned in one frame). Not measured on a production build, so the 6.25 ms bar is still unchecked.

## Still weak or not done

- Nobody has heard it. Levels are matched to Frost IV by measurement; IV's blow peaks about 3 dB hotter than Frost's.
- The scatter's one-frame spawn could be spread over two or three frames if the prod build shows the hitch.
- When the foe strikes you, the swollen star sits near the top left corner of the screen and its glow is cut by the
  screen edge.
- Knockout still plays plain IV in a real fight (not in `KNOCKOUT_VARIANT_STYLES`, a shared file); the tuner's
  Knockout button still shows the prismatic remix.
- The arc's peak passes through the medallion's crown. It reads as crossing behind it; it was not staged to avoid it.
- Not looked at in the Collection preview box or on a phone.

---

# Third pass (2026-11-13): variations, launch places, and tiers named Tier 1 to Tier 4

Owner's note, verbatim: "Written in the Stars - this one is good, but add a few different t3 options so it's
different sometimes, and make 3 or 4 of the t4 options as well so this one has some unique attacks. make the t1 and t2
shoot from different locations." The look (night sky, lines drawn star to star, cold starlight, no props) is kept;
everything above still describes the hunter, written in the stars and the shared machinery. Store key bumped to
`ascent.herostars.v4`. The looks are now called Tier 1 to Tier 4 everywhere in this attack's files.

## The variations

Rolled per blow from the stable `rollSeed` (`starsVariant`: three independent hashes of the seed, one per choice), so a
replay plays the same one; without a `rollSeed` the blow's own seed is used. The tuner has three **Variation** rows
under the Attack style row (Random, or force one): `launch` (Tiers 1 and 2), `figure3`, `figure4`. They are preview
keys, so Copy JSON never ships them. Every variation keeps its tier's timeline (the same slots, trace, alive, draw and
hold); only the flight and the aftermath differ.

- **Tiers 1 and 2: five launch places** (`launchCentre`): beside the striker (as before), high above the board,
  from beneath the board, right under the struck hero (over it when it sits at the bottom), and "the most open sky":
  of a 7 x 5 grid of places that cover neither portrait, the one farthest from the other four (often a corner), so the
  five always read as five different places. Each has its own sound accents (`LAUNCH_SOUND`): the snap's pitch, how
  long the arrow's pass of air lasts, and from high above a falling whistle under the shot.
- **Tier 3: three figures.**
  - The hunter (as before).
  - **The wolf**: seventeen stars, a running wolf facing the struck hero. It howls as it comes alive, crouches (the
    body sinks and draws back, the paws stay planted), and LEAPS: every star rides the shot along a hop as high as the
    sky allows, the body tipping with the curve, and it lands nose first on the struck hero and bursts into stardust.
  - **The serpent**: thirteen stars, an S of a body under a wedge of a head and a forked tongue. It hisses and coils
    back, then STRIKES: the head rides the shot and the body stretches after it in proportion, the tail anchored, a
    long line of stars across the sky; it bursts into stardust where it bit.
- **Tier 4: four finishers.**
  - Written in the stars (as before).
  - **The wheel**: a great wheel over the board (a rim of twelve, a hub, six spokes, six sign marks, a bright marker on
    a tooth) and a fixed pointer of three stars aimed at the struck hero. It turns one and a quarter turns, slowing like
    a heavy wheel with a ratchet tick per spoke, and LOCKS with the marker in the pointer's mouth (a clunk); the marker
    charges through the held breath and fires a BEAM (a white core over a wide glow, sparks running down it).
  - **The giant**: an Orion-shaped giant as tall as the sky, traced from its feet up (so it rises) to a belt of three
    stars, broad shoulders, a small head, a shield arc on its far arm, a sword under the belt and a fist of three stars,
    a ghost body filling in along its limbs. It raises its fist by its head (the fist charges), then brings it down on
    the struck hero, the arm reaching after it. When the struck hero sits on the top edge the fist comes over the top of
    the sky at a shallow angle (there is no sky above it to come down through).
  - **The nova**: a sigil is traced over the struck hero (a ring of eight, an eight-point star, four rays into its
    heart). The sigil closes into its heart and EVERY star of the sky streams into it (nearest first, stretched along
    their way); the heart swells, drops the last short way and explodes: the usual Tier 4 blow plus the swallowed sky
    thrown back out to every edge, a white bloom and two slow rings.

## How

- Pure, in `heroStarsConfig.ts`: `StarsKind` grew to nine kinds; the plan takes the variant (`STARS_KIND_FLY` scales the
  flight per kind; the wolf and serpent scatter 90 ms after the blow; the wheel has a `lockAt` cue). Stars gained
  `ride` (0..1: how much of the shot's path a star follows; after the loose a rider stays at full draw) and `spin`
  (turns about the wheel's pivot); figures gained `charge` (the star that swells through Tier 4's held breath, which
  is no longer always the plucked one), `pivot` and `spinTurns`, `tilt` (the wolf) and `gather` (the nova), and `lead`
  (the shot's head: arrow, comet or spark). `hop` computes a control point whose curve tops out exactly at a given
  height, so the riders never leave the top of the screen. `spinAmount` and `gatherAmount` are new pure amounts.
- In the scene the per-star placement adds the wheel's turn, the riders' offset along the path (and the wolf's tip),
  and the nova's gather on the sky's stars. New one-shot effects: `beam` and `novaBurst`. Nothing new runs per frame
  beyond a few multiplies per star; no new textures.

## Sound

Six ElevenLabs calls (budget eight), six clips kept, 8.4 s in all; each trimmed, faded, mono 44.1 kHz 128 kb/s and
levelled to about -20 LUFS with the peak at or under -4.6 dB:

| clip | what | length | used |
| --- | --- | --- | --- |
| `fx/stars-howl` | a distant ghostly wolf howl | 1.75 s | the wolf comes alive |
| `fx/stars-hiss` | a big snake's hiss | 1.10 s | the serpent coils; its end again on the strike |
| `fx/stars-grind` | a heavy stone wheel grinding, slowing | 1.30 s | the wheel turns (cut to end at the lock) |
| `fx/stars-beam` | a bright crystalline beam with a humming body | 1.20 s | the wheel fires |
| `fx/stars-rumble` | a deep rumble swelling as something huge rises | 1.90 s | the giant rises under its trace |
| `fx/stars-implode` | a shimmering whoosh pulled inward, ending dead (baked reversed) | 1.15 s | the nova gathers the sky (ends on the drop) |

Reused for the new beats: the tick (the wheel's ratchet, the lock, the crouch, the fist going up), the rise (the
crouch, the fist, the gather), the boom (the lock's clunk; the giant and the nova land a little heavier), the thrum (the
wolf's spring, the giant's swing, the nova's drop), the slowed whoosh (the leap, the fist) and the falling whistle (the
nova's drop, and the arrow from high above).

Levels, measured not heard (each look played with sound in headless Chrome, the output tapped, "own" = after the damage
formation): Tier 4 written -30.8 dB mean (impact window -24.2), wheel -31.1 (-25.3), giant -29.0 (-23.0), nova -30.5
(-23.3); Tier 3 hunter -31.8, wolf -31.4, serpent -33.3 (the hiss and the beam were raised a little after this, not
re-measured); Tier 1 from high above -33.2. The second pass matched written to Frost IV at -30.9.

## Verified in this pass

- `npx vitest run packages/ui/src/heroStars packages/ui/src/heroAttack packages/ui/src/audio`: `heroStars.test.ts` is
  now 39 tests (new: the roll is stable and every option turns up and is forceable; each variation keeps its tier's
  timeline; every variation's figure on every layout lights before it draws, fills its slots, stays on screen at rest,
  at full draw and turned, and lands on the struck portrait; the five launch places are distinct and cover neither
  portrait on the real layout; the riders land (the wolf whole, the serpent with its tail anchored, the giant's fist
  coming down); the wheel locks with the marker in the pointer before it fires; the nova gathers; every variation in
  both directions lands once, stays under the sprite cap and puts everything back). The tier-button assertion only
  checks the "(3)" to "(40)" parts, so it holds whichever labels the shared builder uses.
- One shared failure, NOT from this attack: `phoneAudioQuality.test.ts` "a busy game's working set fits the phone
  LRU" fails on the merged batch branch. It counts the two largest attack styles; those are warhost (24.4 s) and
  wrestle (18.1 s). Stars is third at 17.9 s, so its clips do not enter the sum (but it would if either shrank).
- `npm run typecheck` clean; `npm run lint` 0 errors, no warnings in this attack's files.
- Contact sheets read for every variation: the five launch places at Tier 1 (you striking) and Tier 2 (the foe
  striking), the wolf and the serpent in both directions, and the wheel, the giant, the nova and written in the stars
  in both directions. Nothing left on screen, no portrait left moved.
- Perf, DEV build, headless Chrome with a screencast running: median 4.2 ms on every look, p99 12.5 to 16.7 ms on the
  Tier 4 variants (worst frames 41 to 54 ms, at the shared start and teardown as in the earlier passes). Not measured on
  a production build.

## Still weak or not done

- Nobody has heard the new sounds; placed and levelled by measurement only.
- When you strike, the struck portrait sits on the top edge, so the giant's fist comes over the top of the sky at a
  shallow angle (a reach more than a hammer blow); it comes straight down when the foe strikes you.
- The nova's blow washes the whole sky white for a frame or two (the sky flash plus its bloom); deliberate, but heavy.
- The wolf's tail tip can brush the screen edge under the camera's push when it is traced in a corner.
- The variations are not in `KNOCKOUT_VARIANT_STYLES` either; a knockout plays whichever Tier 4 finisher rolls.
