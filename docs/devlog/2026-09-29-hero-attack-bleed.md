# 2026-09-29: Hemorrhage, the bleed hero attack (attack_bleed, Legendary)

Owner ask (2026-09-29): "branch off and make some more attack types - we need a fire animation, a bleed/gash animation,
some sort of an undead animation, a beast chomp rush animation, and i would love a king oona banana cannon animation.
use the same 4 tier strategy we have been." This entry is the bleed / gash one (the others are separate branches).

Branched off `main` after #1832, so it runs on the shared hero-attack core and the shared damage formation. Nothing
changes for players until the owner deploys `progression-inventory` (the catalog sync adds `attack_bleed`). The equip
SQL already accepts the `hero_attack` slot, so there is **no new migration and no SQL to run**.

## What shipped

**Hemorrhage** (`packages/ui/src/heroBleed/`), a stylised crimson slashing attack, drawn flat. The shared damage
formation runs first. Then:

- **Ready.** The striking hero draws back from the target and turns a little (a blade raised). A crimson glint gathers
  at the striking edge of its portrait and a thin crescent turns there.
- **Swing.** Each slash is a swish arc at the hero's rim that looses a crimson **crescent** (a white-hot core over a
  crimson body over a bloom, with afterimages sampled back along its own path). It flies in on a slightly rising line,
  turns to the cut's angle as it arrives and runs straight **through** the face.
- **The cut.** Behind the crescent a white seam draws across the face (with a crimson bloom), blood sprays off the tip
  along the blade's direction as it goes, a spatter fan is flung off the end, and the line **opens into a gash**: a
  dark ragged wound with a bright red lip, opening with a small overshoot. The cuts sit a little off the big `-N`
  (shifted to the far side of the face from it), so the wounds read beside the number.
- **Tiers** (the shared thresholds):
  - I (1 to 5): one clean diagonal gash. The wound then bleeds (drips run down the portrait, a crimson pulse) and
    closes.
  - II (6 to 11): a cross. Two cuts on the two diagonals meeting on the face; the first is a tick, the second the
    impact (with a flare where they meet).
  - III (12 to 19): a flurry of four fast slashes spread over the face (ticks), then a three-claw **rake** (the impact).
    Every wound bleeds.
  - IV (20+), **Hemorrhage**, hilariously over the top (owner review of the first push: "make the bleed one extremely
    extremely over the top like hilariously over the top for the huge attack. like do 8 zips of the long attack
    animation and have a bloody explosion at the end"):
    1. Three claw rakes carve the face (all ticks).
    2. **Heartbeat.** The wounds throb twice (they flare and widen, a crimson pulse, a ring pulled in, blood welling from
       each) while the view breathes in, with a low lub-dub.
    3. **Wind-up.** The striker rears back and a huge crescent grows at its hand, blood drawn in to it.
    4. **Eight zips.** The screen-splitting mega-slash zips through the target EIGHT times (the `zips` dial), each a
       full-screen sweep with its white seam and dark split, a fresh gash across the face along its line, blood flung
       down the line and a spatter fan. The first swings from the striker's side; each later one is turned off it
       (`ZIP_TURNS`): square across it for an X, then the diagonals between, then the lines between those, alternating
       sweep direction, so no two zips share a line and every one visibly crosses the ones before it. (The owner saw the
       first cut of this rework as "the first few hits of the bleed dont have the crossing lines": its direction list
       swept the same line twice, right-left then left-right and each diagonal both ways, so the early zips drew over
       each other. A test now pins that every pair of zips is at least 20 degrees apart, both ways round, and that every
       zip allocates its crescent and seam and cuts its own gash from the very first, on a fresh scene.) The camera whips down every line and the striker lunges
       and whips round on each, alternating. The cadence ACCELERATES: every sweep and every gap is `zipAccel` (0.74) times
       the one before, floored at `zipMinMs` (55 ms), so the first two read (gaps of 300 and 222 ms) and the last few are
       a blur (gaps of 67 and 55 ms, overlapping). Each zip crossing the target is a tick.
    5. **Held tension** (460 ms, never a freeze): the wounds pulse faster and faster, blood is drawn in to the middle of
       the face, a crimson core swells there and a ring tightens round it, the struck portrait trembles and swells, the
       view creeps in with a growing tremor.
    6. **The bloody explosion** (the impact): every wound rips open; a white-red flash core and a crimson wash; FIVE
       shockwave rings one after another (dark and crimson alternating) that sweep across the screen; a huge stain over
       the face; 18 arterial streaks; blood thrown HIGH out over the board so it rains down across it; spatter landing on
       the board out toward the edges; the stain drips (11 drips); three arterial spurts after. The camera punches harder
       than anywhere else in the roster, with a shake that rings both ways.
- **The consequence** (damage, Armor, Resolve) lands exactly **once**: on the last cut (I to III) or on the nova (IV).
  Every earlier cut is a tick with FX only. No hit-stop or freeze anywhere; the clock never stops.
- **Wounds ride the portrait.** Wounds, drips, stains and the tint follow the struck portrait's knockback.
- **Reduced motion:** fades only.

## Timeline (base ms from the ready, 1600 px apart)

| tier | first swing | impact | end |
| --- | --- | --- | --- |
| I (3) | 300 | 530 | 1470 |
| II (8) | 340 | 760 | 1740 |
| III (14) | 380 | 970 | 1990 |
| IV (40) | 420 | 3059 | 4159 |

## The cosmetic

`attack_bleed`, "Hemorrhage" (placeholder name for the owner to rename; the id stays), Legendary, crate-sourced,
account-wide, `assets.style: 'bleed'`, in both `packages/progression/src/cosmetics.ts` and its Edge mirror. Crates are
fixed-odds with equal chance inside a rarity, so it only re-splits Legendary: 12 Legendaries, each 0.417% of a first
crate (was 0.455 with 11); the category shares become title 58.7 / minion skin 34.5 / hero skin 3 / hero attack 3.8.
The Collection's Attack Animations tab shows it with a preview.

## Tuner

Dev menu "Hero Attack: Bleed": the Tier IV zips (count 8, first sweep, first gap, acceleration, fastest zip), the held
tension and the explosion size, and every other global and per-tier dial (ready, slashes, stagger, crescent speed, cut length,
claws, the Hemorrhage toggle, shake, zoom, punch, droplets, splash, drips, settle, dim), the crescent, cut, wound and
Hemorrhage looks, colours, and a clip / gain / pitch row per sound cue. Per the owner's 2026-09-29 ask for every hero
attack tuner: the button row (Copy JSON, Reset, the Play buttons) sits at the TOP of the panel, and there are no speed
or reduced-motion buttons. The top placement is a new opt-in `TunerSpec.buttonsOnTop` flag in `TunerPanel` (another
session is moving the other attack tuners; if it lands a different mechanism, switch this tuner to it).

## Sound (existing clips only)

- Ready: `fx/metal-woosh`, pitched down (a blade drawn).
- Swing: the `stereogenicstudio` swish pitched up plus `universfield-whip-snap` entered at its crack (the "shing"),
  climbing per slash.
- Every cut: `cleave2` (the slice), `smack1` (flesh), `oona-splat` (blood), pitched up per tick.
- Last cut: the slice, `flurryhit`, flesh, splat (heavier per tier), plus `crit` on III.
- IV: `smack2` pitched low twice per heartbeat (lub, dub), `windup`, `universfield-cinematic-swoosh-impact` for the
  first zip and the swish + snap climbing for the rest, a slice and a splat as each crosses the target, `windup` low
  through the held tension, then `turnexplosion` (the blast), `bloodpot` (the gush), `flurryhit`, `crit`, flesh and
  splat on the explosion, `oona-splat` pitched up for the spurts.

Clips wanted (for the owner, optional): a proper flesh-cut "shhk", a heartbeat, a wet blood burst.

## Perf

Measured on the PROD build (`vite build` + `vite preview`), headless Chrome (GPU, 1920x1080, 240 Hz, sound on), with a
temporary, uncommitted hook to reach the runner. Frame times in ms, the reworked Tier IV (eight zips and the
explosion):

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (40, first play) | 1880 | 4.2 | 4.3 | 4.3 | 145.9 | 6 | 0 |
| IV foe (40) | 1915 | 4.2 | 4.3 | 4.3 | 25.0 | 3 | 0 |
| III (14) | 1344 | 4.2 | 4.3 | 4.3 | 16.7 | 1 | 0 |
| II (8) | 1250 | 4.2 | 4.3 | 4.3 | 12.6 | 0 | 0 |
| I (3) | 1143 | 4.2 | 4.3 | 4.3 | 16.7 | 0 | 0 |
| IV you (40, again) | 1922 | 4.2 | 4.3 | 4.3 | 16.7 | 1 | 0 |

- The one big frame is the session's FIRST play, 54 ms after the demo starts (the one-time setup: textures painted,
  the Pixi slot and the formation DOM built, clips decoded); the first explosion added one 50 ms frame. Neither repeats:
  the third IV play's worst frame is 16.7 ms.
- After every run no DOM is left behind and `#stage` is restored.
- **Pools:** every piece is a pooled sprite (no meshes). The hard cap went from 700 to 1000 for the explosion; a whole
  Tier IV (17 open wounds, overlapping zips, the explosion) peaks around 300 live sprites in the headless run. Bleed's
  thirteen own textures (about 420 KB) are painted once per session and pre-warmed on the GPU during the formation.
- **DOM moves** are transform / opacity only; the tint over the face is a Pixi opacity overlay.
## Tests and oracle

`heroBleed.test.ts` (36 tests: tiers shared with every style, the ladder, tuner clamping and controls, the tick
contract, the IV beats in order (eight zips, all ticks, then the tension, then the explosion), the zips accelerating, the timeline, caps, reduced motion, determinism, the geometry both ways, the -N
avoidance, the mega-slash line, the zips from every direction, the camera, the runner both ways at every tier, knockback riding, slow motion, replay,
finish / cancel, safety timer, the headless scene's caps and drain, the cosmetic). The shared formation and no-freeze
tests, the style-list pins, the Collection counts and the crate per-item odds all gained Bleed. Oracle
R-PROG-ATTACK-15.

## Open for the owner

- Rename "Hemorrhage" if you like (the id stays `attack_bleed`).
- Deploy `progression-inventory` so the catalog sync adds the item. No SQL.
