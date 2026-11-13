# 2026-11-12: Warhost, the Ancient of War's hero attack (style `warhost`, Ancient, dev-only)

One of the sixteen attacks built in parallel on `feat/hero-attacks-16` (scaffolded from `bullettime` by
`npm run attack:new`; nothing of the bullet-time look is left). The style is still DEV-ONLY: no cosmetic, no patch
note. It plays through the dev "Attack style" override and its tuner (Dev menu, "Hero Attack: Warhost").

## The signature

A SILLY ARMY OF TINY SOLDIERS delivers the blow (reworked in the third pass, 2026-11-13; see the end). Small painted
figures in the Ancient of War's colours (red `#ff5a4f` and brass): helmeted foot soldiers with round red shields and
spears, hooded archers, riders on caparisoned horses, little blue-robed MAGES in floppy hats, DRUMMERS, red banners.
The figures are deliberately plain sprites; everything they DO is live Pixi: spell heads with flame and frost trails,
lightning that re-forks every 45 ms, glowing rune circles on the ground, bursts, rings, sparks, smoke and dust. The army
grows more absurd and more powerful with every tier.

## What each look does

(As it is NOW, after the third pass.)

Four looks on the shared damage tiers (a knockout always plays Tier 4). The host always comes from the striker's side:
every path is built from the two portrait points, so both directions play the same.

- **Tier 1, the eager recruit:** one spearman sprints out, TRIPS flat on his face (a burst of dust, a clink of tin,
  three dizzy stars circling his head; the striking hero cringes), lies there half a second, scrambles up, plants his
  feet and throws anyway; the spear streaks in on a brass trail and sticks in the struck face with a twang (the blow).
  A two-hop cheer, then home. 2.2 s.
- **Tier 2, the squad:** six archers jog out and form a line; a seventh runs the WRONG way, off past the far end of the
  line, and stands there looking one way and then the other while the line draws and looses a rain of twelve trailing
  arrows (ticks). Then "Wait for me!" (a tiny pitched-up voice), a sprint back along the line, and the LAST arrow is
  his: a big golden one with a gold trail and glint, the blow. One of the squad cheers; they jog home. 2.6 s.
- **Tier 3, the cavalry and the mages:** a war horn; two little mages pop out side by side on glowing rune circles and
  BICKER (face to face, taking turns jabbing their staffs and spitting sparks, squeaky gibberish), then their circles
  flare and both cast: a FIREBALL (a white-hot core in an orange halo, shedding flame and smoke, the roar timed to peak
  as it lands; it bursts and singes the portrait) and LIGHTNING (a forking bolt, a crack and a zap). A tiny "Charge!",
  and the wedge of ten riders rides through the struck portrait (the point rider is the blow) and wheels home. 2.5 s.
- **Tier 4, the whole absurd host:** a drum line of four beside the hero hammers four quickening war drums (sticks
  down on every beat, a ring off each skin) while banners rise; five mages pop out in an arc on rune circles, two of
  them squabbling; the horn, the circles flare, two tiny voices yell "Charge!", and the host floods across with the
  view PANNING along its front: seventeen ranks of eleven, cavalry on the flanks, three volleys of eighteen arrows
  darkening the sky (a deeper dim), the mages' first round (fire, frost, lightning, fire, frost) landing over the last
  of the charge with the view PUSHING IN, then their second round, all five at once, plus a flaming CATAPULT BOULDER
  lobbed from off screen on a comet tail of fire and smoke, all landing with the front rank (the blow): the boulder
  bursts into spinning chunks, the portrait is buried in dust, poked with arrows and singed (a scorch, smoke wisps,
  embers). A straggler who ran the wrong way sprints after the host ("Wait for me!"), and one TINY soldier plants a
  huge banner while the ones who stayed cheer. 4.4 s.
- **Knockout ("Tier 5"):** Tier 4 remixed: seven stay to cheer, a prismatic shock on the blow, a 1.3x shake, the shared
  short slow-mo dip (never a freeze) and the KO sting.

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
| `warhost-horn` | 1.60 s | Tier 3 (pitched up, cut to 1.15 s), Tier 4 (pitched down) | re-levelled 8.8 dB up in the second pass (its peak was -10 dB); steady from 0.14 s to 1.1 s |
| `warhost-drum` | 0.62 s | Tier 4: the four war drums (each lower and louder), the roll under the horn, the marching beat under the host, the banner going in | a 90 Hz hit, peak at 34 ms |
| `warhost-charge` | 1.90 s | Tier 4 at the march, twice and overlapping, so the roar lasts the crossing and the trample; quietly under Tier 3 | re-levelled 7.1 dB up; a 1.1 kHz roar, full from the start to 1.75 s |
| `warhost-gallop` | 1.45 s | Tier 3 at the march (twice, overlapping); under Tier 4 for the flanks | hooves to 1.3 s |
| `warhost-loose` | 0.22 s | the bowstrings (Tier 2 twice, Tier 4's volleys); low and quiet, the draw; the snap of the spear throw | peak at 61 ms |
| `warhost-thunk` | 0.42 s | the spear, every other arrow, a hoof or boot per later row or rank, the banner pole; high and short, footsteps | peak at 87 ms: cued from 55 ms in |
| `warhost-volley` | 1.34 s | NEW. Tier 2's arrow rain and Tier 4's two volleys | the hiss of arrows in the air for 400 ms (4.5 kHz), then a patter of fourteen knocks thinning out over 800 ms |
| `warhost-clash` | 1.72 s | NEW. The charge striking (Tier 4 whole, Tier 3 the first second) | a dense clatter of steel, shields and shouting, about -6 dB RMS for 1.5 s |
| `warhost-flap` | 0.60 s | NEW. The banner snapping open | two flaps of heavy cloth (150 to 300 Hz) at 100 and 400 ms |

The VOLLEY, which the first pass could not get: the third generated take again came back as one whoosh and one knock
with silence between. So the clip is BUILT: the whoosh from that take (slowed to 0.8x) for the arrows in the air, then
fourteen copies of the thunk at fixed times, pitches and levels for the patter. It is cued so its patter starts as the
first arrow lands. The first pass's per-arrow thunk still plays under it, quieter.

The GROUND RUMBLE under Tier 3 and Tier 4 is a synth (`playRumble`, the one the Quake attack uses: filtered brown noise), not
a clip: it builds as the charge crosses, holds while the rows or ranks pass, and dies after the last.

Reused shared clips: the swish (the spear in the air, the flag), the ground impact (the charge striking, each buffet,
the banner), the cinematic boom (under Tier 3 and Tier 4's blow) and the crowd `cheering` clip (the spearman's tiny cheer
pitched up; on Tier 4 the cheer of the ones who stayed, at 1.2x and much louder than the first pass).

Measured in play (the attack played with sound in headless Chrome, the output tapped and cut into 100 ms windows, RMS
in dBFS; "own" is from the attack's first beat to 400 ms after its end, so the shared damage formation is left out):

| | own RMS, first pass | own RMS, now | loudest own window now |
| --- | --- | --- | --- |
| Tier 4, the host | -27.5 dB | -20.1 dB | -14.7 (the blow; -15 to -17 for 600 ms) |
| Tier 3, the cavalry | -29.2 dB | -23.3 dB | -18.6 |
| Tier 2, the archers | -31.4 dB | -26.3 dB | -20.0 |
| Tier 1, the spearman | -30.3 dB | -27.3 dB | -17.3 |
| Soccer Tier 4 / Frost Tier 4 | | -28.3 / -27.7 dB | -22.8 / -21.6 |
| Storm Call Tier 4 | | -22.6 dB | -17.9 |

Tier 4, beat by beat: the drums -20 to -27 (each louder), the horn and the roll -18 to -20, the charge -19 to -22 for
900 ms, the blow and the trample -15 to -17, a dip to -26 as the dust thins (200 ms), the banner -15 to -18, the cheer
-18 to -26 for 800 ms. No stretch of Tier 4 with action on screen is under -27 dB. Tier 1 and Tier 2 are quiet for their first
half second (a tiny man's footsteps, -27 to -40 dB) on purpose. Tier 4 is the loudest attack measured here: if that is
too much, `sfxChargeGain`, `sfxRumbleGain` and `sfxDrumGain` bring the crossing down without touching the blow.

Nobody has LISTENED to any of this: every level and offset is measured from the recorded output.

## Verified

- (First pass.) `npx vitest run packages/ui/src/heroWarhost packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 891 tests
  green (32 of them this attack's own: plan and cue timing per look, both directions, staging on screen, the blow
  landing exactly once, every exit (the end, `finish()`, `cancel()` before and mid-trample, the safety timer)
  restoring both portraits' transform, opacity, filter and class and the camera, determinism from the seed, the atlas
  layout).
- LOOKED AT in headless Chrome (1920x1080, the Scene Builder, the tuner's demo with the clock stepped by hand to exact
  sequence times): contact sheets of all four looks with you striking, Tier 4 with the foe striking, Tier 1 with the foe
  striking and the Knockout. After every run: no updater left hooked, `#stage` transform empty, no portrait left moved.
  Fixed from the sheets: soldiers too small to read alone, the stuck spear hidden behind the hit number and the health
  plate (the strike point is now swung to the top of the rim), dust puffs reading as a row of beads, the trample dust
  reading as one flat disc, the rally banners falling off screen behind a corner portrait, flat arrow arcs.
- Frame times (DEV build, headless, while fifteen other builders' servers and browsers shared the machine, so the
  totals are noise-bound): the attack's OWN step per frame (cues, DOM paint, placing every sprite, the pool update)
  measured median 0.2 ms, 99th percentile 0.4 to 0.6 ms, worst 1.5 ms on Tier 4 and the Knockout (189 to 192 soldiers,
  about 500 pooled sprites). Whole-frame deltas on Tier 4: median 5.8 ms, 99th percentile 12 to 35 ms, worst 44 to 327 ms
  across runs, with the worst frame about 100 ms after the formation ends in every run; the source attack
  (`bullettime`) measured the same way in the same session gave median 5.8 to 6.0 ms, 99th percentile 23 to 35 ms,
  worst 51 to 88 ms, and tier Tier 1 (ONE soldier) gave the same spikes. So the over-budget frames seen are not from the
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
last the crossing, footsteps and a draw for the small looks, a body under every blow, and a real cheer. Tier 4's own sound
went from -27.5 to -20.1 dB RMS.

**The charge shakes the screen as it passes (Tier 3, Tier 4).** The rumble used to start 420 ms before the blow at 16 percent
of the blow's shake; it now starts when the charge sets out and grows all the way across to 34 percent (Tier 4) or 24
percent (Tier 3), about 10 px and 5 px. The blow's shake is 30 px on Tier 4 (was 24) and 22 px on Tier 3 (was 16), on a slower,
longer spring.

**A rolling dust wall (Tier 3, Tier 4).** Every 44 ms while the charge crosses, big soft clouds are thrown up along its
front and carried forward with it (Tier 4 also along the body of the host), so the host comes out of its own dust. The
first pass had only the step puffs.

**The struck portrait is battered about.** Knocked 30 px (was 20) on a slower spring; each later row or rank throws
it 0.7 of a knock to one side (was 0.45), tips it 4.2 degrees (was 2.4) and squashes it again; it shudders 6 px under
the host (was 3) and now under the cavalry too; and a white flash and a red glow light it on the blow.

**The banner plant is a beat (Tier 4).** The banner is 2.3x a rally banner (was 1.6x; a little smaller under the top of
the screen so it never leaves the view), the plant kicks the view straight down and drives the portrait down 13 px,
with a flash, two ground rings, a ring of dust, sparks and a glint; four soldiers stay and cheer round it (seven on
the Knockout, which had three); the flag flies for 1050 ms (was 780).

**The drum build-up (Tier 4).** Four drums that quicken (gaps of 330, 271 and 211 ms) instead of three at an even 290, a
banner and a thump of the view on each, the horn 70 ms after the last with a drum roll under it, and the host setting
out 200 ms into the horn.

**Running time of Tier 4:** 3515 ms before, 4289 ms now (Soccer Tier 4 3308, Frost Tier 4 3083). The blow lands once, 1935 ms in
(was 1615): 320 ms more build-up before it, 450 ms more aftermath after it. Tier 3: 1786 ms before, 2028 now. No hit-stop.

**The two notes from the first pass.**
- The stuck spear on Tier 1 was partly covered by a lobby rail orb: the orbs sit ON the rim of a corner portrait. The spear
  now sticks in the face, 0.4 of a radius from the centre (was 0.66), where nothing covers it.
- The cavalry's wheel-off on Tier 3 happened off screen. They now ride through the portrait, turn just beyond it and ride
  home round both sides of it across the board (see Tier 3 above), all on screen.

### Verified (second pass)

- `npx vitest run packages/ui/src/heroWarhost packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 898 tests, all passing (36 tests in
  `heroWarhost.test.ts`: the quickening drums and the build-up, the new running time, the wheel home on screen in both
  directions, the spear on the face, the rally banners and the big planted one fitting the view, the cheerers, the
  rumble growing across the charge, the plant's kick, the portrait thrown and tipped through the trample, the clip
  list). `npm run typecheck` clean. `npm run lint` 0 errors, no warning in these files.
- Looked at in headless Chrome at 1920 x 1080 (real-time screencast, sound off): Tier 4 in both directions and a close-up
  of the banner plant, Tier 3, Tier 2, and a close-up of Tier 1's spear. After every run both portraits and the stage had no
  transform left.
- Frame times, DEV build, headless Chrome, vsync off, no capture. Tier 4, three runs (two you, one the foe): median 0.6 ms,
  99th percentile 3.4 to 3.9 ms, worst 17 to 18 ms. The worst frames are the shared opening and teardown in every run,
  plus a few isolated 15 to 17 ms frames mid-charge that moved from run to run. The attack's own per-frame step: 0.3 to
  0.4 ms at the 99th percentile, 1.1 to 2.3 ms at worst. Tier 3: 99th percentile 4.5 ms, worst 20 ms; its own step worst
  2.4 ms. Not measured on a production build.

### Still weak or unverified

- Unheard (see Sound). Tier 4 is deliberately the loudest attack measured.
- The built volley is a whoosh and a fixed patter; an ear may find the patter mechanical.
- On Tier 3 the ride home is thin: ten riders fan out and fade over about 400 ms. It reads as a wheel, not as a spectacle.
- The dust over the host lowers the contrast of the soldiers a little while they cross.
- On Tier 1 the spear's shaft still passes under the hit number for the first 400 ms.
- Tier 4 is about a second longer than the shipped top looks.
- The run cycle is still two frames. Not seen on a real display, a phone, or in the Collection preview.

## Third pass (2026-11-13): silly, over the top, and a magic army

The owner's note: "Warhost - this one is pretty bad. it should be a silly one, so make it more over the top and
ridiculous. add more whimsy, like the army gets more powerful too with mages etc casting pixi animations". So this
pass reworks the feel and keeps the tiny-army idea. What each tier does now is in "What each look does" above.

**Tier names.** Tuner groups, labels, hints, comments, tests and this devlog say Tier 1 to Tier 4 (a test fails on a
roman numeral or Small/Medium/Huge in this attack's own controls). The shared tier BUTTON labels come from
`heroAttack/rareTuner.ts`, which another builder is renaming.

**New in the staging** (`heroWarhostConfig.ts`): a soldier's script can take a DETOUR (`via`: tripped flat, or lost
and looking about) on the way out; mages (with their school, cast times and a bicker window facing each other);
drummers (beating `plan.beats`: the war drums, then the march); spells (`Spell`: fire and frost fly a lifted arc,
lightning strikes in 70 ms and stays lit 230 ms, the boulder is lobbed from off screen behind the striker); a
straggler in the host; a golden last arrow on Tier 2. The plan has the trip, the straggler, the mages, the bicker, the
rune flare, every spell (`castAt`, `landAt`, round), the charge cry and the drum beats; early spells are ticks, the
second round lands on the blow, and the impact cue fires before them (the consequence still lands exactly once).

**New in the scene** (all live Pixi on the shared pool): the rune circles (the arcane sigil in a holder squashed onto
the ground so it turns in the ground's plane, a soft pool of light under it, breathing, flaring on each cast), the lit
staff gems, bicker sparks, the fireball and frost heads and their trails (shed every 18 ms of sequence time and spread
along the path travelled, so a fast head leaves an unbroken tail), lightning as nine stretched beam segments re-forked
from a hash every 45 ms, the boulder (a painted rock spinning inside a fire halo), the spell bursts (fire: flame,
rings, embers, smoke and a SINGE that darkens the portrait for a second; frost: shards, snow, a cold glow; lightning: a
white flash and a spray of sparks; the boulder: chunks of itself, a dust cloud, a ground ring), arrow and spear trails,
the dizzy stars, a startle over a lost soldier, a ring off every drum skin. Four new atlas cells (the mage standing and
casting, the drummer two ways, the archer's cheer) and the boulder.

**Camera.** Tier 3 and Tier 4 now PAN with the front of the charge (the point the view is held on travels from the
striker to the target) with a little extra zoom; Tier 4 pushes in another 0.05 over the barrage's last 430 ms; each
early spell kicks the view; Tier 1's faceplant thumps it straight down.

**Sound.** Six new clips from six ElevenLabs calls (four effects, two spoken lines), 6.45 s in all, processed like the
others (trimmed, faded, mono, 44.1 kHz, 128 kb/s): `warhost-trip` (a stumble and a tin clatter, 0.6 s),
`warhost-bicker` (two squeaky wizards arguing in gibberish, 1.75 s, -21 LUFS), `warhost-fireball` (a fiery roar into a
burst, peak at 397 ms, 0.9 s), `warhost-boulder` (a crash of rock and earth, 1.7 s, -18 LUFS), `warhost-charge-vo`
("Chaaaarge!", stock voice Charlie, 0.8 s) and `warhost-wait-vo` ("Wait for meee!", 0.7 s), both played pitched up
(1.35x, 1.4x) so the soldiers sound tiny. Reused shared clips: `castspell` (the circles), `turnexplosion` (a fireball
bursting), `freezetavern` and `rebornshatter` (frost), `crit` and `fx/blue-impact-hit` (lightning), the long cartoon
woosh (the boulder whistling in). A school's sound plays once per landing moment, so the second round is one roar,
not five. Measured from the recorded output (headless Chrome, the tuner demo with sound): Tier 4's own sound (from
its first drum to its end) -21.5 dB RMS, peak -7.4 dB (second pass -20.1); Tier 1 -26.0 dB (second pass -27.3).
NOBODY HAS HEARD ANY OF THIS: levels are measured, not heard.

**Running times:** Tier 1 2173 ms (was 1.6 s: the faceplant), Tier 2 2608 ms, Tier 3 2549 ms (the bicker), Tier 4
4373 ms (was 4289). The blow on Tier 4 lands 2019 ms after the formation.

### Verified (third pass)

- `npx vitest run packages/ui/src/heroWarhost packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 904 tests
  passed; `audioDefaultMix.test.ts` hit a 10 s hook timeout under load in that run and passed on its own re-run.
  `heroWarhost.test.ts` now has 42 tests (the trip, the straggler, the mages and spells on screen in both directions,
  the barrage, the boulder off screen, the pan and the push in, the scene's spells and runes, every exit, Tier names).
- `npm run typecheck` clean; `npm run lint` 0 errors (149 warnings, none in these files).
- Looked at in headless Chrome at 1920 x 1080 (the tuner demo, the clock stepped by hand): sheets of every tier with
  you striking, Tier 4 with the foe striking, the Knockout, and a close-up of the faceplant. Fixed from them: the mages
  bunched in a column on the screen edge (now an arc round the striker), the Tier 3 pair too far apart to bicker, the
  lightning too thin and faint, the fireballs reading as a string of beads, the boulder's arc above the top of the
  screen, the straggler's "wrong way" spot off screen behind a corner portrait, dizzy stars too small to see.
- Frame times (DEV build, headless, a machine shared with other builders): Tier 4, four runs: median 4.2 ms, 99th
  percentile 17 to 29 ms, worst 67 to 412 ms (the worst at about 100 ms after the formation, the shared opening, in
  three runs of four). The same harness gives Tier 1 (one soldier) a 99th percentile of 25 ms, and Tier 4 with the mages
  and boulder turned off 17 ms, so these are noise-bound. The attack's OWN step per frame on Tier 4 (cues, DOM, placing
  every sprite, the pool): median 0.2 ms, 99th percentile 2.0 ms, worst 3.8 ms, at the blow (ten spell bursts, the
  boulder and the impact spawn in one frame). Not measured on a production build.

### Still weak or unverified (third pass)

- Unheard. The bicker and the voices are generated takes nobody has listened to; the "Charge!" may be too long a
  drawl at 1.35x.
- At the blow, a corner portrait hides much of the barrage's landing under the hit number and the screen edge.
- The mages and drummers crowd the striking portrait when it sits in a corner (clamped to the screen).
- The dust over the host still lowers the soldiers' contrast; the volleys "darken the sky" only through a deeper dim.
- Tier 1's faceplant happens close to the striker, partly under the Ancients slot that sits beside a corner portrait.
- Spawning at the blow is the attack's worst frame (3.8 ms of its own work); if it shows on a phone, cut the second
  round's burst size (`spellSize`) or the boulder.
