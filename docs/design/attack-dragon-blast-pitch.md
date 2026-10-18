# Dragon Blast hero attack: pitch (3 concepts)

Owner ask, 2026-10-18: "branch off and make a new attack that resembles or pulls concepts from iggy. it should be a
dragon blast attack that has increasing magnitude, with powerful back blasting/ward effects".

Source: **Immune Iggy** (`d3_iggy`, Set 3 Dragon, T5 7/2, "Immune while attacking. (Twice per combat)";
art `packages/ui/src/art/minions/d3_iggy.webp`). A crimson, white-bellied dragon in a low charging crouch, wings
spread, breathing a stream of **blue** fire, wrapped in a shimmering blue **ward** that arrows spark off, with
debris kicked up from its claws.

Status: **pitch only, nothing built.** Pick one (or a mix) and I build it.

## Ground rules every concept follows

- **One cosmetic, presentation only.** A new `hero_attack` item in `packages/progression/src/cosmetics.ts` plus a
  style in `HERO_ATTACK_STYLES` (`packages/ui/src/heroBlast/heroAttackStyle.ts`) and a runner folder
  (`packages/ui/src/heroDragon/`: config + plan, scene, textures, runner, test, tuner), the same shape as
  `heroFire/` and `heroFrost/`. It opens on the shared damage formation, takes its tier from `attackTier`
  (`heroAttack/tiers.ts`: I 1-5, II 6-11, III 12-19, IV 20+, a knockout always plays IV), and fires `onImpact`
  exactly once.
- **"Increasing magnitude" works on two levels.** Across blows, the shared tiers step it up. Inside one cast, every
  concept has its own escalation, so even a Tier I shows the climb. There is only one hero blow per combat, so "rises
  over consecutive attacks" can't carry across blows without new state. I did not use it.
- **Perf (the 160 fps bar).** The scene is one-shot Pixi in the shared above-portrait canvas. Portraits only take
  `transform`/`opacity`. No DOM paint properties animate. Textures are painted once per session. Particles come from
  the pooled `pixiFire.ts` (no per-frame allocation). The camera goes through `stageCamera.ts`. No
  `getBoundingClientRect` per frame. Measured on the prod build before review (p95/p99 + frames over 6.25 ms).

## The existing roster (what to stay clear of)

| Attack | Its vocabulary |
| --- | --- |
| Arcane Barrage (`blast`) | bolts I/II/V-shot volley; IV one colossal **beam** that drains into a supernova; attacker recoil |
| Tectonic Slam (`quake`) | ground slam, cracks race across the board, eruption under the target |
| Arcana | magic ribbons lobbed; IV vortex over the target that explodes |
| Phantom Blades | summoned swords aim, lock, thrust; IV greatsword |
| Enraged Strike | Classic lunge with rage aura, afterimage dash, claw rips; IV meteor slam |
| Venom Volley | darts stick; IV six implode into a toxic cloud |
| Frost Nova | icicles; IV a nova **wave front rolls across the screen**, encases, shatters |
| Consecration | sigil + light pillar; IV holy sword + consecration race |
| Inferno (`fire`) | live particle **fireballs** hurled; target set ablaze; IV meteor + fire nova |
| Grave Call | spectral skulls; IV grave rift + giant skull maw |
| Stampede | spirit beasts chomp; IV colossal beast jaws |
| Oona's Banana Cannon | bananas lobbed + splats; IV giant banana hammered in |
| Hemorrhage | crescent gashes; IV mega-slash + blood nova |
| Card Shark / Storm Call (Epic) | dealt cards / a bolt, fork, storm cloud |
| Coin, Boomerang, **Bubble**, Shadow Step (Rare) | coin ping / thrown-and-caught / a bubble that **engulfs the target and pops** / portrait vanishes and stabs |
| Nothing But Net | the portrait plays basketball |
| Soul Stitch, Timebreak (Ancient) | needles + soul thread / clock-hand blades in slow motion |

The overlaps I watched for:
- **Beam.** Blast IV is a beam. Dragon breath has to read as a **living, turbulent stream** that grows and gusts,
  never a solid laser.
- **Fire.** Inferno already uses live particle fire. A blue fire stream would be a recolour if fire were the whole
  idea, so in every concept the fire is the vehicle and **the ward is the signature**.
- **Bubble.** Bubble Trouble wraps the target. Here the ward sits on the **attacker**, and it is hard, faceted
  arcane glass (hex-cell shimmer), not soap.
- **Nova wave.** Frost IV rolls a wave across the screen, so any counter-wave here starts from the ward and runs
  **backward or radially**, not as a front sweeping toward the target.

No attack in the roster has the attacker **defending itself**, **recoil as a mechanic**, or blast energy going
**backward**. All three concepts stand on that.

---

## Concept A: "Recoil Ward" (the shield is the gun's stock)

- **Hook.** The breath is so strong it shoves the dragon backward, and the ward bubble behind it **soaks the
  recoil**. You watch the ward dent and charge up with the backward force. Then it snaps back and fires that stored
  energy **forward down the stream** as a second, bigger surge.
- **Wind-up.** The total dives into the hero. A hex-cell ward shimmers up round the portrait. The portrait drops
  into Iggy's crouch (squash down, lean toward the target) and blue light swells in the throat. Debris flicks off
  the portrait's base.
- **Magnitude (inside one cast).** The breath **shifts up in stages**: a thin blue gust, then a roaring cyan stream,
  then a white-cored torrent. At each shift the stream widens and gusts, the portrait slides back a step, and the
  ward behind it flattens harder against the push (a squash on the ward sprite's scale) while its hex cells light
  up further. I has one stage, II two, III three. Each stage that lands before the last is a tick on the target.
- **Travel and impact.** A connected, turbulent stream of cold-blue `pixiFire` along the attacker-to-target line,
  licking and curling, never a solid beam. The target is washed in blue flame and its portrait is shoved back.
- **Back-blast.** At the top stage the dented ward **rebounds**. A shockwave ring bursts off the back of the ward
  (behind the attacker, with debris blowing off-screen) and the rebound kicks one last bright surge pulse down the
  stream into the target. **That surge is THE impact.** At IV the rebound is so strong the ward shatters into glass
  shards behind the hero, and the surge detonates on the target in a blue flame-burst ring.
- **Why it's one-of-a-kind.** Recoil stored in a shield and fired back is new to the roster. The escalation is
  physical: you see the push grow on the ward.
- **Rarity.** Legendary (4 tiers). Mythic colour: crimson-gold flame inside a gold ward ("Gilded Iggy").
- **New pieces.** A ward-dome texture: a painted hex-cell glass bubble with a fresnel rim and a separate cell-glow
  layer whose alpha rises per stage. The breath stream drives a line-shaped `pixiFire` emitter (the `line` shape
  already exists) with a new cold-blue `FirePalette` value. Shockwave and burst come from the FX primitives'
  vocabulary.

## Concept B: "Deflection Charge" (it gets stronger by being shot at)

- **Hook.** Straight from the art's arrows sparking off the ward. Before the breath, the **struck hero fires back**:
  a volley of spectral arrows streaks at the dragon and **bounces off the ward** in sparks. Each deflection is
  absorbed and builds the charge. The dragon literally grows stronger from being shot at, then answers.
- **Wind-up.** The ward goes up and the portrait crouches. Arrows come in from the target (I two, II four, III
  seven, IV a dense hail). Each one *tinks* off the ward with a spark burst, and the ward flashes and shrinks a
  little tighter.
- **Magnitude (inside one cast).** A visible charge counter: each deflection adds a ring of blue light to the
  dragon's throat (a stacking pip ring round the portrait). The breath that follows is as wide as the rings
  stacked.
- **Travel and impact.** The breath, sized by the charge, rolls out as a stream. At III and IV, the deflected arrows
  frozen in the ward fly **back out inside the breath**, so the target is hit with its own arrows in blue flame.
- **Back-blast.** The ward **throws the stored deflections back** (the "reflect" moment). At IV the ward bursts
  outward in a radial counter-wave that flattens the incoming hail and then drives the breath.
- **Why it's one-of-a-kind.** It's the only attack where the target acts first. Escalation reads as a counter and
  pays off as a reflect.
- **Risk.** For a moment it reads as "the loser is attacking". The arrows have to be clearly weak and the ward
  clearly in control. It is also the longest wind-up of the three (incoming volley + breath), so I and II must stay
  brisk.
- **Rarity.** Legendary. Mythic colour: violet-white arrows and flame.
- **New pieces.** Arrows (a painted projectile texture plus a straight-line flight), the ward dome (as in A), and
  the charge pip ring. Burst for the deflection sparks.

## Concept C: "Bottled Inferno" (the ward is a pressure vessel)

- **Hook.** The dragon breathes **into its own sealed ward**. The bubble fills with swirling blue fire and swells
  under the pressure, with cracks spidering across it. Then it **ruptures**: the front face blows out into a jet at
  the target, and the back blows out in a backward blast.
- **Wind-up.** The ward seals round the portrait. The breath swirls inside it (a circular `pixiFire` disc confined
  to the dome), and the dome slowly swells (scale) as the fire inside brightens.
- **Magnitude (inside one cast).** The pressure climbs in clear steps: swell, a crack appears with a creak sound,
  swell, more cracks. I one crack, II two, III a web. You can read how big the blow is from how cracked the ward is
  before it goes.
- **Travel and impact.** The front of the ward ruptures. The pent-up fire **jets** at the target as one dense,
  fast, tapering plume (a cone, not a beam) and blasts the portrait back.
- **Back-blast.** The back of the ward blows out at the same instant: a backward cone of flame and shards and a
  shockwave behind the attacker, with the portrait kicked forward by the recoil. At IV the whole ward detonates.
  The jet fires forward, a radial blue shock ring rolls out from the attacker over the board, and the glass rains
  down.
- **Why it's one-of-a-kind.** Charge-then-rupture of the attacker's own shield. The cracks are a readable meter.
- **Risk.** It's close to a "charge then burst" shape that Blast and Poison IV already use (gather, implode or
  detonate). The difference is where it happens: on the attacker, not the target.
- **Rarity.** Legendary. Mythic colour: crimson flame inside an obsidian ward.
- **New pieces.** The ward dome, a crack overlay texture set (pre-painted crack stages, revealed by alpha), a
  confined swirl emitter (the `pixiFire` disc shape), and a cone jet.

---

## Recommendation: **Concept A, "Recoil Ward"**

- It hits all three words of the ask most directly: **blast** (a breath stream), **increasing magnitude** (gear-shift
  stages you can see on the stream *and* on the ward), and **powerful back-blast/ward** (the ward is the reason the
  final surge exists, and the back-blast ring is the payoff, not decoration).
- It's the most Iggy-faithful pose: the low crouch, the blue stream, the ward, and the debris from the claws.
- It's the clearest one-of-a-kind: recoil stored and returned isn't in any other attack. Concept C is next best,
  but its gather-then-burst shape sits closer to the existing roster.
- It's the cheapest to build well. It mostly reuses `pixiFire` (line emitter + a new palette), the shared camera,
  the shockwave and burst vocabulary, and the established 4-tier runner shape. The only new art primitive is the
  hex ward dome.

A mix worth considering: A's recoil ward with B's arrows **only at IV** (the hail sparks off the ward during the
top stage), for one extra Iggy beat on the big blows.

## Open calls for the owner

1. Which concept (or mix)?
2. Rarity: **Legendary** (my assumption). Or Ancient with a Knockout variant? Ancient attacks get Tier V
   (`KNOCKOUT_VARIANT_STYLES`).
3. **Mythic.** The catalog has no `mythic` rarity today (`rare / epic / legendary / ancient`). Per the standing rule,
   Mythic is a special colour inside the Legendary table. Do you want a Mythic colour variant built with this one?
   That means deciding how Mythic is represented (a separate cosmetic id at Legendary rarity with a Mythic label, or
   a flag), which is a first.
4. Name: placeholder "Dragon Blast" (id `attack_dragon_blast`, style `dragon`) until you rename it.
