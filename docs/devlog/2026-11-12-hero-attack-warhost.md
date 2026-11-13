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

Four looks on the shared damage tiers (a knockout always plays IV). The host always comes from the striker's side:
every path is built from the two portrait points, so both directions play the same.

- **I, the spearman:** one spearman patters out from the striking hero (a dust puff a step), plants his feet, winds up
  and THROWS; the spear arcs and sticks in the struck portrait's rim with a twang (the blow). He gives a two-hop cheer
  and runs home empty-handed.
- **II, the archers:** seven archers jog out and form a line across the way to the target, draw together (a held
  beat), and loose twice: fourteen arrows arc high and come down on the struck portrait in a patter, each sticking at
  its own angle. Every arrow before the last is a tick; the last is the blow. They jog home.
- **III, the cavalry:** a war horn, then a wedge of ten riders (1, 2, 3, 4) charges from behind the striker at one
  steady pace, kicking up dust, and rides THROUGH the struck portrait. The point rider is the blow; each row after it
  buffets the portrait (knocked side to side). They wheel off screen.
- **IV, the host:** three war drums (a banner rises round the striking hero on each), the long horn, then the full
  host floods across: sixteen ranks of eleven foot (176), six riders on each flank, two volleys of fourteen arrows
  overhead, funnelling to half its width over the struck portrait. The front rank is the blow; the ranks after it
  buffet and shudder the portrait and bury it in dust. When the last rank has passed and the dust thins, one soldier
  runs in carrying a banner and PLANTS it on the struck portrait; it snaps in the wind for a beat, he cheers, and
  everything clears.
- **Knockout (the Ancient "Tier V"):** IV remixed: three more soldiers stay to cheer round the banner, a prismatic
  shock on the front rank's hit, a 1.3x shake, the shared short slow-mo dip (never a freeze) and the KO sting.

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

Seven ElevenLabs calls, six clips kept, 6.21 s in all (`packages/ui/src/audio/fx/warhost-*.mp3`; mono, 44.1 kHz,
128 kb/s; trimmed to the event with short fades; the three long ones levelled to -20 LUFS, the three short hits
peak-normalised under -1 dB since LUFS is undefined below 400 ms):

| clip | length | used for | measured |
| --- | --- | --- | --- |
| `warhost-horn` | 1.60 s | III (pitched up, cut to 1.15 s), IV (pitched down) | steady from 0.14 s to 1.1 s, gone by 1.45 s |
| `warhost-drum` | 0.62 s | IV, three times, each lower and louder | peak at 34 ms |
| `warhost-charge` | 1.90 s | IV at the march (the battle cry and feet); quietly under III | full from the start to 1.75 s |
| `warhost-gallop` | 1.45 s | III at the march; quietly under IV | peak at 77 ms, hooves to 1.3 s |
| `warhost-loose` | 0.22 s | II (twice, the second 90 ms later), IV's volleys | peak at 61 ms |
| `warhost-thunk` | 0.42 s | the spear, every other arrow (higher, softer), the banner pole | peak at 87 ms: cued from 55 ms in |

The seventh call was a second try at an "arrow volley whoosh and patter": both tries came back as two separate
knocks with a second of silence between them, so the patter is made in code instead (the thunk cued on every other
arrow) and the bowstring snap was cut from the first try. Reused shared clips: the swish (the spear leaving the hand,
arrows in the air, the flag), the ground impact (the charge striking, each buffet), the cinematic boom (under III and
IV's blow) and the crowd `cheering` clip pitched up 1.5x and trimmed to under a second (a tiny cheer).

## Verified

- `npx vitest run packages/ui/src/heroWarhost packages/ui/src/heroAttack packages/ui/src/audio`: 22 files, 891 tests
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
- The struck portrait sits in a corner in the real layout, so III's wheel-off and most of IV's exit happen off
  screen almost at once; the charge reads on the way in.
- The run cycle is two frames with a bob. Up close (the 2x spearman) it is a little stiff.
- IV runs about 3.5 s after the formation, longer than the source attack's 3.2 s.
