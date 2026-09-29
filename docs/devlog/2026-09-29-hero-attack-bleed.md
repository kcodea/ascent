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
  - IV (20+), **Hemorrhage**:
    1. Three claw rakes carve the face (all ticks).
    2. **Heartbeat.** The wounds throb twice (they flare and widen, a crimson pulse, a ring pulled in, blood welling from
       each) while the view breathes in, with a low lub-dub.
    3. **Wind-up.** The striker rears back and a huge crescent grows at its hand, blood drawn in to it.
    4. **Mega-slash.** One huge crescent sweeps a straight line from the striker's side, through the target and on past
       it, leaving a white seam with a dark split beside it. It crosses the target exactly half-way through its sweep.
    5. **Blood nova** (the impact, as the slash crosses the target): every wound rips open, a flash, a crimson
       shockwave with a dark band leading, arterial streaks, blood thrown out in arcs that fall (most along the slash),
       spatter landing on the board round the portrait, a stain over the face that holds and drips, and two arterial
       spurts after.
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
| IV (40) | 420 | 1660 | 2630 |

## The cosmetic

`attack_bleed`, "Hemorrhage" (placeholder name for the owner to rename; the id stays), Legendary, crate-sourced,
account-wide, `assets.style: 'bleed'`, in both `packages/progression/src/cosmetics.ts` and its Edge mirror. Crates are
fixed-odds with equal chance inside a rarity, so it only re-splits Legendary: 12 Legendaries, each 0.417% of a first
crate (was 0.455 with 11); the category shares become title 58.7 / minion skin 34.5 / hero skin 3 / hero attack 3.8.
The Collection's Attack Animations tab shows it with a preview.

## Tuner

Dev menu "Hero Attack: Bleed": every global and per-tier dial (ready, slashes, stagger, crescent speed, cut length,
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
  mega-slash, then `bloodpot` (the gush), `flurryhit`, `crit`, flesh and splat on the nova, `oona-splat` pitched up for
  the spurts.

Clips wanted (for the owner, optional): a proper flesh-cut "shhk", a heartbeat, a wet blood burst.

## Perf

Measured on the PROD build (`vite build` + `vite preview`), headless Chrome (GPU, 1920x1080, 240 Hz, sound on), with a
temporary, uncommitted hook to reach the runner. Frame times in ms:

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (40, first play) | 1500 | 4.2 | 4.3 | 4.3 | 183.4 | 6 | 0 |
| IV foe (40) | 1560 | 4.2 | 4.3 | 4.3 | 20.8 | 1 | 0 |
| III (14) | 1354 | 4.2 | 4.3 | 4.3 | 16.7 | 1 | 0 |
| II (8) | 1245 | 4.2 | 4.2 | 4.3 | 16.7 | 0 | 0 |
| I (3) | 1147 | 4.2 | 4.3 | 4.3 | 16.7 | 1 | 0 |
| IV you (40, again) | 1559 | 4.2 | 4.3 | 4.3 | 16.7 | 0 | 0 |

- The one big frame is the session's FIRST play, 33 ms after the demo starts (the one-time setup: textures painted,
  the Pixi slot and the formation DOM built, clips decoded); a smaller first-play hitch (67 ms) came at the first nova.
  Neither repeats: the second IV play's worst frame is 16.7 ms. Same shape as Poison's first-play frame.
- After every run no DOM is left behind and `#stage` is restored.
- **Pools:** every piece is a pooled sprite (no meshes), hard cap 700; a Tier IV peaks around 260. Bleed's thirteen
  own textures (about 420 KB) are painted once per session and pre-warmed on the GPU during the formation.
- **DOM moves** are transform / opacity only; the tint over the face is a Pixi opacity overlay.

## Tests and oracle

`heroBleed.test.ts` (33 tests: tiers shared with every style, the ladder, tuner clamping and controls, the tick
contract, the IV beats in order, the timeline, caps, reduced motion, determinism, the geometry both ways, the -N
avoidance, the mega-slash line, the camera, the runner both ways at every tier, knockback riding, slow motion, replay,
finish / cancel, safety timer, the headless scene's caps and drain, the cosmetic). The shared formation and no-freeze
tests, the style-list pins, the Collection counts and the crate per-item odds all gained Bleed. Oracle
R-PROG-ATTACK-15.

## Open for the owner

- Rename "Hemorrhage" if you like (the id stays `attack_bleed`).
- Deploy `progression-inventory` so the catalog sync adds the item. No SQL.
