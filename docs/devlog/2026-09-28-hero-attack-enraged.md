# 2026-09-28: Enraged Strike, the fifth hero attack (Classic, Legendary)

Owner ask (2026-09-28): "branch off and make one more animation, which is just a legendary version of this strike. it
should be a 10x more exciting and oomphier more impactful and pixi animation dense attack animation, but basically a
legendary version of this attack, just amplified or enraged." ("This strike" is Classic, the hero portrait's own lunge.)

First review of the WIP: "enraged needs way more polish. it's a 4/10. pleaes take a huge pass at improving it and
cleaning it up". Then, for every attack: "remove the freezeing frame from all of the animations. it looks like lag".
This entry describes the version after the polish pass, with no hit-stop anywhere.

Stacked on the damage formation (`feat/damage-formation`, PR #1803), which carries Quake, Arcana and Phantom Blades
below it, the cleaned-up Classic (`classicSwing` / `strikePose`) and the hit-stop removal. Nothing changes for players
until the owner deploys `progression-inventory` (the catalog sync adds `attack_enraged`). The equip SQL already accepts
the `hero_attack` slot, so there is no new migration.

## What shipped

- **Enraged Strike** (`packages/ui/src/heroEnraged/`). The shared damage formation runs first. Then the striking hero
  plays **Classic's own swing**: `classicSwing` gives the coil direction, the corner-first contact point, the
  distance-scaled strike with its ease, the rebound and the elastic settle, all at Classic's tempo. Every beat is
  amplified:
  - **Windup.** A deeper coil and a bigger swell, with a tremble that grows. A **rage aura** ignites and rides the
    portrait: a crisp hot ring on the rim, a halo annulus (clear over the face), and swaying flame tongues all round
    the rim, tallest off the top. Three charge rings close in, hot streaks are pulled in, embers rise, and a synth
    growl climbs to the drive.
  - **Lunge.** Classic's strike, which hangs and then blurs. Crisp **afterimages** of the portrait are stamped at even
    spacing along the dash (3 at most, newest strongest). A slim rage streak runs behind the portrait's back rim, the
    flames stream back, and speed lines rush past.
  - **Strike.**
    - A short white flash and hot core.
    - A crisp hot shockwave ring and a thin second ring.
    - **Claw rips**, drawn on as curved, tapered strokes with white cores. A second, crossing set is added from
      Tier III.
    - Chunky sparks with gravity in a wide fan, a few embers and two dark puffs.
    - The striker squashes against the foe, and the foe is knocked back and squashed.
    - A controlled camera punch and shake, capped by the tuner.
    - The aura is spent on the last blow, so the impact reads.
  - **Recover.** Classic's rebound and elastic settle (quicker), trailing embers and wisps. The foe smoulders.
- **Tiers**, on the shared thresholds:
  - I (1 to 5): one hit.
  - II (6 to 11): a double strike.
  - III (12 to 19): a flurry of three. The last is a finisher after a deeper wind.
  - IV (20+): the hero **rises** up the screen and swells toward the camera while the aura becomes a comet. It hangs,
    then **slams** down like a meteor. The impact adds a short screen flash, a scorched crater ring round the struck
    portrait with dark fissures and cooling molten light, rock chunks, an ember fountain and aftershocks.
- **The consequence lands ONCE**, on the last strike (Tier IV: on the meteor). Earlier strikes are ticks, with FX and
  sound only. There is no hit-stop or freeze anywhere. The coil and the rise are shortened, never bent, so a portrait
  in a corner stays on screen.
- **Cosmetic**: `attack_enraged`, "Enraged Strike" (a placeholder name for the owner), Legendary, crate, style
  `enraged`.
  - The Collection's Attack Animations tab lists it with the in-place preview.
  - The dev "Attack style" switch gains it.
  - The striker's attack plays: yours from your snapshot, the foe's from their seat snapshot, and only while "Show
    opponent cosmetics" is on. An unknown or retired id falls back to Classic.
- **Tuner**: "Hero Attack: Enraged" in the hub (💢). It has:
  - every timing, as multiples of Classic's windup and strike;
  - strikes per tier, the meteor toggle, the aura, the afterimages, the streak, the rings, the claws and the sparks;
  - the shake and zoom caps, colours, and a clip / gain / pitch per sound cue;
  - Play buttons for both directions at 3 / 8 / 12 / 40, plus reduced motion, at 1x / 0.5x / 0.25x;
  - Copy JSON.

  Its localStorage is DEV only; production plays the baked defaults.

## How the polish pass got from 4/10 to here (and which Arcana techniques it uses)

The first pass read as programmer art:
- radial flame "petals" like a bead crown;
- a flat orange cone for a wake, spanning the screen;
- disc ghosts smeared along the whole dash;
- a bright orange blob over the face;
- an aura that buried the impact.

What fixed each:

1. **One lead element per beat** (Arcana 1). The windup's lead is the aura, the lunge's the afterimages, the strike's
   the claws and rings. Everything else is quieter.
2. **Flames are strips, not sprites** (Arcana 1 and 4). Each flame tongue is three strip meshes on a spine rooted on
   the rim. A wave travels up the spine so it licks. It is wide at the root and pointed at the tip.
3. **Mixed blend modes** (Arcana 2). Normal-blend deep bodies (the flames, the streak, the claws) keep their colour on
   a light board. Additive glows and white cores bloom on dark ground.
4. **Afterimages are stamped by DISTANCE, not sampled by time.** Classic's strike ease hangs and then blurs, so ghosts
   sampled at fixed times clumped at the start and jumped across the screen at the end. Stamping every N px along each
   frame's straight segment gives 2 to 4 evenly spaced, crisp copies.
5. **The streak is bounded in length and starts behind the portrait.** Pixi draws over the DOM portrait, so a streak
   through the face hid it. It only shows on a dash (never the spring home) and is pointed at both ends.
6. **Ticks are line work, the impact adds fill; fills are short** (Arcana 7 and 8). The flash is gone in ~110 ms; the
   rings and claws linger.
7. **The flame lean reads the smooth motion** over 50 ms, so the windup's tremble never flails the flames.
8. **Capture on a manual clock** (Arcana 11): the tuner's `demo` takes a `frames` seam, stepped to exact beats for
   review.

Honest comparison: Arcana's ribbon is still the cleaner single element. Enraged's strength is that the hero itself
moves, which no other style does. Its weakest moment is the contact frame: Classic's contact puts the striker over the
struck portrait, so the claws show mostly after the rebound. The foe portrait also sits in the top-right corner, so
part of every impact on it is off screen.

## Timeline (ms, a typical cross-board Classic swing; the formation's lead-in is included)

| tier | strikes | windup starts | impact | end |
| --- | --- | --- | --- | --- |
| I (3) | 1 | 2210 | 2988 | 3888 |
| II (8) | 2 (a tick, then the impact) | 2376 | 3496 | 4416 |
| III (14) | 3 (two ticks, then the finisher) | 2708 | 4259 | 5219 |
| IV (40) | the meteor (rise, hang, slam) | 2800 | 4305 | 5572 |

The style's own part: I ~1.7 s (Classic's own is ~1.7 s after the formation), II ~2.0 s, III ~2.5 s, IV ~2.8 s. The
drive time follows Classic's distance-scaled strike, so a real fight varies a little with the portraits' distance.

## Crate odds (first crate)

Common 46.3%, Rare 30.6%, Epic 18.8%, Legendary 4.3%. A non-title item is 32.5%. The five hero attacks together are
2.7% (each 0.54%). Before Enraged: 46.5 / 30.8 / 18.9 / 3.8 / 32.1 / 2.2.

## Perf

Measured on the PROD build (`vite build` + `vite preview`, 1600x900, 240 Hz, a practice run vs bots, a temporary
uncommitted hook to reach the runner):

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (40) | 1675 | 4.2 | 4.3 | 4.3 | 20.9 | 1 | 0 |
| IV foe (40) | 1399 | 4.2 | 8.4 | 8.4 | 12.5 | 0 | 0 |
| III (14) | 1580 | 4.2 | 4.3 | 4.3 | 8.3 | 0 | 0 |
| II (8) | 1416 | 4.2 | 4.2 | 4.3 | 4.3 | 0 | 0 |
| I (3) | 1268 | 4.2 | 4.3 | 4.3 | 4.3 | 0 | 0 |

The one slow frame was the session's first play. Afterwards:
- `body` classes and the `#stage` transform are restored.
- No DOM is left behind.
- Sprites (cap 900) and strip meshes (cap 96, 28 vertices each) are pooled per layer.

The textures are painted once per session: seven of Enraged's own, plus the Blast and Arcana textures it shares. A
near-invisible pre-warm sprite per texture uploads each one during the damage formation, well before the aura needs
it. DOM moves are transform / opacity only.

## Sound (existing clips plus two new synths; no ElevenLabs credits)

- **Windup:**
  - Classic's `windup` clip;
  - a roar (`fx/dragon-growl-2`, pitched up, quiet);
  - a riser (`fx/oona-powerup`, pitched down) whose climax lands on the drive;
  - `playRageTone`, a new synth growl: two detuned saws with a fast flutter, high-passed at 70 Hz so it never gets
    muddy, rising to the drive;
  - `playEmberCrackle`, a new synth: sparse high-passed clicks.
- **Lunge:** a swoosh per dash, entered as the strike blurs so it rushes into the hit.
- **Ticks:** `smack3`, `cleave2` for the rip and `smack2`, each pitched up per strike.
- **Impact:**
  - `titanhammer`, `smack2`;
  - `fx/heavy-rock-impact` pitched up for a tight low end;
  - `cleave2`;
  - `crit` on III and IV;
  - the ember crackle through the smoulder.
- **Meteor:** a `playRumble` building to the apex, `fx/universfield-ground-impact-352053` on the slam, and
  `fx/triple-impact` for the debris aftershocks.

Clips worth supplying:
- a short, aggressive rage roar or grunt (0.6 to 1 s; the dragon growl is a stand-in);
- a heavy body-blow punch with a tight low end (not boomy);
- a flesh or cloth rip for the claws;
- a fire whoosh or ignite for the aura;
- a meteor impact with a rock-crumble tail.

## Open for the owner

- The name "Enraged Strike" is a placeholder.
- Legendary rarity matches the other four.
- Classic's contact puts the striker over the struck portrait. If the owner wants the foe's face visible on the
  impact frame, the contact could stop at the rim for Enraged only.
