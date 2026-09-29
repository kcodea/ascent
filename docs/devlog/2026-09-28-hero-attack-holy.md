# 2026-09-28: Consecration, the holy hero attack (attack_holy, Legendary)

Owner ask (2026-09-28): "branch off and create a holy weapon + consecration attack. first tier is a holy aoe blast on the
opponent, final blast a large holy sword slams into the middle of the board and a consecration erupts from it damaging
the opponent. fill in the middle tiers".

Two owner reviews of the first pushes reshaped Tier IV and the palette the same day:
- "for holy -> i want the sword come down and explode into light which then shoots the consecrated cracked ground at the
  opponent. also make they holy color less yellow and more gold + white"
- "make the sword come down fast from above the screen and create an impact when it hits, then send the flat consecrated
  blast at the opponent. the sword should slam down and explode fast, then the wake builds and rapidly flies at the
  opponent and strikes them."

Branched off `main` after Enraged (#1804). Poison (#1805) and Frost are still unmerged, so the crate-odds and
Collection-count pins will conflict with whichever lands first (expected). Nothing changes for players until the owner
deploys `progression-inventory` (the catalog sync adds `attack_holy`). No SQL.

## What shipped

**Consecration** (`packages/ui/src/heroHoly/`), gold and white (no lemon yellow). The shared damage formation runs
first. Then:

- **Invoke.** A golden halo rings the striking hero's head, a slow sunburst of feathered god rays turns behind the
  portrait (a clear middle, so the face stays clean), light is drawn in, and a synth choir swells. A beam of light then
  rises off the hero.
- **I (1-5), the owner's tier.** A golden rune sigil (a double ring set with crosses, a radiant cross and a sun) spins
  down onto the struck portrait. A pillar of light drops from just above the frame onto it. The landing is the brightest
  frame: a short flash, a four-point cross gleam, god rays, a crisp ring and a ground ring, and rising motes.
- **II (6-11).** A double smite. The first is a tick, and the second is bigger. The sigil gains a counter-turning outer
  ring.
- **III (12-19).** A rain of six spears of light thunks in round the struck hero, fanned on the side facing the striker,
  so a hero in a corner still has every spear in view. Each spear plants a glowing seed rune that cracks the ground. Then
  the pillar drops and every seed erupts with it. This hints at IV's cracked holy ground.
- **IV (20+), as revised by the owner.**
  1. A huge ornate holy sword drops FAST from above the top of the screen, accelerating (no hang), with a streak of
     light behind it, into the middle of the board. The sword has a white-gold bevelled blade with a fuller and glowing
     runes, a gold winged crossguard, a sky-blue sun gem, a wrapped grip and a cross finial. The whole sword is in view
     once it bites. A board with less room gets a shorter sword, never a cropped one.
  2. The slam brings a shockwave, a flash, dust, light debris, radiant cracks and a camera punch.
  3. It explodes into light at once: the blade dissolves, and golden shards and rays burst out. A rune circle is burnt
     into the board where it bit.
  4. The wake builds for about 240 ms. A ring closes in, light is drawn in low, and the flat blast (a crescent sheet of
     light lying on the ground) forms on the side facing the target.
  5. The blast is FIRED. It skims along the ground to the struck hero in about 250 ms, tearing a jagged main crack and
     two side cracks (a deep-gold line, a gold light and a white-hot core just behind the front) and lighting runes, with
     dust kicked up either side.
  6. Holy flames (swaying tongues, tallest at the sides so the face reads) and a pillar of light erupt under the struck
     portrait. This is THE blow. The cracked path lingers and fades.
- **The consequence lands ONCE**, on the last smite (IV: on the eruption, never on the slam or the flight). Every
  earlier smite and every spear is a tick. There is no hit-stop or freeze anywhere.
- **Cosmetic:** `attack_holy`, "Consecration" (a placeholder name), Legendary, crate, style `holy`. It has a Collection
  tile with the in-place preview and a place in the dev style switch. The striker's attack plays, from their snapshot,
  gated by "Show opponent cosmetics". An unknown or retired id plays Classic.
- **Tuner:** "Hero Attack: Holy" in the hub (✨). It covers:
  - the invoke: halo, sunburst, prayer beam;
  - the sigil size and spin;
  - the pillars: glow, height, width, drop time and the smite count and gap per tier;
  - the spear rain: count, gap, flight, size, ring, slant, seed glow;
  - the sword: size, placement, drop time, glow, dust, debris, shockwave, explosion size, shards, dissolve;
  - the consecration: ground tilt, wake build, blast flight and size, path width, rune density, cracks, gather, flames
    and their height, linger;
  - camera, colours, and a clip / gain / pitch per sound cue plus the choir and bell synths;
  - Play buttons for both directions at 3 / 8 / 12 / 40, reduced motion, 1x / 0.5x / 0.25x, and Copy JSON.

  Its localStorage is DEV only; production plays the baked defaults.

## How it holds the Arcana bar

1. **One lead element per beat, drawn as geometry.** The halo, then the sigil, then the pillar; at IV the sword, then
   the blast. The sword is painted once in its real colours as three aligned layers (a soft glow, the body, the hot
   highlights). Particles are seasoning.
2. **Mixed blend modes.** Normal-blend deep-gold bodies (sigil lines, pillar bodies, the ground, cracks, dust, the sword)
   keep the colour on the light board. Additive gold light and warm-white cores bloom. The additive gold is the gold drawn
   a third of the way to white, which is what makes it read gold and white rather than yellow.
3. **A true ground plane.** Ground ellipses (sigils, rings, runes, the blast) are placed with rotation composed with the
   tilt through the sprite's skew, so they turn ON the ground instead of tipping in the screen. This is a transform only,
   no paint.
4. **Ticks are line work; fills are short.** Flashes are gone in 110 to 170 ms, so the big `-N` never sits in a white
   disc. Rays, rings, cracks and flames carry the afterglow.
5. **Capture on a manual clock.** A private headless Chrome at 1600 x 900 over CDP drove the real runner through the
   `frames` seam, stepping to exact beats. The shared Browser pane was contended by other sessions and reports `hidden`,
   which pauses rAF.

## Timeline (ms from the invoke, 1600 px apart; the formation's lead-in comes first)

| tier | beats | impact | end |
| --- | --- | --- | --- |
| I (3) | prayer 300, sigil 360, drop 600 | 750 | 1390 |
| II (8) | prayer 340, drops 640 / 960 (the first a tick at 790) | 1110 | 1810 |
| III (14) | prayer 380, six spears landing 822 to 1247 (ticks), drop 1357 | 1517 | 2257 |
| IV (40) | sword 440, slam + explode 670, fired 910, arrives 1144 | 1184 (eruption) | 2204 |

For comparison, Arcana's ends are 1328 / 1673 / 2073 / 2574.

## Crate odds (first crate)

- Common 46.0%, Rare 30.5%, Epic 18.6%, Legendary 4.8%.
- A non-title item is 32.8%.
- The six hero attacks together are 3.2% (each 0.54%).
- Before Consecration: 46.3 / 30.6 / 18.8 / 4.3 / 32.5 / 2.7.

## Perf

Measured on the PROD build (`vite build` + `vite preview`), headless Chrome at 1600 x 900, 240 Hz, with a temporary,
uncommitted hook to reach the runner. Real rAF playback, sound off.

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (40, first play) | 1436 | 4.2 | 4.3 | 4.3 | 33.3 | 2 | 0 |
| IV you (40, again) | 1463 | 4.2 | 4.3 | 4.3 | 4.3 | 0 | 0 |
| IV foe (40) | 1387 | 4.2 | 8.3 | 8.4 | 16.7 | 0 | 0 |
| III (14) | 1026 | 4.2 | 8.4 | 12.5 | 16.8 | 0 | 0 |
| II (8) | 1271 | 4.2 | 4.3 | 4.3 | 8.4 | 0 | 0 |
| I (3) | 1129 | 4.2 | 4.3 | 4.3 | 4.3 | 0 | 0 |

- The only slow frames were on the session's first play.
- No run had a long task.
- After every run, no DOM was left behind and `#stage` was restored.

All sprites are pooled per layer, with a cap of 900 sprites and no meshes. The textures are painted once per session:
the sword's three layers, the sigil, rays, pillar, flame, spear, crack, puff, chip, three glyphs and two blast textures,
plus the Arcana and Blast textures it shares. Each is pre-warmed by a near-invisible sprite during the formation. DOM
moves are transform / opacity only.

## Sound (existing clips plus two new synths; no ElevenLabs credits)

- **Invoke:**
  - `shieldgain`;
  - `playHolyChoir`, a new synth: a major chord of detuned saws through "ah" formants, swelling to the prayer.
- **Sigil:** `prismaticpick`, and a soft high `playBellStrike` (new synth: a church bell's inharmonic partials) as it
  lands.
- **Smites:**
  - a sparkle whoosh on each drop;
  - `divineshieldbreak` on the ticks;
  - on the impact, `fx/blue-impact-hit`, `divineshieldbreak`, `smack2`, a bell, and `crit` from III.
- **Spears:** `fx/metal-woosh` per spear, a crystalline crack and a small bell on each landing.
- **IV:**
  - `fx/universfield-cinematic-swoosh-impact` placed as a riser so its hit lands on the slam;
  - the slam: `titanhammer`, `equipclang`, `smack2` and a low bell;
  - `turnexplosion` pitched up for the explosion;
  - a fast choir build through the wake;
  - a whoosh and a crack when the blast is fired, and a rising choir swell to the strike;
  - the eruption: `turnexplosion` pitched up, `fx/blue-impact-hit`, `divineshieldbreak`, `crit`, `smack2`, and two bells.

Clips worth supplying:
- a choir "ahh" swell (1 to 1.5 s);
- a bright bell or crystalline strike;
- a heavy but punchy sword slam (metal into stone);
- a short radiant burst for the explosion;
- a low whoosh for the ground blast.

## Open for the owner

- The name "Consecration" is a placeholder.
- Legendary rarity matches the others.
- The oracle id is R-PROG-ATTACK-14, because 12 and 13 are claimed by the unmerged Poison and Frost.
