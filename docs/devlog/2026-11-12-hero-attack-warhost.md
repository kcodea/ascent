# 2026-11-12: Warhost, the Ancient of War's hero attack (style `warhost`, Ancient, dev-only)

One of the sixteen attacks built in parallel on `feat/hero-attacks-16` (scaffolded from `bullettime` by
`npm run attack:new`; nothing of the bullet-time look is left). The style is still DEV-ONLY: no cosmetic, no patch
note. It plays through the dev "Attack style" override and its tuner (Dev menu, "Hero Attack: Warhost").

## The signature

AN ARMY OF TINY SOLDIERS delivers the blow. Small painted figures in the Ancient of War's colours (red `#ff5a4f` and
brass): a helmeted foot soldier with a round red shield and a spear, a hooded archer, a rider on a caparisoned horse
with a lance and pennant, a red banner with a gold sword. No other attack has crowds of little people, and nothing in
this one is a beam, a bolt or a glow: it is men, horses, spears, arrows, banners and dust.

## What each look does

(As it is NOW, after the second pass; see "Second pass" at the end for what changed and why.)

Four looks on the shared damage tiers (a knockout always plays IV). The host always comes from the striker's side:
every path is built from the two portrait points, so both directions play the same.

- **I, the spearman:** one spearman patters out from the striking hero (a dust puff a step), plants his feet, winds up
  and THROWS; the spear arcs and sticks in the struck portrait's rim with a twang (the blow). He gives a two-hop cheer
  and runs home empty-handed.
- **II, the archers:** seven archers jog out and form a line across the way to the target, draw together (a held
  beat), and loose twice: fourteen arrows arc high and come down on the struck portrait in a patter, each sticking at
  its own angle. Every arrow before the last is a tick; the last is the blow. They jog home.
- **III, the cavalry:** a war horn, then a wedge of ten riders (1, 2, 3, 4), drawn 1.3x the host's flank cavalry,
  charges from behind the striker at one steady pace behind a rolling wall of dust, the ground shaking harder the nearer
  it comes, and rides THROUGH the struck portrait. The point rider is the blow; each row after it batters the portrait
  (thrown side to side, tipped, squashed). Just beyond the portrait the wedge splits in two and wheels HOME round both
  sides of it, back across the board, on screen.
- **IV, the host:** FOUR war drums, each sooner than the last (a banner rises round the striking hero on each, the view
  thumps), the long horn with a drum roll under it, then the full host floods across behind its own wall of dust with a
  marching drum under it: seventeen ranks of eleven foot (187), six riders on each flank, two volleys of fourteen arrows
  overhead, funnelling to half its width over the struck portrait, the whole view rumbling. The front rank is the blow;
  every third rank after it batters the portrait about and buries it in dust. When the last rank has passed and the
  dust thins, one soldier runs in and PLANTS A BIG BANNER on the struck portrait: a knock that kicks the view straight
  down and drives the portrait down with it, a ring of dust and two rings rolling out along the ground, the flag
  snapping open with a glint; the four who stayed with him cheer round it for a second, and everything clears.
- **Knockout (the Ancient "Tier V"):** IV remixed: seven stay to cheer round the banner, a prismatic shock on the
  front rank's hit, a 1.3x shake, the shared short slow-mo dip (never a freeze) and the KO sting.

## How

- `heroWarhostConfig.ts`: the tuned values, the pure timeline (`warhostPlan`, `warhostCues`), the pure STAGING
  (`warhostStage`: every soldier as a two-leg script `p0 -> p1 (hold) -> p2`, every spear and arrow as a lifted
  quadratic, every banner), the pure per-frame samplers (`troopAt`, `shotAt`, writing into a reused object) and the
  pure camera. Formation jitter (place in the rank, size, stride) comes from the blow's seed (`rollSeed`, or a seed
  from the total, the distance and the side), never `Math.random`.
- `heroWarhostTextures.ts`: ONE atlas canvas, painted once per session (20 cells: 8 foot frames, 5 archer frames, 2
  rider frames, 2 banner frames, the spear, the arrow, a dust puff), full colour with a dark outline, a top-left
  highlight and a baked contact shadow. One texture source, so the whole host batches together.
- `heroWarhostScene.ts`: on the shared `FxPool`. `deploy()` takes one sprite per soldier, shot and banner up front
  (while the damage formation still plays), in draw order (far to near); `paint(t)` places them from the clock with a
  two-frame run cycle, a bob, a lean and a flip, and allocates nothing. Dust is the only particle (step puffs from
  some of the soldiers, clouds over the trample), pooled and capped at 900 sprites.
- `heroWarhost.ts`: the runner on the shared core (one clock, the damage formation, the `#stage` camera applied once,
  the portrait movers, the voices, finish / cancel / the safety timer). Every exit calls the same teardown.
- The lone spearman (2x) and the archers (1.45x) are drawn bigger than a soldier of the host (46 px): one figure has
  to read alone next to a 270 px portrait. That is larger than the 28 to 44 px in the brief; it is one constant each
  (`WARHOST_SPEARMAN_SIZE`, `WARHOST_ARCHER_SIZE`) and the `Soldier height` dial if the owner wants them smaller.

## Sound

Rebuilt in the second pass from measurements. Nine clips of its own, about 10 s in all (10.2 s by file length) (`warhost-*.mp3`; mono, 44.1 kHz,
128 kb/s), from ten ElevenLabs calls across both passes (three in the second).

| clip | length | used for | measured |
| --- | --- | --- | --- |
| `warhost-horn` | 1.60 s | III (pitched up, cut to 1.15 s), IV (pitched down) | re-levelled 8.8 dB up in the second pass (its peak was -10 dB); steady from 0.14 s to 1.1 s |
| `warhost-drum` | 0.62 s | IV: the four war drums (each lower and louder), the roll under the horn, the marching beat under the host, the banner going in | a 90 Hz hit, peak at 34 ms |
| `warhost-charge` | 1.90 s | IV at the march, twice and overlapping, so the roar lasts the crossing and the trample; quietly under III | re-levelled 7.1 dB up; a 1.1 kHz roar, full from the start to 1.75 s |
| `warhost-gallop` | 1.45 s | III at the march (twice, overlapping); under IV for the flanks | hooves to 1.3 s |
| `warhost-loose` | 0.22 s | the bowstrings (II twice, IV's volleys); low and quiet, the draw; the snap of the spear throw | peak at 61 ms |
| `warhost-thunk` | 0.42 s | the spear, every other arrow, a hoof or boot per later row or rank, the banner pole; high and short, footsteps | peak at 87 ms: cued from 55 ms in |
| `warhost-volley` | 1.34 s | NEW. II's arrow rain and IV's two volleys | the hiss of arrows in the air for 400 ms (4.5 kHz), then a patter of fourteen knocks thinning out over 800 ms |
| `warhost-clash` | 1.72 s | NEW. The charge striking (IV whole, III the first second) | a dense clatter of steel, shields and shouting, about -6 dB RMS for 1.5 s |
| `warhost-flap` | 0.60 s | NEW. The banner snapping open | two flaps of heavy cloth (150 to 300 Hz) at 100 and 400 ms |

The VOLLEY, which the first pass could not get: the third generated take again came back as one whoosh and one knock
with silence between. So the clip is BUILT: the whoosh from that take (slowed to 0.8x) for the arrows in the air, then
fourteen copies of the thunk at fixed times, pitches and levels for the patter. It is cued so its patter starts as the
first arrow lands. The first pass's per-arrow thunk still plays under it, quieter.

The GROUND RUMBLE under III and IV is a synth (`playRumble`, the one the Quake attack uses: filtered brown noise), not
a clip: it builds as the charge crosses, holds while the rows or ranks pass, and dies after the last.

Reused shared clips: the swish (the spear in the air, the flag), the ground impact (the charge striking, each buffet,
the banner), the cinematic boom (under III and IV's blow) and the crowd `cheering` clip (the spearman's tiny cheer
pitched up; on IV the cheer of the ones who stayed, at 1.2x and much louder than the first pass).

Measured in play (the attack played with sound in headless Chrome, the output tapped and cut into 100 ms windows, RMS
in dBFS; "own" is from the attack's first beat to 400 ms after its end, so the shared damage formation is left out):

| | own RMS, first pass | own RMS, now | loudest own window now |
| --- | --- | --- | --- |
| IV, the host | -27.5 dB | -20.1 dB | -14.7 (the blow; -15 to -17 for 600 ms) |
| III, the cavalry | -29.2 dB | -23.3 dB | -18.6 |
| II, the archers | -31.4 dB | -26.3 dB | -20.0 |
| I, the spearman | -30.3 dB | -27.3 dB | -17.3 |
| Soccer IV / Frost IV | | -28.3 / -27.7 dB | -22.8 / -21.6 |
| Storm Call IV | | -22.6 dB | -17.9 |

IV, beat by beat: the drums -20 to -27 (each louder), the horn and the roll -18 to -20, the charge -19 to -22 for
900 ms, the blow and the trample -15 to -17, a dip to -26 as the dust thins (200 ms), the banner -15 to -18, the cheer
-18 to -26 for 800 ms. No stretch of IV with action on screen is under -27 dB. I and II are quiet for their first
half second (a tiny man's footsteps, -27 to -40 dB) on purpose. IV is the loudest attack measured here: if that is
too much, `sfxChargeGain`, `sfxRumbleGain` and `sfxDrumGain` bring the crossing down without touching the blow.

Nobody has LISTENED to any of this: every level and offset is measured from the recorded output.

## Verified

- (First pass.) `npx vitest run packages/ui/src/heroWarhost packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 891 tests
  green (32 of them this attack's own: plan and cue timing per look, both directions, staging on screen, the blow
  landing exactly once, every exit (the end, `finish()`, `cancel()` before and mid-trample, the safety timer)
  restoring both portraits' transform, opacity, filter and class and the camera, determinism from the seed, the atlas
  layout).
- LOOKED AT in headless Chrome (1920x1080, the Scene Builder, the tuner's demo with the clock stepped by hand to exact
  sequence times): contact sheets of all four looks with you striking, IV with the foe striking, I with the foe
  striking and the Knockout. After every run: no updater left hooked, `#stage` transform empty, no portrait left moved.
  Fixed from the sheets: soldiers too small to read alone, the stuck spear hidden behind the hit number and the health
  plate (the strike point is now swung to the top of the rim), dust puffs reading as a row of beads, the trample dust
  reading as one flat disc, the rally banners falling off screen behind a corner portrait, flat arrow arcs.
- Frame times (DEV build, headless, while fifteen other builders' servers and browsers shared the machine, so the
  totals are noise-bound): the attack's OWN step per frame (cues, DOM paint, placing every sprite, the pool update)
  measured median 0.2 ms, 99th percentile 0.4 to 0.6 ms, worst 1.5 ms on IV and the Knockout (189 to 192 soldiers,
  about 500 pooled sprites). Whole-frame deltas on IV: median 5.8 ms, 99th percentile 12 to 35 ms, worst 44 to 327 ms
  across runs, with the worst frame about 100 ms after the formation ends in every run; the source attack
  (`bullettime`) measured the same way in the same session gave median 5.8 to 6.0 ms, 99th percentile 23 to 35 ms,
  worst 51 to 88 ms, and tier I (ONE soldier) gave the same spikes. So the over-budget frames seen are not from the
  host's sprite count, but "no frame over 6.25 ms" is NOT proven: it needs a quiet machine and the production build.

## Not done / weak

- No cosmetic, no Collection entry, no patch note (by design: the coordinator adds those).
- Nobody has LISTENED to the sounds: levels and cue offsets are from measured envelopes only.
- The run cycle is two frames with a bob. Up close (the 2x spearman) it is a little stiff.

## Second pass (2026-11-12): an army that sounds like one, and a charge with weight

The owner played the batch: the attacks "need sound effects" and the big looks are "quick and not impactful". The
tiny soldiers stay (the idea reads at once); nothing new is drawn. What changed:

**Sound.** See "Sound" above (rewritten): three new clips (the volley, the clash, the flag), a synth ground rumble,
the drums used as a build-up, a roll and a marching beat, two overlapping takes of the roar and the hooves so they
last the crossing, footsteps and a draw for the small looks, a body under every blow, and a real cheer. IV's own sound
went from -27.5 to -20.1 dB RMS.

**The charge shakes the screen as it passes (III, IV).** The rumble used to start 420 ms before the blow at 16 percent
of the blow's shake; it now starts when the charge sets out and grows all the way across to 34 percent (IV) or 24
percent (III), about 10 px and 5 px. The blow's shake is 30 px on IV (was 24) and 22 px on III (was 16), on a slower,
longer spring.

**A rolling dust wall (III, IV).** Every 44 ms while the charge crosses, big soft clouds are thrown up along its
front and carried forward with it (IV also along the body of the host), so the host comes out of its own dust. The
first pass had only the step puffs.

**The struck portrait is battered about.** Knocked 30 px (was 20) on a slower spring; each later row or rank throws
it 0.7 of a knock to one side (was 0.45), tips it 4.2 degrees (was 2.4) and squashes it again; it shudders 6 px under
the host (was 3) and now under the cavalry too; and a white flash and a red glow light it on the blow.

**The banner plant is a beat (IV).** The banner is 2.3x a rally banner (was 1.6x; a little smaller under the top of
the screen so it never leaves the view), the plant kicks the view straight down and drives the portrait down 13 px,
with a flash, two ground rings, a ring of dust, sparks and a glint; four soldiers stay and cheer round it (seven on
the Knockout, which had three); the flag flies for 1050 ms (was 780).

**The drum build-up (IV).** Four drums that quicken (gaps of 330, 271 and 211 ms) instead of three at an even 290, a
banner and a thump of the view on each, the horn 70 ms after the last with a drum roll under it, and the host setting
out 200 ms into the horn.

**Running time of IV:** 3515 ms before, 4289 ms now (Soccer IV 3308, Frost IV 3083). The blow lands once, 1935 ms in
(was 1615): 320 ms more build-up before it, 450 ms more aftermath after it. III: 1786 ms before, 2028 now. No hit-stop.

**The two notes from the first pass.**
- The stuck spear on I was partly covered by a lobby rail orb: the orbs sit ON the rim of a corner portrait. The spear
  now sticks in the face, 0.4 of a radius from the centre (was 0.66), where nothing covers it.
- The cavalry's wheel-off on III happened off screen. They now ride through the portrait, turn just beyond it and ride
  home round both sides of it across the board (see III above), all on screen.

### Verified (second pass)

- `npx vitest run packages/ui/src/heroWarhost packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 898 tests, all passing (36 tests in
  `heroWarhost.test.ts`: the quickening drums and the build-up, the new running time, the wheel home on screen in both
  directions, the spear on the face, the rally banners and the big planted one fitting the view, the cheerers, the
  rumble growing across the charge, the plant's kick, the portrait thrown and tipped through the trample, the clip
  list). `npm run typecheck` clean. `npm run lint` 0 errors, no warning in these files.
- Looked at in headless Chrome at 1920 x 1080 (real-time screencast, sound off): IV in both directions and a close-up
  of the banner plant, III, II, and a close-up of I's spear. After every run both portraits and the stage had no
  transform left.
- Frame times, DEV build, headless Chrome, vsync off, no capture. IV, three runs (two you, one the foe): median 0.6 ms,
  99th percentile 3.4 to 3.9 ms, worst 17 to 18 ms. The worst frames are the shared opening and teardown in every run,
  plus a few isolated 15 to 17 ms frames mid-charge that moved from run to run. The attack's own per-frame step: 0.3 to
  0.4 ms at the 99th percentile, 1.1 to 2.3 ms at worst. III: 99th percentile 4.5 ms, worst 20 ms; its own step worst
  2.4 ms. Not measured on a production build.

### Still weak or unverified

- Unheard (see Sound). IV is deliberately the loudest attack measured.
- The built volley is a whoosh and a fixed patter; an ear may find the patter mechanical.
- On III the ride home is thin: ten riders fan out and fade over about 400 ms. It reads as a wheel, not as a spectacle.
- The dust over the host lowers the contrast of the soldiers a little while they cross.
- On I the spear's shaft still passes under the hit number for the first 400 ms.
- IV is about a second longer than the shipped top looks.
- The run cycle is still two frames. Not seen on a real display, a phone, or in the Collection preview.
