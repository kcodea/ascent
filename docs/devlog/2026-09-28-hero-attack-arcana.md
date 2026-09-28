# 2026-09-28: Arcana, the third hero attack (and the owner's quality bar)

> **Update 2026-09-28:** every hit-stop / freeze frame was removed from all hero attacks (owner: "it looks like lag";
> oracle R-PROG-ATTACK-10). Mentions of a hit-stop below are history, and the timelines include it; the current end
> times are in `2026-09-28-damage-formation.md`.

Owner ask (2026-09-28): "let's branch out and make one more attack animation, same setup as the last 2, but let's make
like a magic one called arcana. tier 1 attack will be s clean pixi ribbon arc'd and lobbed from hero location. tier 2
attack will be 2 of those. tier 3 attack will be barrage of 5 of those. tier 4 attack will be a swirl of them over the
opponent hero frame and then they explode and ribbon/pixi blast outward".

Owner review: "arcana looks so god damn good", and "arcana is top tier good". **Arcana is now the owner's reference
bar for hero attack animations.** The techniques that got it there are written down below so the next attack can copy
them.

Stacked on Quake (`feat/hero-attack-quake`, PR #1797) because it runs on the shared hero-attack core that PR factored
out. Nothing changes for players until the owner deploys `progression-inventory` (the catalog sync adds
`attack_arcana`). The equip SQL already accepts the `hero_attack` slot, so there is no new migration.

## What shipped

- **Arcana** (`packages/ui/src/heroArcana/`). The shared combine runs first. Then an arcane circle opens under the
  striking hero and spins up while light gathers and a riser climbs. Clean magic RIBBONS are then lobbed on high
  arcs from the hero:
  - I: one ribbon.
  - II: two, one lobbed high and wide, one flatter on the other side.
  - III: a barrage of five fanned arcs, launched outer-first so the centre (biggest) ribbon lands last, in an even
    rhythm.
  - IV: the ribbons arc into a tilted ring over the struck hero's frame. The ring tightens and spins up under a rising
    synth tone while a sigil and a core of light build beneath it. Then the ribbons converge and EXPLODE: blast
    ribbons curl outward, three rings go off (the last a wide arcane shockwave), a sigil flares, and glitter and rising
    motes follow.
- **The consequence lands ONCE.** Barrage ribbons before the last are ticks (FX and a chime only). The damage, Armor
  and Resolve (`settleCombat`) land on the last ribbon, or on the explosion at IV. The hit-stop and the big `-N`
  land there too.
- **Sound** is layered from existing clips plus one new synth:
  - the shared ticks and slam;
  - a `castspell` cast;
  - an `fx/oona-powerup` riser that climbs to the first launch;
  - an `fx/djartmusic-christmas-sparkle-whoosh` per launch (pitch steps up);
  - an `equipmentsheen` shimmer in flight;
  - a `divineshieldbreak` crack per tick (pitch climbs);
  - `fx/blue-impact-hit`, `prismaticpick` (the chime) and `smack2` (the low punch) on the impact, plus `crit` on III;
  - IV: a soft chime as each ribbon joins the ring, a `runeselectimplosion` on the collapse, `turnexplosion` pitched
    up (a crack, not a boom) and `fx/triple-impact` aftershocks;
  - `playSwirlTone` in `sfx.ts`: two detuned oscillators and a tremolo that speeds up from 5 to 20 Hz, gliding
    upward and peaking exactly on the explosion.
- **Cosmetic**: `attack_arcana`, "Arcana" (the owner's name), Legendary (the owner's call), crate, style `arcana`. Its
  name sits close to Blast's placeholder "Arcane Barrage". The Collection's Attack Animations tab lists it with the
  in-place preview. The dev "Attack style" switch gains Arcana (the three tuners now share one label map).
- **Tuner** "Hero Attack: Arcana" (hub, 🔮) covers:
  - every ribbon dial: width per tier, length, glow, core, halo, twist, strand, head, sigil;
  - arc height, fan and launch stagger per tier;
  - ribbons per tier and the vortex toggle;
  - the swirl: radius, tilt, time, start and end spin, tighten, collapse;
  - explosion size and blast ribbons;
  - camera, colours, and a clip / gain / pitch per sound cue.

  Play both directions at Small 3 / Tier II 8 / Medium 12 / Huge 40, reduced motion, 1x / 0.5x / 0.25x, Copy JSON.
  Localstorage is DEV-only; production plays the baked defaults.

## The reference bar: what made Arcana read so well (copy these)

1. **One hero element, drawn as geometry, not particles.** The ribbon is five triangle-strip meshes (48 vertices each,
   so they still batch) on ONE centreline: a soft halo, an additive glow, an opaque body, an additive white core and a
   thin accent strand. Particles are seasoning (glitter off the head), never the subject.
2. **Mix blend modes on purpose.** An additive-only effect washes to white on a light board. The body and the halo are
   NORMAL blend, so the colour survives any background. The glow and the core are additive, so they bloom on dark
   ground. This one change took the ribbon from "pale comet" to "vivid violet".
3. **The core tapers faster than the body.** The head is white-hot and the tail stays the arcane colour, which gives a
   colour gradient without vertex colours.
4. **Trail = the motion sampled back in time.** A pure `ribbonPos(t)` is sampled at fixed steps into the past, with no
   history buffer. It is smooth at any frame rate, identical in a replay, and trails the lob, the orbit and the
   collapse for free. Faster motion gives a longer streak. The catch: a motion that decelerates hard (a quintic)
   collapses its own trail to a stub, so ease with a cubic at most.
5. **A lob rises toward screen-up, not perpendicular to the line.** Bowing sideways reads as a curved bolt. Lifting
   the controls toward the top of the screen makes the ribbon come DOWN onto the target. A ceiling keeps the apex in
   frame when the target sits near the top edge.
6. **Spread the arrival angles, not just the arcs.** A fan that converges on one line reads as one ribbon. Let the
   side offset carry into the second control point so each ribbon dives in from its own angle.
7. **Ticks are line work, the impact is fill.** Barrage ticks are a sigil flash and a ring over a tiny, quick flash.
   Stacking fills over five ticks made a white blob that stole the impact.
8. **Fills are short; line work lingers.** Every bright fill on the impact frame is gone within about 150 to 200 ms,
   so the big `-N` never sits in a white disc. The sigils, rings and ribbons carry the afterglow.
9. **Depth without a depth buffer.** The vortex is a tilted ellipse (tilt 0.5), and ribbons on the back half are
   dimmed, so a flat ring reads as 3D.
10. **Build, then release.** At IV the ring tightens and spins up while the zoom, the tremor, the core glow and a rising
    tone all build to one frame. The collapse is fast (120 ms, ease-in), then everything releases outward.
11. **Capture on a manual clock.** Driving the real runner through the `frames` seam and stepping it to exact beat
    times gives exact frames for review, which beats timing screenshots against a live clock.

## Timeline (ms at 1x, 1600 px apart; end includes the hit-stop)

| tier | ribbons | first launch | impact | end |
| --- | --- | --- | --- | --- |
| I (3) | 1 | 915 | 1475 | 2043 |
| II (8) | 2 | 1200 | 1945 | 2608 |
| III (14) | 5 (ticks every ~100 ms) | 1600 | 2605 | 3348 |
| IV (40) | 6, vortex from 2475, collapse at 3175 | 1900 | 3334 (explosion) | 4194 |

## Crate odds (first crate)

Common 46.8%, Rare 31.0%, Epic 19.0%, Legendary 3.3%. A non-title item is 31.7%. The three hero attacks together are
1.6% (each about 0.55%). Before Arcana: 47.0 / 31.2 / 19.1 / 2.7 / 31.3 / 1.1.

## Perf (PROD build, `vite build` + `vite preview`, 1600x900, 240 Hz, a temporary uncommitted hook to reach the runner)

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (40) | 1074 | 4.2 | 4.3 | 4.3 | 16.7 | 1 | 0 |
| IV foe (40) | 1073 | 4.2 | 4.3 | 4.3 | 25.0 | 1 | 0 |
| III (14) | 868 | 4.2 | 4.3 | 4.3 | 4.3 | 0 | 0 |
| II (8) | 698 | 4.2 | 4.3 | 4.3 | 8.3 | 0 | 0 |
| I (3) | 541 | 4.2 | 4.3 | 12.5 | 16.8 | 2 | 0 |

No DOM is left behind, and the `#stage` transform is restored after every run. Sprites and strip meshes are pooled per
layer (caps: 900 sprites, 140 meshes). The five textures are painted once per session, plus Blast's four, which are
shared. DOM moves are transform / opacity only.

## Verified in the browser

- The tuner preview, in both directions, every tier.
- A real practice fight with the dev style forced to Arcana, the foe striking you: the charge circle sits centred on
  the foe portrait and the impact centred on yours.

## Open for the owner

- The name "Arcana" is close to Blast's placeholder "Arcane Barrage". Rename either if it reads confusingly in the
  Collection.
- Legendary rarity, matching the other two, is the owner's call.
- Clips worth supplying (no ElevenLabs credits spent):
  - a short magical launch whoosh (0.4 to 0.7 s);
  - a light airy shimmer loop for the flight;
  - a bright crystalline chime-crack for the ticks and the impact;
  - a 0.8 to 1.2 s rising swirl or vortex whoosh (the synth tone stands in for it);
  - a punchy magical burst for the explosion (tight low end, glassy top).
