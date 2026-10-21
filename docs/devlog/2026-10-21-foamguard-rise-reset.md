# 2026-10-21 - Foamguard re-arms on Rise and Rebirth

Owner ruling on Foamguard (from #2194): "no it should rise and gain ward, then reset when it's removed again".

#2194 built Foamguard's "the first time this loses Ward each combat, gain +10/+10 and Ward" on Yeti's convention:
a once-per-combat latch (`wardRegainFired`) on the combat instance that a Rise / Rebirth return did NOT clear, so a
returned Foamguard came back with Ward but could never fire again.

## The change

- `killOrReborn` in `packages/core/src/combat/simulate.ts` now clears `wardRegainFired` in BOTH return branches
  (Rebirth and Rise). Those are the only two places a dead combat body comes back (`dead = false`); any other
  re-summon is a fresh `Minion` with no latch.
- Ward on the returned body is unchanged: Rise keeps printed keywords (Foamguard prints Ward), and Rebirth restores
  a Ward the body carried this fight (`wardBroken`).
- The +10/+10 stays a combat-only gain (R-BUFF-PERM).
- No loop is possible: a reset needs a spent Rise or Rebirth (or a budgeted Deathtouched Apple re-arm), so the
  trigger fires at most once per body plus once per return.
- Yeti and every other "per combat" card are unchanged.

New rule `R-DWARF-1021-02` (triggers domain); `R-DWARF-1021-01` now says "once per body" and points to it.

## Tests

`packages/sim/src/set3DwarvesBatch1021.test.ts`: control (no return, one fire), Rise (returns with Ward, fires
again after the return, no permanent gain), Rebirth (two fires), two removals (Rebirth then Rise, three fires) and a
loop guard (two Foamguards a side with Rise, Rebirth and Resilient Ward: the fight ends, at most one fire per body).
The three return tests fail with the `simulate.ts` change reverted.

## Other cards that still stay spent through a return (owner to decide)

Their per-combat counters are on the instance and are not on the Rise / Rebirth reset list:

- Pummel caps (`pummelFires`): Tauntbreaker, Impossible Todd, Kobe (twice), Han Gover (max 5), Goldvein, Maestro Lux.
- Evolving Abomination (Rally double, twice per combat, `bredCount`); Brood Matron (Imp cap, `bredCount`).
- Whaloo (3 Runebind casts per combat, `whisperCastsUsed`).
- Immune Iggy and Bounty Bot (Immune on the first N swings, `attackImmuneLeft`).
- Gryphon (free refresh up to 4 hits a combat, `grantedRefresh`).
- Yeti (archived; `reflectFired`).

## Presentation: break, then buff, then the Ward re-forms

Owner ask on the same PR: "can you show the ward break and then get re-applied? i think it'd be more satisfying".

Before: the engine emits `shield` (break), `buff` (+10/+10) and `shieldUp` (Ward back) in the same step as the hit,
and the replay grouped `shield` and `shieldUp` into the one impact moment. The frame committed with the Ward
already back, so the break read as nothing; the buff floated after.

Now (presentation only, `R-DWARF-1021-03`):

- `deferClashBuffs` (`packages/ui/src/choreo/clashOrder.ts`) pulls a TRIGGERED Ward gain (`shieldUp` with an effect
  `key`) whose body lost its Ward earlier in the same slice out to the end of that slice, after the deferred buffs.
  Skipped when anything later in the slice touches that body (another break, damage, a death), so the folded end
  state is identical. A wave pass (Fel Spikes, Gasket) gets the same treatment, the re-form leaving the wave.
- It then compiles as its own `shieldGain` moment, so the existing `ward-gain-blast` binding and Ward-gain sound
  play on it. No new FX and no CSS: nothing loops, nothing paints per frame.
- `holdMs` (`choreo/clock.ts`) lands it `WARD_REFORM_AFTER_BUFF_MS` (160 ms) after the buff beat, which itself
  shows 210 ms after the break: break to re-form is ~370 ms at 1x (320 ms straight after the break when there is
  no buff beat). One replay path serves both sides, replays and spectating.

Frame sequence at 1x (one Foamguard fire):

| t (ms) | Moment | On screen |
|---|---|---|
| 0 | impact (`shieldPop` / `damage`) | Ward shatters (`ward-lost-blast` + break sound); Ward dome gone |
| 210 | `buffWave` | +10/+10 rolls onto Foamguard; still no Ward |
| 370 | `shieldGain` | Ward dome back, `ward-gain-blast` + Ward-gain sound |
| ~870 | next swing | the next attack winds up (result-beat breather) |

Test: `packages/ui/src/choreo/wardReform.test.ts` (both sides, the risen body's second fire, the 250-400 ms gap,
identical folded end state, and the two guards).
