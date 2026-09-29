# 2026-09-28: Poison Darts, the sixth hero attack (Venom Volley, Legendary)

Owner ask (2026-09-28): "branch off and make a poison dart animation. the final one should throw multiple poison darts
that implode with poison".

Owner review of the first push: "the dart one is so good. great stuff." The look is approved as shipped (oracle
R-PROG-ATTACK-12).

Branched off `main` after Enraged (#1804), so it runs on the shared hero-attack core and the shared damage formation.
Nothing changes for players until the owner deploys `progression-inventory` (the catalog sync adds `attack_poison`).
The equip SQL already accepts the `hero_attack` slot, so there is no new migration.

## What shipped

**Poison Darts** (`packages/ui/src/heroPoison/`). The shared damage formation runs first. Then:

- **Ready.** The striking hero leans back from the target and swells a little. Venom gathers at the throwing hand as a
  glint that grows and turns. A soft venom halo closes on the portrait and droplets are drawn in to the hand.
- **Throw.** Each dart is flicked off the hero's rim toward the target with a snappy "thwip". It flies fast on a slight
  arc that rises toward the top of the screen and never leaves it, still accelerating into the target, and trails a
  thin toxic vapour. The hero flicks toward the target on every throw.
- **Thunk.** The dart sticks in the struck portrait at its own angle and quivers hard. Every hit brings:
  - a crisp venom splat and a dark puncture under the needle;
  - droplets splashing back off the face;
  - a tiny toxic puff and a pop ring;
  - a sickly green tint pulse over the portrait (an opacity overlay kept inside the frame, never an animated filter).
- **Where they stick.** The shared `-N` is pushed from the struck hero toward the middle of the screen, so for a hero
  in a corner it sits on the thrower's side. The darts are placed on an arc turned away from the real `-N` anchor
  (`DamageFormation.pts.hit`), so every stuck dart stays readable. Stuck darts, their punctures and the tint ride the
  portrait's knockback.
- **Tiers** (the shared thresholds):
  - I (1 to 5): one dart. The poison then seeps (a second tint pulse, bubbles, a drip off the dart) and the dart
    dissolves.
  - II (6 to 11): two darts in quick succession. The first is a tick, the second the impact.
  - III (12 to 19): a fan of five, thunking in in rhythm, each with a venom pop. The blow lands once, on the last.
  - IV (20+): six darts stick round the face, every one a tick. Then:
    1. **Swell.** The stuck darts glow and pulse faster while the venom swells: a toxic aura over the face, a
       breathing rim, bubbles boiling off, wisps curling up, a growing tremor, and a rising bubbling fizz.
    2. **Suck.** Everything collapses inward. Each dart turns to point at the centre and is pulled into one tight
       bright point, a dark ring contracts, and venom droplets are sucked in.
    3. **Toxic burst** (the impact):
       - a green-black shockwave (a dark band leading, venom light riding inside it, a flat acid ring);
       - bubbling toxic cloud puffs rolling out, lit from the top so they have volume;
       - acid droplets arcing out and falling with gravity;
       - venom spurts;
       - a lingering haze that dissipates;
       - two wet pops as aftershocks.
- **The consequence lands ONCE**, on the last dart (Tier IV: on the burst). There is no hit-stop or freeze anywhere.
- **Cosmetic:** `attack_poison`, "Venom Volley" (a placeholder name for the owner), Legendary, crate, style `poison`.
  - The Collection's Attack Animations tab lists it, with the in-place preview.
  - The dev "Attack style" switch gains it.
  - The striker's attack plays: yours from your snapshot, the foe's from their seat snapshot (only while "Show opponent
    cosmetics" is on). An unknown or retired id falls back to Classic.
- **Tuner:** "Hero Attack: Poison" in the hub (🧪). It covers:
  - dart count, throw stagger, speed (flight ms), size and arc per tier;
  - dart length, glow, trail, wisps, stick depth and quiver;
  - venom splash, tick droplets and tint strength;
  - the implosion: swell and suck time, burst, cloud puffs and size, droplet gravity, haze;
  - camera, colours, and a clip / gain / pitch per sound cue;
  - Play buttons for both directions at 3 / 8 / 12 / 40, reduced motion, 1x / 0.5x / 0.25x, and Copy JSON.

  Its localStorage is DEV only; production plays the baked defaults.

## How it holds Arcana's bar (the techniques used)

1. **One hero element, drawn as geometry** (Arcana 1). The dart is six sprites on one transform, every texture
   painted on the same 160 x 40 box with the tip at the same spot: a venom glow, a dark metal shaft shaded top-lit
   (so a dark tint keeps its form), acid fletching with feather grooves, the venom in its vial and on its needle, a
   lit edge, and a glowing tip.
2. **Mixed blend modes** (Arcana 2). The shaft, fletching, venom, splats, droplets, clouds and the dark shockwave are
   NORMAL blend, so they hold on the light board. The glows, trail light, rings and flashes are additive.
3. **The trail is the motion sampled back in time** (Arcana 4). Three strips sample the pure `dartPos` from the tail
   end. The hot core runs only just behind the fletching; a wider soft vapour covers the rest (a tracer line was
   rejected in review). Wisps are ellipses drawn out along the heading, never round dots.
4. **Ticks are line work, the impact is fill; fills are short** (Arcana 7 and 8). The burst's flash and bloom are
   gone in about 240 ms, and its splat is small and quick, so the lit clouds carry the burst. A big held splat read as
   a flat green disc and was cut.
5. **Build, then release** (Arcana 10). At IV the darts pulse faster, the tremor and the zoom grow and the fizz rises
   to the suck. The suck eases in (cubic) and snaps shut, then everything releases outward at once.
6. **Capture on a manual clock** (Arcana 11). This session drove the real runner through the `frames` seam in a
   headless Chrome over CDP (1600 x 900), stepped to exact beats. Note that a manual clock bypasses `pixiFx`'s ticker
   idling, so hold a no-op `pixiFx.addUpdater` during the capture or the Pixi canvas never presents.

## Timeline (ms from the ready, 1600 px apart; the formation's lead-in comes before)

| tier | darts | first throw | ticks | impact | seep / dissolve | end |
| --- | --- | --- | --- | --- | --- | --- |
| I (3) | 1 | 300 | none | 600 | 920 / 1040 | 1320 |
| II (8) | 2 | 340 | 655 | 825 | 1145 / 1265 | 1585 |
| III (14) | 5 (fan) | 400 | 741, 846, 936, 1041 | 1130 | 1450 / 1570 | 1930 |
| IV (40) | 6, implode | 420 | 765 to 1160 (six) | 2090 (burst; swell 1250, suck 1890) | pops 2240, 2390 | 2990 |

Arcana for comparison: I 1328, II 1673, III 2073, IV 2574. The dissolve and the haze finish draining after the end
(the scene keeps ticking until it is empty), so the fight never waits on a fading dart or a thinning cloud.

## Crate odds (first crate)

Common 46.0%, Rare 30.5%, Epic 18.6%, Legendary 4.8%. A non-title item is 32.8%. The six hero attacks together are 3.2%
(each 0.54%). Before Poison Darts: 46.3 / 30.6 / 18.8 / 4.3 / 32.5 / 2.7.

## Perf

Measured on the PROD build (`vite build` + `vite preview`), with a temporary, uncommitted hook to reach the runner:

- **Browser pane (real GPU, 240 Hz, sound on).**

  | run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | IV you (40, first play) | 1537 | 4.2 | 5.5 | 6.6 | 72.7 | 3 | 1 |
  | IV foe (40) | 1571 | 4.2 | 5.6 | 6.1 | 18.4 | 1 | 0 |
  | III (12) | 1259 | 4.2 | 5.5 | 6.6 | 12.5 | 0 | 0 |
  | II (8) | 1142 | 4.2 | 5.5 | 7.5 | 12.9 | 0 | 0 |
  | I (3) | 865 | 4.2 | 8.7 | 9.7 | 314.3 | 4 | 0 |

  - The one long task was the session's first play (textures painted, clips decoded, synth buffers built).
  - The Tier I 314 ms gap has no long task behind it. Another session took over the shared pane during that run, and a
    hidden tab pauses `requestAnimationFrame`, so this is not main-thread work.
- **Headless Chrome, prod build, five plays including the first.** Zero long tasks.
- **After every run:** no DOM is left behind and `#stage` is restored.
- **Pools and textures:** sprites (cap 700) and trail strips (cap 48, 32 vertices each) are pooled per layer. Poison's
  own twelve textures are painted once per session, plus the Blast and Arcana textures it shares (about 330 KB of its
  own). A near-invisible pre-warm sprite per texture uploads each one during the damage formation. The synth buffers
  are built during the formation too (`warmPoisonSynths`).
- **DOM moves** are transform / opacity only. The tint over the face is a Pixi opacity overlay.

## Sound (existing clips plus two new synths; no ElevenLabs credits)

- **Ready:** `equipmentsheen`, pitched down (a sneaky glint).
- **Throw:** the `stereogenicstudio` swish, pitched up and cut short, plus `universfield-whip-snap` entered at its crack
  (440 ms in). Together they make the "thwip". The pitch climbs per dart.
- **Tick:**
  - `fel-spike-echo-land` (the thunk);
  - `smack1` (the meat);
  - `oona-splat` (the wet splash);
  - `playAcidSizzle`, new: hiss through a high band-pass with a spitting flutter.

  All are pitched up per tick.
- **Impact:** the thunk, `flurryhit`, the meat, the splat (heavier per tier) and the sizzle, plus `crit` on III.
- **IV:**
  - `playToxicFizz`, new: a buffer of random bubbling bloops played faster and higher under a rising hiss. It peaks
    exactly at the suck and is cut there.
  - `runeselectimplosion` on the suck.
  - On the burst: `oona-splat` pitched down (the gush), `turnexplosion` pitched up (punchy, not boomy), `flurryhit`,
    `crit` and a long sizzle.
  - Two wet `oona-splat` pops as aftershocks.
- **Seep (I to III):** a soft pop and a sizzle.

Clips worth supplying:
- a crisp dart "thwip" (0.15 to 0.3 s, a fast air cut with a flick);
- a meaty dart thunk into flesh or wood with a tiny quiver;
- a short wet venom splat and sizzle;
- a 0.6 to 1 s bubbling poison swell that rises;
- a reverse-suck implosion (0.2 to 0.3 s);
- a wet, punchy toxic burst with a gassy hiss tail.

## Open for the owner

- The name "Venom Volley" is a placeholder; the id `attack_poison` stays whatever it is called.
- Legendary rarity, matching the other five.
- The foe's fletching and total colour are a venom violet (`#b04dff`). The venom itself is the same green for both
  sides, to keep the poison language. Tunable.
