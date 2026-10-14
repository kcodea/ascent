# 2026-10-13: Demon-damage timing: every trigger fire is its own tick (R-DEMON-DMG-BEATS-02)

Owner ask, 2026-10-13:

> look at our rally timing for dragonflame minions, and look at our echo timings for everything. Now look into gasket
> and fel spikes and their timings with and without rad Rachel and similar style buffs that work off of demon damage.
> The demon damage animation timings feel off and go off in instant chunks instead of feeling smooth like our
> dragonflame triggering minions. Please explain whats wrong here and recommend fixes so our rally, echo, and
> triggered buff timings are uniform.

Status: **shipped** (phase 2 below). Phase 1 was the diagnosis; its instrumentation is
`packages/ui/src/choreographer/timingProbe.test.ts` (skipped unless `PROBE=1`):

```
PROBE=1 npx vitest run packages/ui/src/choreographer/timingProbe.test.ts
```

It simulates each scene with the real engine, runs the replay's own moment list (`replayBeats`) and clock (`holdMs`),
and prints every beat around the trigger: kind, what commits in that one frame, how many effect fires were folded into
it, and how many tendrils it draws. The engine-driven segments (wind-up, rally pause, park, strike) are the constants in
`lungeConfig.ts`, `choreo/engine.ts` and `useCombatReplay.ts`, so the times below are the schedule the code produces at
1x, not a stopwatch. (A live badge/FX trace was attempted on a dev server, but the Browser pane was hidden, so rAF and
GSAP were frozen. Worth repeating on a visible prod bench build in phase 2.)

## The timing table (1x speed, ms from the trigger's start)

| Scene | Beats the trigger spans | Where the numbers land | How many fires share ONE roll |
|---|---|---|---|
| **Flamebeat Drake** swing, 5 Dragons (Rally: cast Dragonflame) | 1: the cast and Earthbreaker's reaction are absorbed into the wind-up | wind-up 0-540, pulse at 540, flame columns + tendrils at 540, numbers roll 680-1330 (`AUTHORED_BUFF_ROLL_MS` 140, roll 650), pose held to 1640, strike contact ~1810 | 1 cast, lumped per target (a Dragon picked twice gets +8/+8 in one roll) |
| Gilded Flamebeat + gilded Captain Flamus | 1 | same as above | **4 casts + 4 Earthbreaker fires in one roll** (+16/+16, +8/+4) |
| **Gasket** alone, plain | 3: wind-up (parked), pass, strike | park at 980 (540 wind-up + 440 rally pause), pass: all 9 hits + 9 blasts at 980, strike resumes 1930 (690 + 260 parked lead), contact ~2100 | n/a |
| Gasket alone, Gilded | 4 | pass 1 at 980, pass 2 at 1670, contact ~2790 | n/a |
| **Gasket + Rad Rachel**, plain | 4: wind-up, pass, reaction, strike (+ a 5th: the strike's own Rachel reaction) | pass 980; reaction beat 1180 (`HIT_REACTION_LEAD_MS` 200), tendrils land 1390, roll to 2040; strike contact ~2300; the strike's Rachel reaction at 2510 | **9 Rachel fires in one tendril and one roll per minion: +18/+9 jumps at once** |
| Gilded Gasket + Rachel (+ Ruinous Lord) | 6 | pass 980, react 1180, pass 1870, react 2070, contact ~3190 | 8-11 fires per reactor per pass, one roll each |
| **Gasket + Rachel + Impossible Todd** | 3 (**the reaction beat is LOST**) | pass 980 commits the damage AND every reaction buff; no tendril, no roll; the badges are held and then **snap** when the strike's beat installs (~2100) or the 2000 ms TTL fires | 8 Rachel fires, invisible, then one snap |
| Gasket + Rachel + **Rune of Ruins** | 4, but Rachel is folded into the pass | Rachel's 6 fires: invisible, snap later; only the rune's last pulse gets the reaction beat | as above |
| Gasket + Rachel, victims die / a victim has a Ward | 4 | as the plain row (the split survives deaths and Ward pops) | lumped |
| **Fel Spikes** Echo, plain (D = the killing clash) | 2: death, volley | spikes launch D+400, land D+670, numbers D+750 (`echoDeliveryLead`) | n/a |
| Fel Spikes, Gilded | 3 | volley 1 D+750, volley 2 D+990 | n/a |
| **Fel Spikes + Rachel + Leech** | 3 | volley D+750, reaction D+950 (tendrils land D+1160, roll to D+1810), next beat D+1590 | **8 Rachel + 8 Leech fires in one roll each** (+16/+8 per minion) |
| Gilded Fel Spikes + Rachel + Ruinous Lord | 5 | volley 1 D+750, react D+950, volley 2 D+1590, react D+1790, next D+2430 | 8 per reactor per volley |
| **Rad Rachel melee swing** (reference) | 2: clash, reaction | contact C, reaction C+210, tendrils land C+420, roll to C+1070 | 1 fire per hit (clean) |
| **Echo, summon** (Knocked) | 2: death, summon | summon at D+240+800 = D+1040 (`DR_SUMMON_LEAD`) | n/a |
| **Echo, buff** (Armadiyo) | 3: death, aura, buff wave | aura D+450, buff wave D+660 (the `DR_BUFF_LEAD` 500 is skipped because the aura beat sits between the death and the buff; a plain Echo buff lands at D+710) | 1 |
| **Forced Echo by Rally** (Echohorn → Armadiyo) | 1 (absorbed) | pulse 540, tendrils at 540, roll to ~1400, strike after the pose | 1 |
| Gilded Echohorn → Armadiyo | 1 | **2 rally pulses 320 ms apart, but ONE tendril per target at the first pulse carrying both procs (+4/+8)**; the second pulse has no consequence of its own | 2 procs in one roll |
| Echohorn → Fel Spikes (+ Rachel) | 4: wind-up (parked), volley, reaction, strike | as the Gasket row | lumped |

## What is wrong

### 1. A hard bug: the Demon reaction beat is silently dropped whenever a reaction emits anything but a `buff`

`hitReactionStart` (`choreo/hitReactions.ts`, R-DEMON-DMG-BEATS-01) splits a wave pass into "hits" and "reactions" by
walking back over the pass's TRAILING `buff` events. `deferClashBuffs` (`choreo/clashOrder.ts`) only slides `buff`
events past results, inside runs made of results and buffs. Any other event a reaction emits per hit ends the run, so the
tail is no longer pure buffs and the split returns -1:

- `tribeAura` from Impossible Todd's Imp aura (`grantImpBuff`), every landed hit;
- `questTrigger` from Rune of Ruins (`fireTrigger('runeRuins')`), every landed hit;
- a Pummel payout `summon` (Todd's Imp, Han Gover), `handBuff`, `improve`, `keyword` from any future reactor.

The reactions then fold back into the pass's `damage` moment. That kind has no `buffCast` / `buffSelf` cue, so no
tendril is drawn and nothing schedules the roll. The install effect has already held the badges at their pre-buff
value; the hold is released (a snap, `releaseStat`) when the next beat's install effect clears `combatHeldRef`, which is
the strike's contact, or by the 2000 ms TTL. The result is exactly the report: the buffs **go off in one instant chunk,
late, with no source shown**, landing on top of Gasket's strike. Todd + Rachel is the natural Demon end board, so this is
probably what the owner sees most. The same bug hits Fel Spikes volleys.

### 2. A design gap: every trigger fire is summed into one tendril and one roll

`groupBuffCasts` (`choreo/channels/buffCast.ts`) sums every buff per (source, target) in a moment. A reaction beat for a
pass with 9 landed hits therefore draws one Rachel tendril per minion and rolls +18/+9 once. One hit and nine hits look
identical except for the size of the jump; the fixed `HIT_REACTION_LEAD_MS` 200 / `HIT_REACTION_READ_MS` 640 do not
scale with the number of fires either. That is the "instant chunk" even when the split works.

The same summing is why the other multiplied triggers lose their count:

- Gilded Echohorn pulses twice (`rallyProcsFor` + `RALLY_PROC_STRIDE_MS`) but its buffs fire once, summed, at the first
  pulse (`onWindupBuffs` → `fireBuffCasts`).
- Gilded Flamebeat + gilded Flamus: 4 Dragonflame casts and 4 Earthbreaker reactions, one roll per target.

The codebase already has the tools for per-fire presentation, used elsewhere and well received:

- `choreo/sourceCascade.ts` `steppedRevealPlan` + `scheduleSteppedRoll` (King Oona: "each doubling one at a time", the
  badge walks through every true value);
- the Ruby cascade (`rubyFx`: `cascade` + `scheduleLands`, `gap` between recipients, `beat` within one);
- the Shrieker chain (`children: 'sequential'`, `CHAIN_LINK_PACING`, one tendril per fire).

None of them is used by the Demon reaction beat, the wind-up buff path or the Echo buff wave.

### 3. Why Dragonflame reads smooth anyway

Dragonflame also lumps (problem 2), but a swing has ONE cast, and everything happens inside ONE beat: the attacker
rears back, pulses, the columns land on each target, each number rolls ON its column (140 ms), the pose holds until the
rolls finish, then the strike. There is no clock seam between cause and effect and no fixed hold standing in for the
animation.

Gasket + Rachel spreads the same story across four or five beats joined by fixed holds (park, pass, 200, reaction, 640
or 690, 260 parked lead, strike, 210, the strike's own reaction). Each seam is a moment where everything commits in one
frame. With problem 1 present, the middle beat vanishes entirely.

The raw offsets are actually close: a consequence lands about 400 ms after its trigger in every family (Rally 140-210
after the pulse, a melee Demon reaction 420 after contact, a pass reaction 410 after the pass, an Echo buff about 700
after the death because of the deliberate death read). **What is not uniform is the granularity (fires per roll) and the
fold bug, not the base latency.**

### 4. Smaller inconsistencies found on the way

- An Echo that emits a `tribeAura` before its buffs (Armadiyo) splits into an aura beat and a buff beat, and the death
  read (`DR_BUFF_LEAD`) is skipped because the aura sits between the death and the buff. It lands at D+660 vs D+710 for a
  plain Echo buff, as two beats instead of one.
- `scheduleEchoVolleys` (Fel Spikes) times its spikes on its own timers and mirrors the clock with constants
  (`reactionShift = LEAD + READ - PASS_GAP`). It agrees today. Any change that makes the reaction beat's length dynamic
  must move both through one shared function, or the spikes desync from their damage beats.
- `buffFxRender.ts`'s comment says the tendril flight is ~384 ms; every `tendril-trail*.json` ribbon is 210 ms (the code
  reads the def, so only the comment is stale). `hitReactions.ts` repeats the 384 in its `READ` rationale.

## Owner answers (2026-10-13)

1. "every trigger of the effect should get its own beat, like every volley from fel spikes, every rally trigger from
   gasket. the buffs should per tick if possible."
2. "the whole pass i think so it doesnt take forever to show and look kinda goofy" (keep the pass whole, no sweep).
3. 160 ms a tick, ~1.6 s cap: "we can try that and adjust if needed".
4. "the dragonflame animation seems like it's perfect already assuming it is working correctly." (do not touch it).

## What shipped (phase 2, presentation only)

- **The dropped beat.** `deferClashBuffs` now partitions a whole wave slice in one go: the volley's own events (damage,
  Ward pops, deaths, the bodies they summon) first, then EVERYTHING the reactions emitted (buffs, Todd's `tribeAura`,
  Rune of Ruins' `questTrigger`, hand buffs, improves), stable on both sides. `hitReactionStart` walks back over that
  whole tail (`isReactionTailEvent`). The reaction moment is always scored as a `buffWave`, so its cues play even when
  a Todd aura leads it. Same folded frame at the end of the pass.
- **One tick per fire.** `reactionTicks` derives fires from the log (no engine stamp, `types.ts` untouched): a fire is
  a run of buffs sharing (effect key, source) with no repeated target, and a new tick starts when a fire identity
  repeats. For a pass that is one tick per landed hit, with every reactor that hit fired inside it. `compileMoments`
  stamps `Moment.ticks` on every hit-reaction beat and on any stand-alone buff wave of more than one fire.
  `useCombatReplay.fireBuffChain` plays tick k at `k x stride`: its tendrils (the same `fireBuffCasts` FX, numbers left to
  the chain) and one badge STEP per unit per tick (`steppedRevealPlan` / `scheduleSteppedRoll`, King Oona's mechanism).
  The `buffCast` cue hands a chained moment to it and `buffSelf` stands down.
- **One clock.** `REACTION_TICK_MS = 160` and `REACTION_CHAIN_CAP_MS = 1600` live in `choreo/hitReactions.ts`, the one
  place to tune them. `reactionChainMs(n) = (n - 1) x stride + HIT_REACTION_READ_MS` is read by `holdMs`,
  `echoDeliveryLead` and `scheduleEchoVolleys` (whose spike shift is now the real chain length), so the next volley,
  its spike and Gasket's parked strike all wait for the last tick. A one-fire reaction is exactly the old 640 ms read.
- **Rally.** A swing whose Rally fired more than once (Gilded Echohorn) steps its absorbed buffs one tick per proc,
  `RALLY_PROC_STRIDE_MS` apart, so each pulse delivers its own number. A cast is never chained (`chainEligible`
  excludes any buff with a `spellId` or a Ruby), so Dragonflame, Flamebeat and Flamus are byte-identical (regression
  test pins the swing shape and holds).
- **Perf: `chainTendrilPlan`.** Tendrils draw on every tick while the ribbons alive at once fit `CHAIN_RIBBON_BUDGET`
  (12): a cleave's 3 hits, a Gilded Echohorn's 2 procs. A wide pass (7-10 ticks x 7-10 tendrils) draws its full fan on
  the first tick only, and the later ticks are told by their number steps. Bursts are thinned to
  `CHAIN_PARTICLE_BUDGET` (2400 particles) either way.

### Perf measurement

The Browser pane was shared with another session and reported `visibilityState: hidden` during this work (rAF at 1 Hz),
so a visible prod frame trace was NOT possible (a later attempt reported `visible` but rAF still ran at 1 Hz: the
desktop window was occluded). Measured instead the documented hidden-pane way (`docs/performance.md`
§3b): PROD bench build (`VITE_PERF_BENCH=1`, `vite preview` on :5292), the FX layer's `ticker.update` driven by hand at
4.17 ms steps, each timed, firing the exact tendril schedule each design produces for the two scenes (warm, second run).

| Scene (tendrils fired) | FX tick mean | p95 | p99 | max | ticks > 6.25 ms | peak particles |
|---|---|---|---|---|---|---|
| Gasket + Rachel + Todd + Lord + Leech 7v7, one summed beat (10 at once) | 0.76 ms | 1.4 | 2.9 | 4.2 | 0 / 384 | 1,675 |
| same, ribbons on EVERY tick (7 x 10, thinned bursts) | 1.51 | 3.2 | 4.7 | 7.3 | 2 / 615 | 816 |
| same, ribbons on every tick, unthinned | 1.89 | 4.3 | 5.7 | 8.1 | 4 / 615 | 2,405 |
| Gilded Fel Spikes + Rachel + Lord + Leech 7v7, summed (7 + 7) | 0.76 | 1.5 | 3.0 | 4.8 | 0 / 586 | 1,967 |
| same, ribbons on every tick (2 x 10 x 7, thinned) | 1.64 | 3.0 | 4.2 | 9.4 | 2 / 1325 | 1,087 |

Ribbons (shader meshes) are the cost, not particles: on every tick they doubled the FX tick and put ticks over the
6.25 ms bar. So the shipped plan draws a wide pass's fan ONCE (the "summed" rows: identical plays, same cost as
before) and steps the numbers per tick. What is NOT measured: the main-thread cost of the badge steps (up to ~7 units x
10 steps per chain, each a short roll). The #2028 devlog's open item (a Rachel fight dropping to ~70 fps once stats
climb, suspected badge restyling) is the place to look; **a visible prod trace of a Todd + Rachel fight is still owed**.

## Tuning knobs (all in `packages/ui/src/choreo/hitReactions.ts`)

- `REACTION_TICK_MS` (160) and `REACTION_CHAIN_CAP_MS` (1600): the pace and the longest a chain may run.
- `HIT_REACTION_READ_MS` (640): the read after the last tick. `HIT_REACTION_LEAD_MS` (200): pass → first tick.
- `CHAIN_RIBBON_BUDGET` (12): raise it to draw tendrils on every tick of wider chains (perf cost above).

## Tests

`packages/ui/src/choreographer/demonDamageTicks.test.ts` (11): Todd / Rune of Ruins / Fel Spikes + Todd keep their
reaction beat; the reorder only moves events inside a pass; one tick per landed hit, each a single +2/+1; Gilded passes
interleave with both reactors in every tick; the hold covers the chain and grows with fires; the constants; a melee hit
is unchanged; the tendril plan stays inside budget; Dragonflame's swing is unchanged. 8 fail on `main`.
`demonDamageBeats.test.ts` (R-DEMON-DMG-BEATS-01) still passes unchanged.

## Phase 1 recommendations (kept for the record)

One rule for every triggered stat change, Rally, Echo or reaction: **one trigger fire = one tick**. Its source pulses,
its FX travels, and its number steps in when the FX lands. Ticks in a chain are spaced by one shared stride, and the
parent beat (the swing, the pass, the death) holds until the last tick has landed. Then:

1. **Fix the dropped reaction beat (the bug).** Inside a wave, slide every non-result event (not just `buff`) to the
   pass's tail, stable, and let `hitReactionStart` accept a tail made of any non-result events as long as one is an
   `ownBeat` reaction (or a Rune of Ruins pulse). Give the reaction moment the cues those events need (`tribeAura` wash,
   `questTrigger` badge pulse, a summon pop). Tests: Todd, Rune of Ruins, a Pummel summon mid-pass, deaths, a Ward, for
   Gasket and for Fel Spikes, plain and Gilded; each fails on `main`. Oracle rule R-DEMON-DMG-BEATS-02.
2. **Per-fire ticks in the reaction beat.** Split the reaction beat's buffs into FIRES: a contiguous run sharing (effect
   key, source), or better, a presentation-only `fire` sequence number stamped by `simulate`'s `withEffect` next to
   `key` / `srcCard` (a shared-boundary change to `CombatEvent`, needs Kevin's OK; derivable in the UI otherwise).
   Group the fires by the HIT that caused them, so tick k is "hit k's reactions": Rachel's tendrils and Lord's tendrils
   together, Leech's self pulse, each badge stepping +2/+1 through `steppedRevealPlan` / `scheduleSteppedRoll`. One
   shared stride (proposal: 160 ms at 1x, compressed so a chain never exceeds about 1.6 s: a 13-hit Gilded pass at the
   cap runs about 120 ms a tick).
3. **The clock follows the chain.** Replace the fixed `HIT_REACTION_READ_MS` with a pure
   `reactionChainMs(moment, events)` (last tick's land + a short read), used by `holdMs`, by `scheduleEchoVolleys`' spike
   shift and by `echoDeliveryLead`, so Gasket's strike and Fel Spikes' next volley wait exactly as long as the chain.
   Assert the compiled duration GROWS with the number of fires (the skill's rule: counting beats proves nothing).
4. **Apply the same tick to Rally and Echo.** `onWindupBuffs` (Flamebeat, Flamus, gilded Echohorn's absorbed Echo) and
   the `buffWave` cue play per fire too: gilded Echohorn's second pulse gets its own tendril and step; two Dragonflame
   casts in one swing land as two steps, the pose held for the chain (the wind-up already stretches per proc with
   `RALLY_PROC_STRIDE_MS`; it would stretch per tick instead). Fold an Echo's `tribeAura` into its buff beat so the death
   read applies to both.
5. **Optional, owner call:** make the pass itself a sweep (hit k, then its reactions, left to right), which is the true
   engine order, instead of all hits at once followed by the reactions. Prettier and more readable, but it reverses the
   2026-08 "a pass hits everything at once" presentation, so it is the owner's decision.

### Performance (must be measured before shipping, prod bench build)

Per-fire ticks multiply plays: a Gilded 7v7 pass with Rachel + Lord would go from 8 tendrils to up to ~11 ticks x 8.
Options, cheapest first: keep one tendril per (source, recipient) for the FIRST tick and drive later ticks with only the
source pulse plus the badge step; or route the tendrils through `fanBudget` thinning (`tendril-trail-demon` entry).
Nothing here adds a layout read per frame or a looping paint animation; stepped reveals reuse the existing roll
machinery. The `#2028` devlog's open item (a Rachel fight dropping to about 70 fps once stats climb, suspected per-frame
badge restyling) is directly relevant: more badge steps means more restyles, so that trace should be done first or
alongside.

## Follow-up: the owner's test of #2074 (2026-10-13)

> "looks good but fel spikes is doing a weird jank. the minions dance around as if it gets resummoned between volleys
> or something. also check the logic here - i think the echohorn dies before getting the buff which is 'true' but it
> shouldnt die, and should actually get the buffs from rachel."

### 1. The dance between Fel Spikes volleys (presentation, existed since #2028)

`computeFrame` keeps a dead Fel Spikes on the board as an invisible GHOST only while the CURRENT beat holds damage it
deals, so its slot is held through the spray and the row reflows once at the end. Since #2028 a volley's reactions are
their own beat between volleys, and that beat deals no damage: the ghost was dropped, the survivors slid into its slot,
and slid back out when the next volley re-held it (rows `m0,m1,m2,m3 | m1,m2,m3 | m0,m1,m2,m3 | m1,m2,m3`). It existed
on `main` whenever the split worked (Rachel without Todd); #2074 made it more visible by splitting in more cases and
lengthening the reaction beat. Fix: a beat carrying one of the sprayer's wave ids keeps the ghost.

### 2. Echohorn died before Rachel's buffs (engine, R-DEMON-DMG-DEATH-01)

Each landed hit fired its reactions on the spot, and `living()` excludes bodies at 0 or below, so a minion the pass had
already taken to 0 missed every Rachel buff from the rest of the pass and died, even when those buffs would have
saved it. Fix (`simulate.ts`, side-neutral, no `types.ts` change): inside a wave the landed Demon hits are queued and
flushed in hit order after the pass's damage (at the wave's end, or at its first death check), with bodies at 0 or below
counting as living during the flush. Deaths are then checked on the true Health. The Shop spray already buffed every
board card before its single death check, so it was left as it is. The replay's frame now carries the overkill debt
(`remainingHp` is floored at 0), so the badge shows the sim's number after the buffs (3 - 4 + 5 = 4, not 5).

Event order within a pass changes (all of the pass's `dmg`, then its reactions); the replay already presented it in
that order, so nothing on screen moves except the corrected outcome. No golden or replay fixture changed.

Tests: `packages/sim/src/demonDamageDeathOrder.test.ts` (7: Fel Spikes survive / still dies / order / mirrored sides,
Gasket survive / no reactor still dies, the Shop), 5 fail on `main`; two more in `demonDamageTicks.test.ts` (the row
stays still through the spray, the overkill debt), the first fails without the ghost fix.
