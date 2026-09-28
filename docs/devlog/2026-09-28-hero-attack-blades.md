# 2026-09-28: Phantom Blades, the fourth hero attack (a surprise)

Owner ask (2026-09-28): "branch off and make a new style animation and surprise me with it. arcana is top tier good.
use that as your benchmark for quality. make it unique".

Stacked on Arcana (`feat/hero-attack-arcana`, PR #1798), which is stacked on Quake (#1797, the shared hero-attack
core). Nothing changes for players until the owner deploys `progression-inventory` (the catalog sync adds
`attack_blades`). The equip SQL already accepts the `hero_attack` slot, so there is no new migration.

## The pick

Eight directions were weighed against the three existing styles (Blast throws energy bolts, Quake breaks the ground,
Arcana lobs soft curving light):

| concept | why not / why |
| --- | --- |
| Starfall (meteors) | Glowing heads with trails: the same visual family as Blast's bolts and Arcana's ribbons. The foe usually sits at the top edge, so "from the sky" has no room. |
| Tempest (storm + lightning) | Lightning is another energy bolt (Blast). |
| Eclipse / Void | Dark on a dark board reads poorly; its IV (a pull-in and a burst) repeats Arcana's vortex. |
| Phoenix | A convincing bird is hard to draw procedurally; a blob with wings would not clear the bar. |
| Frost shards | Crisp, but its IV (a glacier erupting) repeats Quake's eruption. |
| Clockwork ballista | Busy mechanical silhouettes; weak readability at a glance. |
| Thrown cards | On theme, but a card is a flat rectangle: a low "whoa" ceiling. |
| **Phantom Blades** | **Picked.** A different MOTION language from all three: rigid, straight and precise, where the others are soft and curving. It has a built-in anticipation beat (the swing to aim and the lock) that none of the others have, a readable "who hits whom" (every blade literally points at its target), a strong silhouette (a sword is instantly readable, even small), a satisfying consequence (the blades STICK, then shatter), and a genuine showstopper at IV (a greatsword). |

## What shipped

- **Phantom Blades** (`packages/ui/src/heroBlades/`). After the shared combine:
  - SUMMON: spectral swords assemble on an arc round the striking hero, each out of slivers of steel that fly in and
    meet along its length (the shatter, played backwards), raised to the sky. A ring of light closes on the portrait.
  - AIM and LOCK: every blade swings round to point at the target (an ease-out-back turn), then holds dead still for
    a breath while a glint runs off each point.
  - LOOSE: each blade kicks back and thrusts in a dead-straight line that still accelerates into the target, with
    afterimages and a thin cut of light behind the point.
  - STAB: a blade that goes in before the last sticks in the portrait and quivers (a spark spray, a cut flash). The
    LAST one is THE impact: the hit-stop, the big `-N`, a long cross cut reaching past the number. A beat later every
    stuck blade SHATTERS into slivers with a starburst of light blades.
  - I one blade; II a pair whose thrusts cross in an X; III a fan of five that hammers in, in rhythm (outer blades
    first, the centre one last and biggest).
  - IV JUDGEMENT: six blades hammer in as ticks while a GREATSWORD assembles over the hero. It swings round to aim and
    hangs, trembling harder, under a rising steel hum, while a reticle locks onto the target and the stuck blades are
    bound to it by spokes of light (the view eases out to a wide shot). Then it is loosed (a sonic boom of rings off
    its guard) and impales the target: a pillar of light, a flat shockwave, the reticle stamped out as a seal; then
    everything shatters, with aftershocks.
- **The consequence lands ONCE.** Every earlier blade is a tick (FX and a clang only). The damage, Armor and Resolve
  (`settleCombat`) land on the last blade, or on the greatsword at IV; the hit-stop and the big `-N` land there too.
  The shatter is FX only.
- **Sound** is layered from existing clips, each entered at its own attack so the hit IS the beat, plus one new synth:
  - the shared ticks and slam;
  - `equipmentsheen` + a soft high `equipclang` per blade summoned (pitch climbs);
  - `fx/metal-woosh` for the swing to aim, and per loose (entered 110 ms in, at its rush; pitch climbs);
  - `equipclang` pitched up as the "ting" of the lock;
  - `fx/universfield-whip-snap` entered at its crack on the first and the last loose;
  - `flurryhit` + `equipclang` per stab (pitch climbs);
  - `cleave2`, `smack2` and (III+) `crit` on the impact; `rebornshatter` on the shatter;
  - IV: `titanhammer` on the greatsword; `fx/universfield-cinematic-swoosh-impact` DELAYED so its own hit (0.48 s in)
    lands exactly on the impact; `fx/triple-impact` aftershocks;
  - `playSteelHum` in `sfx.ts`: a struck-metal ring (four bell-ratio sine partials, each doubled a few cents sharp so
    it beats) gliding up under a tightening tremolo while the greatsword hangs, cut 50 ms at the loose so the crack
    lands on silence.
- **Cosmetic**: `attack_blades`, "Phantom Blades" (a placeholder name for the owner), Legendary, crate, style `blades`.
  The Collection's Attack Animations tab lists it with the in-place preview. The dev "Attack style" switch gains it.
- **Tuner** "Hero Attack: Phantom Blades" (hub, 🗡️): every timing (unfurl, aim swing, lock, kick back, per-tier
  hover, summon and loose stagger, flight, the greatsword's unfurl, aim, hang, kick back and flight), count, size
  (blade length, per-tier size, arc radius, spread, cross), look (glow, edges, outline, afterimages and their gap,
  cut line, quiver, shatter delay, binding spokes), camera, colours, and a clip / gain / pitch per sound cue. Play
  both directions at Small 3 / Tier II 8 / Medium 12 / Huge 40, reduced motion, 1x / 0.5x / 0.25x, Copy JSON.
  Localstorage is DEV-only; production plays the baked defaults.

## How it holds Arcana's bar

It copies the reference-bar techniques from the Arcana devlog:

1. **One hero element, drawn as geometry.** The sword is five sprites on ONE transform (every sword texture is painted
   on the same box with the guard at the same spot): a dark outline, an additive glow, an opaque blade, a gold hilt
   and additive white edges. Slivers and sparks are seasoning.
2. **Mixed blend modes on purpose.** The blade, the hilt, the afterimages and the cut's body are NORMAL blend, so the
   steel keeps its colour on the light board; the glow, the edges and the cut's core are additive.
3. **Pose = time.** `bladePose(motion, t)` is pure; the afterimages are the same pose a few ms back and the cut spans
   the tip's path over the last 120 ms. Identical at any frame rate and in a replay.
4. **Ticks are line work, the impact is fill.** A tick is a cut flash, a ring and sparks; the fill is saved for the
   impact, and gone within ~150 ms so the `-N` reads.
5. **Build, then release.** IV's hang builds the tremor, the steel hum, the greatsword's glow and the reticle to one
   loose, then everything releases at once.

Its own additions: the anticipation beat (aim, then a dead-still lock), the stick-then-shatter consequence, and the
assembly (summon = the shatter played backwards).

## Timeline (ms at 1x, 1600 px apart; end includes the hit-stop)

TIMELINE_TABLE

## Crate odds (first crate)

Common 46.5%, Rare 30.8%, Epic 18.9%, Legendary 3.8%. A non-title item is 32.1%. The four hero attacks together are
2.2% (each 0.54%). Before Phantom Blades (with Arcana): 46.8 / 31.0 / 19.0 / 3.3 / 31.7 / 1.6.

## Perf

PERF_TABLE

## Open for the owner

- The name "Phantom Blades" is a placeholder; the id `attack_blades` stays whatever it is called.
- Legendary rarity, matching the other three.
- Clips worth supplying (no ElevenLabs credits spent):
  - a clean sword unsheathe "shing" (0.3 to 0.5 s) for each blade forming;
  - a metallic "ting" for the lock (a tuning-fork ping);
  - a short, sharp blade whoosh with a fast attack for the thrust (the woosh is entered mid-clip today);
  - a meaty blade-into-target stab ("thunk" with a metal ring);
  - a glassy steel shatter with sparkle;
  - a deep, huge greatsword swing into a slam for IV (the cinematic swoosh-impact stands in for it).
