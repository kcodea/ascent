# 2026-10-02: Ancient hero attacks get a Knockout variant ("Tier V")

Owner ask (2026-10-02): "ancient tier animations should have a separate tier of dmg specific for knockouts. they can
just be small changes to the 'huge' tier. in some cases just adding a hit or something and some color changes or
something like that but slightly more emphasis on the knockout animation. can you do this for all 4 ancient tier
animations? arcana, consecration, soul stitch, and the rewind attack are all ancient tier."

Oracle R-PROG-ATTACK-20 (extended with the Ancient exception). Stacked on `feat/attack-soul-stitch` (#1910).

## The rule

- A knockout always plays Tier IV ("Huge"), every style (2026-09-29, unchanged).
- EXCEPT an attack of the **Ancient** rarity that has a Knockout variant: it plays that instead.
- An Ancient attack with no variant yet falls back to Huge. Every other rarity, and Classic, keeps playing Huge.
- Without a knockout, an Ancient attack plays its normal damage tiers.

It is driven by the cosmetic's **rarity** (the catalog in `@game/progression`), not a list of ids.

## How (the plumbing)

- `packages/ui/src/heroAttack/knockoutVariant.ts`: `knockoutVariantFor({ style, knockout, cosmeticId })`. It is true only
  for a knockout, an attack whose rarity is `ancient` (`attackRarityOf`: the equipped cosmetic's, else the catalog's
  entry for the style, so the dev style override works too), and a style listed in `KNOCKOUT_VARIANT_STYLES` (the runners
  that HAVE a variant: `arcana`, `holy`, `stitch`).
- `Recruit.tsx` computes it once next to `knockout` and passes `knockoutVariant` to the runner.
  `HeroAttackOptions.knockoutVariant` and `AttackTierContext.knockoutVariant` carry it. `isKnockoutVariant(input)` in
  `tiers.ts` is the one check a plan makes (knockout AND the flag).
- The shared tier stays **IV** underneath (every per-tier dial reads IV, `plan.tier === 4`). The variant is a flag on
  top (`plan.ko`), so nothing that reads the tier (the damage formation's `k`, tests, tuners) moves.
- `packages/ui/src/heroAttack/knockout.ts` holds the four accents every variant shares: the Ancient prism
  (`KO_CYAN` #8af5ff, `KO_LILAC`, `KO_MAGENTA` #ff7ae0), `KO_SHAKE` (1.3x), the slow-mo dip (`KoDip`, `koTimeScale`,
  `koDipExtraMs`, `scaledFrames`: a smoothstep ramp from 0.35x back to 1x over 300 ms, never 0, never a freeze,
  R-PROG-ATTACK-10) and `playKoSting` (a two-note synth bell, no clip, so never the rune explosion or turn explosion
  sounds).
- Tuners: Arcana and Consecration have "▶ Knockout (40)" and "▶ Foe knockout (40)" in their action rows. The shared
  `rareTunerSpec` builder grew an optional `knockoutHint`; set it and the two buttons appear (Soul Stitch uses it).
  `playAttackDemo` / `DemoOpts.knockout` play the blow as a knockout with the variant.

## The three variants (small remixes of each Huge)

- **Arcana**: the vortex THROBS once more where it would have collapsed (`koPulseAt`: a cyan then magenta pulse ring,
  a prism sigil, prism glitter, a deep chime and a thump, a small camera punch); the collapse and explosion move back
  300 ms. The explosion gets a prism layer (two wide cyan and magenta shockwaves, prism sigils, a second ring of eight
  prism ribbons curling the other way, prism glitter), the sting, 1.3x shake and the dip.
- **Consecration**: a beat (300 ms) after the six-sword barrage, a SEVENTH, 1.35x bigger knockout sword with a magenta
  aura and a cyan trail flies in through the gap beside the first blade and is driven point first into the very middle
  of the star (a prismatic flare round the hub, a heavy thump and a low bell). The barrage's own six swords, their ramp
  and their sounds are untouched. The eruption throws a wider (1.5x) cyan, magenta and lilac consecration ring plus
  prism motes, the sting, 1.3x shake and the dip.
- **Soul Stitch**: the heart-knot DOUBLE-CINCHES. Where it would have tied, it squeezes once more, hard (the knot's
  tightness bumps 0.22 past snug for 240 ms, so the loops close tighter and the portrait crushes smaller) in a
  prismatic flash; the tie waits 280 ms for it. The burst gets a prism layer (cyan and magenta shockwaves, prism
  streaks and sparks, eight prism soul ribbons through the gold ones), the sting, 1.3x shake, and a deeper (0.25x),
  100 ms longer slow-mo dip than its Huge one.

## Added length and perf (Knockout minus Huge, a 40 blow)

Measured in the dev build in Chrome (manual frame stepping at 60 fps through the real runner, real textures, the real
Pixi `above` renderer drawing every frame, `gl.finish()` included; median of 3 after warm-up):

| attack | added length | peak live sprites | mean frame cost (update + render) | max frame |
|---|---|---|---|---|
| Arcana | +500 ms | 173 -> 215 (+42), meshes 36 -> 60 | 0.09 -> 0.12 ms | 0.9 -> 0.6 ms |
| Consecration | +483 ms | 458 -> 497 (+39) | 0.085 -> 0.097 ms | 0.7 -> 0.8 ms |
| Soul Stitch | +417 ms | 191 -> 219 (+28) | 0.10 -> 0.11 ms | 0.8 -> 1.2 ms |

All far inside each scene's cap (Arcana 900 sprites and 140 meshes, Holy 900, Stitch 520) and the 16.7 ms budget. No
looping paint properties (all Pixi; the DOM still only moves `transform`). Caveat: the Browser pane was hidden, so the
compositor never presented a frame; GPU cost here is only what `gl.finish()` waits on.

## Tests

`packages/ui/src/heroAttack/knockoutVariant.test.ts`: the plumbing (Ancient + knockout plays the variant; Ancient
without a knockout plays the normal tiers; every non-Ancient attack plays Huge, even if wrongly listed; an Ancient
attack with no variant falls back to Huge); each variant end to end through its runner (tier IV underneath, more than
150 ms and at most ~520 ms longer than Huge, inside the sprite cap, the consequence landing exactly once, the clock
advancing every frame); each variant's extra beat; the dip never reaching 0; a style with no variant ignoring the flag;
the tuner buttons.

## For the Rewind builder: plugging Rewind in (a few lines)

Rewind is Ancient, so the rarity half already works the moment its catalog entry is `rarity: 'ancient'`. Until it has a
variant it plays Huge on a knockout (the fallback). To give it one:

1. **Mark it as having a variant**: add its style to `KNOCKOUT_VARIANT_STYLES` in
   `packages/ui/src/heroAttack/knockoutVariant.ts` (e.g. `new Set(['arcana', 'holy', 'stitch', 'rewind'])`).
2. **Pass the flag into the plan** in its runner: `rewindPlan({ total: o.total, knockout: o.knockout,
   knockoutVariant: o.knockoutVariant, ... })` (its `*PlanInput` already `extends AttackTierContext`).
3. **Read it in the plan**: `const ko = isKnockoutVariant(input);` (from `../heroAttack/tiers`). Keep `tier` from
   `attackTier` (it stays 4). Add `ko` (and the extra beat's time, e.g. `koXAt`) to the plan; push that beat's cue; add
   `dip: ko ? { at: impactAt, lo: KO_DIP.lo, ms: KO_DIP.ms } : null`; multiply `shakePx` by `KO_SHAKE` when `ko`.
4. **In the runner**: on the extra cue, draw the extra beat; on the impact, `if (plan.ko) { scene?.koFlourish(...);
   playKoSting(voices, sound, real); }` with a `koFlourish` in its scene using `KO_PRISM` / `KO_CYAN` / `KO_MAGENTA`; wrap
   its frame source in `scaledFrames(base, () => (seq && !seq.done ? koTimeScale(plan.dip, seq.t) : 1))` and add
   `koDipExtraMs(plan.dip)` to its safety timer.
5. **Tuner**: if it uses `rareTunerSpec`, set `knockoutHint: '...'`; otherwise add the two actions (`demo('player', {
   damage: 40, parts: 7, knockout: true })` and the `'opp'` one) and thread `knockout` through its `demo` into
   `playAttackDemo`.
6. **Test**: add `['rewind', (o) => playHeroRewind({ ...o, textures: TEX }), MAX_REWIND_SPRITES]` to the `cases` in
   `knockoutVariant.test.ts`, and its tuner to the tuner check. The added-length bound (<= ~520 ms) and the cap check
   come for free.

Keep it a remix: one extra beat, the prism, the shake, the dip, the sting, at most about 500 ms over its Huge.

## 2026-10-02 owner tuning

Owner feedback (on Consecration's Knockout screenshot): "for consecration -> make the wave that comes out pink + gold
instead of just gold. for arcana -> make the swirling turn reddish pink and blue and explode outwards more to be a bit
more different. for soul stiatch -> do a second, faster pull. after the heart knocks them back, latch on and then yank
and have the attacking hero slam into them in the middle of the board."

Scope, owner-confirmed ("those are for the knockout versions"): only the three KNOCKOUT variants change. Every Huge tier
is untouched (each new path is gated on `plan.ko`; the tests check Huge keeps its own colours, cues and timings).

- **Consecration KO**: the wave that comes out is pink + gold. `HeroHolyScene.setKoWave` (set from `plan.ko`) makes the
  release, the flat blast (its layers alternate hot pink `HOLY_KO_PINK` #ff4fa3 and gold `HOLY_KO_GOLD` #ffd36b, with a
  rose #ff8fc7 edge), the surge (band, head, cracks, forks, motes) and the eruption (ring, glow, flame tongues) interleave
  pink with gold. The extra rose ring on the release is one sprite. Everything else (the seventh sword, the prism ring,
  the sting, the dip) is unchanged.
- **Arcana KO**: the swirl turns crimson-pink and electric blue. `HeroArcanaScene.setKoSwirl`: every ribbon that joins the
  vortex blends (a tint lerp over `ARCANA_KO_TURN_MS` = 260 ms, no paint property) to crimson-pink #ff3d7f or electric
  blue #3d8bff, alternating round the ring, its strand the other colour. The vortex sigil goes pink, the inner one sky
  blue, plus a wider blue sigil counter-swirling against the pink. The extra pulse and the aftershocks went pink and blue.
  The explosion bursts OUTWARD much harder (`explode({ ko })`): 4 more flung ribbons, 1.7x as far, 22% faster, curling a
  third as much (they read as thrown out, not spun), rings 1.35x wider and faster, 14 longer spikes, faster glitter. Over
  it `koFlourish` (now pink/blue, not the cyan/magenta prism) adds a big expanding blue ring (14x, 560 ms), a pink one and
  a wide flat sky-blue one (17x), 10 ribbons flung almost straight out, and a far ring of 12 outward streaks.
- **Soul Stitch KO**: a new final beat. After the heart-knot bursts (now a tick: FX only, `burstAt`) and flings the
  target home, three fast gold-cored needles LATCH on (`koLatchAt` = burst + 170 ms, they bite at `koLatchedAt` 150 ms
  later), the SECOND, FASTER YANK (190 ms against the first yank's tier TugMs) hauls the target toward the middle while the
  striker's portrait winds back and LAUNCHES at it, and they SLAM together in the middle of the board (`impactAt`: the
  damage lands here, once). The slam: a white-gold flash, a nova, a gold and a violet shockwave, crystal shards and light
  streaks sprayed out sideways, the latch needles shattering, soul ribbons, the prism flourish, the KO sting, the KO shake
  and the slow-mo dip (moved from the burst to the slam). Both portraits hold contact 50 ms, then spring back to their
  spots by `koHomeAt` (slam + 300 ms), EXACTLY home (`koSlamAt` is 0 from there).
  - The pose is pure (`koSlamAt`) and the meeting point is in the geometry (`geo.slam`: the middle of the gap between the
    rims, each portrait 0.82 of its radius short of it). Positions come from the at-rest measure (`restingRect`, the heart
    fix), transforms only. The striker is raised over the target from the latch (its own side's `.duel-attacker-*`; the
    target's raise is dropped). Every exit (end, finish, cancel) restores both transforms and both classes, and a class
    that was already on is left alone.
  - `StitchPlan.burstAt` is new (on every other tier and on Huge it equals `impactAt`), and every burst-keyed function
    (needles, tug, drag, knot, camera, the scene's snap and knot) reads it, so Huge did not move.
  - No rune or turn explosion sounds: the slam uses the style's own strike, impact, thump, snap, shatter and boom clips.

### Timings (a 40 knockout, real time at 1x, from the frame count)

| attack | Huge | KO before | KO now | KO now minus Huge |
|---|---|---|---|---|
| Arcana | 5233 ms | 5733 ms | 5733 ms | +500 ms |
| Consecration | 6483 ms | 6967 ms | 6967 ms | +483 ms |
| Soul Stitch | 6467 ms | 6883 ms | 7350 ms | +883 ms (+467 ms over the previous KO) |

### Perf (each KO against its previous version)

Same method as above (dev build in Chrome, manual 60 fps frame stepping through the real runner, real textures, the
real Pixi `above` renderer drawing every frame, `gl.finish()` included; 1 warm-up then 5 runs, median shown):

| attack | peak sprites | peak meshes | mean frame (update + render) | p95 | max (median run) |
|---|---|---|---|---|---|
| Arcana KO | 215 -> 233 | 60 -> 78 | 0.176 -> 0.185 ms | 0.5 -> 0.5 ms | 1.2 -> 1.9 ms |
| Consecration KO | 497 -> 502 | - | 0.123 -> 0.127 ms | 0.4 -> 0.4 ms | 1.7 -> 1.6 ms |
| Soul Stitch KO | 219 -> 215 | - | 0.154 -> 0.153 ms | 0.4 -> 0.4 ms | 1.4 -> 1.2 ms |

All inside the caps (Arcana 900 sprites / 140 meshes, Holy 900, Stitch 520) and far inside the 16.7 ms budget. No
looping paint properties (all Pixi; the DOM moves are `transform` only). Same caveat as before: the Browser pane was
hidden, so the compositor never presented a frame.

### Tests

`knockoutVariant.test.ts`: the length bound is per style now (Soul Stitch's KO may add up to ~1 s over Huge, the others
520 ms); Arcana's swirl paints pink and blue (Huge never does) and its KO explosion has more ribbons and a ring well over
1.3x as wide; Consecration's wave paints pink AND gold (Huge never pink); Soul Stitch's cue chain (burst, latch, yank,
slam). `heroStitch.test.ts`: the plan (the burst a tick, the second yank faster, the slam the one impact, the dip on the
slam), the pure pose (wind-up, accelerating haul, contact, exactly home, the meeting point), the runner (the burst does
not land, the latch threads bite, the blow lands once on the slam with both portraits in the middle), and the guards
extended to the striker's portrait: both transforms and both z-order classes restored on every exit, both sides, plus
mid-slam finish / cancel and a pre-existing striker class left alone.

## Follow-ups

- The variants' own numbers are fixed constants (`ARCANA_KO`, `HOLY_KO`, `STITCH_KO`, `KO_DIP`, `KO_SHAKE`), not tuner
  dials. If the owner wants to tune them live, they can be promoted to config keys.
- Owner review on 5173 of the three variants (the tuner's Knockout buttons).
