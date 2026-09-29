# 2026-09-28: Frost, a hero attack of icicles and a frost nova

Owner ask (2026-09-28): "branch off and create an ice/freeze blast one. icicles and then a frost nova blast that blasts
across the screen from the attacker to the target".

First review (the owner, seeing the WIP on 5173): "frost already looks incredibly good." So the direction stayed. The
later passes only fixed the camera and softened the ground ferns.

Branched off `main` after Enraged Strike (#1804). Poison Darts (#1805) merged first, so `main` was merged into this
branch and both are kept everywhere; Frost is the seventh attack. The oracle rule is **R-PROG-ATTACK-13** (-12 is Poison). Nothing changes for players until the
owner deploys `progression-inventory` (the catalog sync adds `attack_frost`). There is no new migration.

## What shipped

- **Frost** (`packages/ui/src/heroFrost/`). The shared damage formation runs first. Then:
  - **Crystallise.** A hexagonal frost rune opens over the striking hero and turns. A cold mist gathers round the rim,
    snowflakes spiral in and a riser of chimes climbs. **Icicles grow** one by one out of the air, round the portrait
    rim on the side facing the target (never over the face). Each grows from its butt out to its tip, with a glint
    riding the growing tip. Each starts white-hot and settles into pale cyan, and each points at its own hit point.
  - **Launch.** Each icicle draws back a hair and fires fast, on a near-straight line, trailing an ice-dust strip and
    glittering motes.
  - **Shatter.** Every icicle that lands before the last is a tick: a snowflake flash, a crisp ring, faceted shards
    flung back toward the thrower, and a snow puff. **Frost creeps** over the struck portrait's edge: ferns grow in from
    the rim on the side the ice came from, and a rime ring thickens. The frost thaws after the end.
  - **The impact** is the last icicle: a short flash, a big snowflake, the frost rune, two rings, more shards, snow, and
    (from Tier II) a crown of small ice spikes bursting out of the rim.
- **Tiers**, on the shared thresholds:
  - I (1 to 5): one icicle.
  - II (6 to 11): two, from either side of the hero.
  - III (12 to 19): a volley of five, outer first, the centre one last and biggest, landing in an even rhythm. There is
    no nova at III: the nova is kept as Tier IV's "whoa" moment. The tuner has a Nova toggle per tier if the owner wants
    a smaller one at III.
  - IV (20+): four icicles form and fire (every one a tick). Then the hero **gathers the cold**: a bigger rune spins up,
    snow and crystals spiral in, and a freezing howl rises. The **FROST NOVA** is released. It is a wide rolling wave front
    that blasts across the screen from the attacker to the target:
    - a frost wall, a cold glow and a white leading edge (three crescent strips that bulge ahead in the middle and billow
      along their edge);
    - snow and crystals swirling in the front and snow billows rolling off it;
    - a frozen **ice sheet** of cracked ice with frost ferns growing off its edges, left behind along the path.

    It hits the struck hero, and the portrait is **encased** in a faceted ice shell that snaps shut with a flash while
    cracks spread through it and the portrait strains. Then the ice **shatters** outward (big shards off the whole shell,
    a crown of ice spikes, three rings, the rune flaring, snow and glitter). Two tinkling aftershocks follow.
- **The consequence lands ONCE**: on the last icicle, or at IV on the encasement shattering. **No hit-stop or freeze
  anywhere**: the ice holds still while the shared clock runs on (a test steps it frame by frame through the encasement).
- **Camera.** It pushes in while the ice forms, follows the volley to the target, and punches in and shakes along the
  throw. At IV it follows the volley in, eases most of the push off and pans home to the caster for the gather, rides the
  nova's front across, builds on the encased hero, and the shatter punches hardest. The first build anchored the view
  30% along the line, which pushed the struck portrait off the top-right corner during the ticks; that was fixed.
- **Cosmetic**: `attack_frost`, "Frost Nova" (a placeholder name for the owner), Legendary, crate, style `frost`.
  - The Collection's Attack Animations tab lists it with the in-place preview.
  - The dev "Attack style" switch gains it.
  - The striker's attack plays: yours from your snapshot, the foe's from their seat snapshot, and only while "Show
    opponent cosmetics" is on. An unknown or retired id falls back to Classic.
- **Tuner**: "Hero Attack: Frost" in the hub (❄️). It has:
  - icicles per tier, form time, launch stagger, flight, size and arc;
  - the grow time, form distance and spread, the draw back, the thickness, glow and deep core;
  - the trail and ice dust, the shatter size, snow puffs and the frost creep;
  - the nova (gather, travel, width, depth, bulge, snow density, ice sheet width, ground ferns, thaw);
  - the encase hold, size and shatter shards;
  - the camera, colours, and a clip / gain / pitch per sound cue;
  - Play buttons for both directions at 3 / 8 / 12 / 40, plus reduced motion, at 1x / 0.5x / 0.25x;
  - Copy JSON.

  Its localStorage is DEV only; production plays the baked defaults.

## How it was built (the Arcana techniques it reuses)

1. **One hero element drawn as geometry** (Arcana 1). The icicle is five sprites on one transform: the faceted body, the
   deep core, the frosty rim, the specular edge and the glow. The nova front is three crescent strips and the ground is
   one strip. Particles (shards, dust, snow) are seasoning.
2. **Not a cone** (the owner's "obviously AI" rejection). The body texture is painted as four facets running to the
   point, each with its own grey and its own translucency, plus a cleavage sliver near the tip, a jagged broken butt and
   two small crystal spurs. One pale cyan tint then reads as cut ice. The core adds a glacier-blue spine with hairline
   fractures and trapped bubbles. The rim adds rime crystals, thickest at the frosted butt.
3. **Mixed blend modes** (Arcana 2). The ice, the shards, the frost and the nova wall are normal blend, so they keep
   their colour on a light board. The glows, the specular edges and the leading edge are additive.
4. **The trail is time** (Arcana 4). The ice-dust strip samples the pure flight (`trailPos`) back in time, clamped to
   the flight so it never reaches back into the hover.
5. **Ticks are line work, fills are short** (Arcana 7 and 8). A tick is a snowflake flash and a ring over a 110 ms glow.
   Every impact fill is gone in about 150 ms so the big `-N` reads. The frost, the rune and the rings linger.
6. **Frost grows the way frost grows.** The ferns are dendrites with branches at 60 degrees. The snowflake and the rune
   are six-fold. The shell is cut like a gem.
7. **Capture on a manual clock** (Arcana 11). The tuner's `demo` takes a `frames` seam. For review, a no-op
   `pixiFx.addUpdater` keeps the Pixi overlay rendering while the frames are stepped by hand.

Honest comparison with Arcana: Arcana's ribbon is still the more elegant single stroke, and its vortex is the tighter
build. Frost's Tier IV is the biggest screen-filling moment of any attack (the only one that crosses the whole board),
and the encase-and-shatter gives a clear, readable "held, then broken" beat. Its weakest spots:
- Tiers I to III: at 1080p the icicle is slim, so its facets only read up close; at a glance it is a bright ice spear.
- The ice-dust trail is a thin line that can read a little like a laser at speed.
- The ground ferns are stiff (softened once).

## Timeline (ms after the formation, 1600 px apart)

| tier | icicles | first launch | ticks | nova gather / release / contact | impact | end |
| --- | --- | --- | --- | --- | --- | --- |
| I (3) | 1 | 480 | none | none | 780 | 1328 |
| II (8) | 2 | 540 | 840 | none | 990 | 1598 |
| III (14) | 5 (every 105 ms) | 620 | 910, 1015, 1120, 1225 | none | 1330 | 1998 |
| IV (40) | 4, then the nova | 560 | 840, 935, 1030, 1125 | 915 / 1315 / 1955 | 2255 (the shatter) | 3055 |

The formation's own lead-in comes before these, as for every style. Flight and nova travel scale gently with the
portraits' distance.

## Crate odds (first crate)

With all seven hero attacks in (Frost merged after Poison Darts): Common 45.8%, Rare 30.3%, Epic 18.5%, Legendary 5.4%. A
non-title item is 33.2%. The seven hero attacks together are 3.7% (each 0.54%, weight 45 of 8410). Before Frost (the six
with Poison): 46.0 / 30.5 / 18.6 / 4.8 / 32.8 / 3.2.

## Perf

Measured on the PROD build (`vite build` + `vite preview`, 1600x900, 240 Hz, a practice run, a temporary uncommitted
hook to reach the runner):

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (40), the session's first play | 1303 | 4.2 | 8.4 | 12.5 | 104 | 3 | 1 |
| IV foe (40) | 1429 | 4.2 | 8.4 | 12.5 | 20.8 | 1 | 0 |
| III you (14) | 1432 | 4.2 | 4.3 | 4.3 | 8.4 | 0 | 0 |
| III foe (14) | 1425 | 4.2 | 4.3 | 4.3 | 16.7 | 0 | 0 |
| II (8) | 1285 | 4.2 | 4.3 | 4.3 | 8.3 | 0 | 0 |
| I (3) | 1187 | 4.2 | 4.3 | 4.3 | 8.3 | 0 | 0 |

- The one long frame was the session's first play. Painting every Frost texture measured **5 ms** (and Arcana's plus
  Blast's 1.6 ms), so that frame is not the textures. It lines up with the first mount of the shared above-portrait Pixi
  slot and the tuner preview mounting the foe portrait. It did not repeat.
- The IV p95 of 8.4 ms is one missed 240 Hz vsync during the nova (still above 120 fps).
- After every run, the `#stage` transform is restored and no DOM is left behind.
- Sprites (cap 900) and strips (cap 40; at most 48 vertices each) are pooled per layer.
- The textures are painted once per session. A near-invisible pre-warm sprite per texture uploads each one during the
  damage formation, so the first icicle never waits.
- DOM moves are transform / opacity only.
- A later batch was invalid (the pane went hidden and rAF throttled to 0.5 Hz), so it was dropped from the table.

## Sound (existing clips plus two new synths; no ElevenLabs credits)

- **Crystallise:** `freezetavern` (the forming), `equipmentsheen` (a cold shimmer), and a `prismaticpick` chime per
  icicle, a step higher each.
- **Launch:** `fx/metal-woosh` pitched up (sharp, a step higher each), plus `fx/djartmusic-christmas-sparkle-whoosh`
  for the ice dust.
- **Ticks:** `divineshieldbreak`, a glassy crack that climbs.
- **Impact:** `rebornshatter` (the glassy shatter), `fx/blue-impact-hit`, `smack2` for a low punch, and `crit` on III.
- **Nova:**
  - `playFrostWind`, a new synth: looped white noise through two resonant band-passes a fifth apart, gliding up with a
    wobble. It is a howl, not a hiss, high-passed at 180 Hz. It peaks on the release and trails off as the wave rolls.
  - `fx/universfield-cinematic-swoosh-impact` on the release.
  - `playIceCrackle`, a new synth: the crackle buffer played fast through a 2.6 kHz high-pass and a 5 kHz peak, its rate
    climbing. It runs under the rolling wave and again, louder, while the ice strains, and is cut on the shatter.
  - `freezetavern` pitched down on the encase.
  - The shatter: `rebornshatter`, `turnexplosion` pitched up (a crack, not a boom), `fx/blue-impact-hit`, `crit`,
    `smack2`, and `divineshieldbreak` tinkles for the aftershocks.

Clips worth supplying:
- a crystalline forming shimmer (0.6 to 1 s; icy, rising);
- a sharp ice-launch whoosh (0.3 to 0.5 s);
- a bright glassy ice shatter, short with a glittering tail;
- a 1 s freezing wind howl (the synth stands in);
- a crunchy freeze or encase crackle (ice forming fast);
- a big glassy burst for the encasement shattering (tight low end, bright top).

## Open for the owner

- The name "Frost Nova" is a placeholder.
- Legendary rarity matches the other five.
- No nova at Tier III (kept as the Tier IV moment). The per-tier Nova toggle is there to try one at III.
