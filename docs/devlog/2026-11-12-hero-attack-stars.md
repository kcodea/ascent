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
