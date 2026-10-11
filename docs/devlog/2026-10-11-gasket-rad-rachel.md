# 2026-10-11: Gasket, Rad Rachel, Cavern Fiend archived

Owner adds of 2026-10-10 (Set 2 Demons), shipped together in PR #2026.

## Gasket (`dm_gasket`, T4 7/3 Demon)

"Rally: Deal 2 damage to all minions except friendly Demons." Gilded: "deals 2 damage twice".

- **One body, two triggers.** Fel Spikes' Echo spray was extracted unchanged into
  `sprayDamageExceptFriendlyTribe` (factories.ts). Gasket's `rallyDamageAllExceptTribe` calls it from the Rally
  trigger. So both cards share every rule: each pass is its own presentation wave (`ctx.wave`), a pass hits every
  victim at once, a body at 0 stops taking hits, and deaths resolve once after the final pass. Gasket is the source,
  so each landed hit counts toward Pummel and fires `friendlyDemonDealtDamage` (Leech, Axeman, Todd, Rachel). A Ward
  pops on the first pass. A target the pass kills is not then swung at (the existing "target died in the wind-up"
  settle).
- **Shop (judgement call, flagged).** A forced Rally in the Shop (Lasting Cadence etc., R-RALLY-FORCED-01) hits YOUR
  non-Demons only. There is no enemy in the Shop, and this is the Fel Spikes / Blaster shop ruling. The damage is
  permanent Shop damage, so the owner may prefer a no-op instead.
- Gasket and Rachel live in `SET2_DEMONS_1011`, appended after the rune-only Ruinous Lord, so no seeded pool
  position moved.

## Rad Rachel (`dm_radrachel`, T6 8/10 Demon)

"When a Demon deals damage, give your minions +2/+1." Gilded +4/+2. Every living friendly minion, Rachel included.

- Reuses `onFriendlyDemonDamageBuffTribe` from Ruinous Lord (#2024, merged first) with `tribe` omitted, which means
  every friendly minion. The Shop spray helpers and R-BUFF-PHASE-01 are main's; this PR adds Rachel to that rule.
- **Permanence, owner ruling 2026-10-11 (R-BUFF-PHASE-01, persistence domain):** "it is combat only if triggered in
  combat, if a minion is engraved, they obviously carry it back, and if the effect is triggered in recruit phase, it
  would be permanent." Combat half is a plain `ctx.buff` (Engraved carry-back applies). Shop half is a permanent
  `addBuff`.
- **New Shop path:** `friendlyDemonDealtDamage` had none. `fireShopDemonDealtDamage` (recruit.ts) fires per landed hit
  from the Shop spray (Gasket, Fel Spikes) when the source is a Demon (R-DEMON-DAMAGE-SHOP-01). Only effects with a
  Shop body answer. **Leech, Axeman and Impossible Todd still have no Shop body, so they stay combat-only.** That is
  a follow-up under the cross-phase-by-default rule.
- Presentation: many procs in one Gasket pass ride that pass's wave moment. Buff floats are not drawn, and the
  tendril channel groups per (source, target), so 13 procs draw one tendril per minion, not one per proc.

## Cavern Fiend archived

`k_gemgorge` moved verbatim to `ARCHIVED_CARDS` (still resolves by id for old saves and replays, member of no set).

## FX: the owner's `gasket` blast

- The def is the owner's Workbench save (`fx/defs/gasket.json`). Its values are identical to the export handed over,
  with the filter fields at Workbench defaults.
- Bound per card (`bindings.json` → `dm_gasket`) at `damage` and `shieldPop` with `fanOut: 'struck'`. One play is
  anchored on each unit a pass struck (a Ward pop included), on the pass's beat. Gilded plays it once per pass.
  `shieldPop` is bound too because a pass whose first victim has a Ward compiles to a `shieldPop`-led moment.
- **Fan budget** (`fx/fanBudget.ts`): one play is ~372 particles. A full pass is 13 targets, about 4,800 particles
  in one frame. `admit`'s thinning works in arrival order, so the first plays would be full and the last ones
  wisps. Instead, every play in a wide fan spawns at the same `intensity`, scaled to a 600-particle total per
  pass. A single target plays exactly as authored.
- **Beats:** the swing now PARKS at the top of its wind-up while the passes play (`wavesAheadOf`), then strikes on
  its own damage beat. `meleePairOfImpact` / `attackerOfImpact` skip wave beats: a pass is not the melee exchange
  (the defender keeps its blast), and the clash after the passes keeps its pair. This also corrects the latent
  Echohorn-forces-Fel-Spikes case (R-FX-WAVE-WINDUP-01).

## Perf (prod bench build, `VITE_PERF_BENCH=1`, `vite preview`)

**FX layer isolated.** `gasket` was fired on 13 board points the way a pass fires it, and the Pixi ticker was stepped
by hand at 4.17 ms (240 Hz), timing each tick. That is the FX layer's update and render. Gilded double pass (second
pass 500 ms after the first), four runs each:

| Budget per pass | Peak particles | Tick p99 | Worst tick | Ticks over 6.25 ms |
|---|---|---|---|---|
| none (as authored) | ~3,600 | 12-16 ms | 22 ms | 62-74 |
| 1,200 | ~1,400 | 1.0-1.4 ms | 4-9 ms | 0-1 |
| 800 | ~970 | 0.7-1.0 ms | 4.4-8.6 ms | 0-1 |
| **600 (shipped)** | ~960 | 0.6-0.9 ms | 1.7-1.8 ms | **0** |
| single target, as authored | 372 | 0.2 ms | 0.5 ms | 0 |

**Full 7v7 replay** (Gasket plus six friendly non-Demons against seven enemies, so 13 targets a pass, injected
through `__bench`): the Browser pane composites at 80 Hz, so vsync intervals cannot show a 6.25 ms miss, and the FX
tick time was recorded per frame instead. With the 1,200 budget this was plain p99 1.8 ms / worst 6.8 ms, and
Gilded p99 5.5 ms / worst 12.7 ms with 8 frames over 6.25 ms. That result is what set the budget down to 600. The
pane was hidden during the 600 run (rAF paused), which is why the final numbers come from the hand-stepped table
above. That table is the cost Gasket adds.
