# Combat replay pacing — audit findings + handoff

**Date:** 2026-07-18 · **Author:** Kevin's session (Claude) · **For:** Mike (presentation seam)
**Status:** audit complete; one fix merged; the main attempt was **scrapped by owner playtest** (PR #542, closed).
**Line refs verified against `1071db84`.**

---

## 1. TL;DR

The owner reported: *"we keep having instances where things seem to be skipping combat beats / resolving
instantaneously. It never seems wrong, but it skips/catches up after certain animations or triggers occur."*

Two audits (sim-side beat emission, UI-side replay pacing) found **three independent root-cause classes**.
I shipped the safest one, attempted the rest, and the owner rejected the result on feel. **Important caveat:
the rejection may not have been a fair test** — see §5.3. The approach is probably salvageable; the *rollout*
was wrong.

| | Status |
|---|---|
| Start-of-Combat trigger beats + badge pulses | **Merged** — PR #541, in `main` |
| Opponent pinning (reload divergence) | **Revived** in PR #546 (matchmaking) — not part of the pacing work |
| `withBeat` contract, enforcement tests, choreo clock changes | **Scrapped** — PR #542, closed, branch deleted |
| Step-collapse seams | **Never built** — still queued |

---

## 2. How pacing actually works (two systems, one seam)

**Sim** (`packages/core/src/combat/simulate.ts`) stamps every event with a **step**:

- `stepN` counter; `nextStep()` opens a new "atomic resolution moment" (`:73`)
- `emit()` stamps the current step onto every event (`:78`)
- `fireTrigger(flag, side)` emits a `questTrigger` the UI turns into a badge pulse (`:81`)
- Documented contract (`:67–71`): **"the UI compiler can MERGE steps, never split them"**

**UI** (`packages/ui/src/useCombatReplay.ts` + `packages/ui/src/choreo/`) compiles events into **moments**
(beats) and plays them on a sequential clock:

- `compileMoments` groups events (`choreo/compile.ts:65`): a run of RESULT_TYPES collapses into one impact
  moment (`:32`); an `attack` **absorbs** following `buff/rally/summon/reveal/improve` into its wind-up (`:34`)
- `holdMs` (`choreo/clock.ts:25`): `beatDelay(primary.type) × cfg.speed ÷ combatSpeed`; baseline `speed = 1.5`
- Scheduler is one `useEffect` with a single `setTimeout` per beat (`useCombatReplay.ts:696–718`) —
  **no absolute timeline, no accumulator**

**The seam's key property:** anything sharing a `step` is *guaranteed* to render as one instantaneous beat.
Anything the clock schedules is *independent of how long the FX actually take.*

---

## 3. Root causes

### 3.1 The clock is decoupled from its own animations — **this is the "catch-up"**

The mechanism, precisely:

- For an attack, the scheduler **fully defers** — it schedules no timeout at all
  (`useCombatReplay.ts:705`: `if (shown?.kind === 'attackExchange' && engineAdvancingRef.current) return;`)
- The advance instead fires from the GSAP lunge at the **`contact`** position
  (`choreo/engine.ts:82` → `onContact: () => ctx.advance()`, placed at `channels/lunge.ts:101`)
- **Everything after contact is fire-and-forget and never extends the schedule**: the rotational rebound +
  elastic settle, the impact recoil, the crit burst, the Flurry wind-slash, the board crit-shake (a fixed
  300 ms, `useCombatReplay.ts` crit effect)

So during a long flourish, the following beats' short timers are already burning down. The board resolves
*underneath* the FX; when it clears you see the caught-up state. **Outcome always correct, intermediate
reads lost** — exactly the owner's description.

Aggravating cases:
- **Rally** holds the clock 440 ms at the top of the wind-up (`engine.ts:36`) and then releases into the
  batched result → reads as "pause on the trigger, then a burst."
- **Buff tendrils** literally snap: while a tendril flies, the target's stat badges are *held* at pre-buff
  values; if the beat tears down first, the holds are dropped unconditionally
  (`useCombatReplay.ts:901`) and the stats jump.

There is exactly **one** place that already solves this correctly: `deathConsequenceLead` /
`pulledHomeAttackerHold` (`useCombatReplay.ts:714`), which extends a beat for a DR-summon / Rise-return.
**That is the pattern to generalize.**

### 3.2 The sim collapses distinct triggers into shared steps

Since the UI can merge but never split, these are guaranteed-instant by construction:

| Collapse | Where |
|---|---|
| One Deathrattle's summons + buffs share one step; **echo doublers re-fire in the SAME step** | `simulate.ts:894` (`fireOwnDeathrattles`) + the inline rattle loop |
| Avenge payoffs share the death's step (only the `avenge` tag separates them) | `emitAvenge` at `:947`, `:1020` — no `nextStep()` between the death and the payoffs |
| A combat spellCast broadcast (Taragosa Growth + Guel + Forsaken Weaver reacting) rides the **swing's** step | `ctx.castSpell` at `:639` — no `nextStep()` |
| Echo Warden's extra copies share the original summon's step | `placeSummon`'s doubling loop |
| `applyAuras` at summon mutates stats with **no event at all** | `placeSummon` |

⚠️ **Adding `nextStep()` seams here makes fights longer.** More beats × existing holds = more wall-clock.
Do not do this without retuning holds in the same pass, or the fix reads as "combat got slow."

### 3.3 Config gaps + silent step-0 fold

- `hpGrant` hold is **0 ms** — literally instant (Sergeant procs)
- `holdMs` keys by **raw event type** (`clock.ts:30`), so `KIND_TO_KEY`/`holdMsForKind` in
  `choreoConfig.ts` is **dead code** — e.g. `ascend`'s intended 520 ms silently falls to the 300 ms default
- `questTrigger` holds a content-less ~450 ms beat while the badge pulses **in parallel** at a fixed
  1150 ms, *independent of combat speed* — so several overlap during a fast burst
- **Step 0** (before the first `nextStep()`) contains: both boards instantiated, all run-wide auras folded
  into stats (Undead/Imp/Beast/Magnetic/card enchants) with zero events, effect registration, and the
  `initial` snapshot. **Fleeting Vigor** is applied in the *reducer, before `simulate` runs*, and telegraphed
  by a single `sc` event unshifted onto the log with no `step`. All of this renders as the static opening board.

---

## 4. What's already merged (keep)

**PR #541** — SoC triggers get their own beats + badge pulses. Umbral Energy, Rulebreaker's Crown, Contract
Rewrite (was *fully* silent — no event at all), and Rune of Twilight now announce themselves; Rising Graves
and Passing Spears had their `fireTrigger` ordered **before** their `nextStep()`, so the badge pulsed on the
*previous* beat — fixed. Outcome byte-identical (steps are presentation-only).

If any of the rejected feel was *at the start of combat* (extra pauses before the first swing), **#541 is the
suspect, not the scrapped branch.** It's a small, isolated revert if so.

---

## 5. What I attempted, and what happened

### 5.1 The scrapped changes (PR #542 — read the closed PR's diff for the code)

**Sim (feel-neutral):**
- `withBeat(flag, side, effect)` — opens a step, fires the badge *on that step*, runs the effect. Makes
  correct pacing the only ergonomic path; 9 hand-ordered sites migrated, logs byte-identical.
- `badgeCoverage.test.ts` — every badge-mapped `QuestCombatFlag` must fire or sit in an
  `INTENTIONALLY_SILENT` allowlist *with a written reason*; schema-derived so it can't rot. **It caught a real
  dark badge on day one** (Pit Without End's last-stand summon).
- `stepHygiene.test.ts` — at most one `questTrigger` per step; a trigger always opens its own step.
- `beatGoldens.test.ts` — snapshots the compiled moment sequence, so a PR that collapses beats shows as a
  reviewable diff.

**Choreo (the feel changes — the risky half):**
- Exhaustive `Record<CombatEvent['type'], MomentKind>` so a new event type is a compile error, not an
  accidental 300 ms default; new `trigger` kind for badge beats.
- `holdMs` keyed by **kind** via `holdMsForKind` — making `KIND_TO_KEY` live. Side effects: `ascend`
  300→520, `hpGrant` 0→140, `spellProgress` 0→140.
- **Flourish tails** — crit/Flurry impact registers a tail (`critTail` 450, `flurryTail` 350) that extends
  the *next* beat's hold.
- **Tendril-aware beats** — `fireBuffCasts` registers its longest travel; the beat holds until the slowest
  strike lands + flashes.

### 5.2 The verdict

Owner played it: *"this is definitely not right at all, i think we should scrap this branch."* Scrapped
same day; never reached `main`.

### 5.3 ⚠️ The confound — read this before concluding the approach was wrong

**I never obtained a clean verification that the owner played the fixed code.** During my browser
verification the **dev server died**; the owner's tab was showing `[vite] server connection lost` plus
WebSocket failures, which means it had been serving a **stale, pre-fix bundle**. On top of that, the
choreo config merges `localStorage['ascent.pacing']` over shipped defaults in dev — so **any previously
saved tuner values silently override new defaults** (including the old `hpGrant: 0`). I asked the owner to
clear it, but the server was already dead by then.

**Both readings are live:**
1. The owner never actually saw the changes (stale bundle) → the approach is untested.
2. The changes *were* live and genuinely felt bad — plausible, because they were **cumulative global feel
   changes shipped all at once, all on by default**: every Sergeant proc, every ascend, every crit, every
   Flurry, and every buff-tendril beat got longer simultaneously. That reads as "combat got sluggish" even
   if each individual value is defensible.

Either way, the **rollout** was the mistake. See §6.

---

## 6. What I'd do differently — recommended approach

### 6.1 Ship dark. This is the big one.

Every new pacing behavior lands **with its dial at 0** — `critTail: 0`, `flurryTail: 0`, `hpGrant` unchanged,
`holdMs` keyed by kind but with `KIND_TO_KEY` values chosen to reproduce **exactly today's numbers**. The PR
is then a provable no-op, mergeable on code review alone. The owner dials each value up **in the live tuner
during a real fight**, and only the values that survive that get baked as defaults.

This converts "does this feel right?" from a merge-gate question (where a wrong guess costs the whole branch)
into a tuning session (where it costs 30 seconds). Note the repo already has this exact workflow for FX —
the 🌀/💎/🍺 tuners with `localStorage` persistence and "bake the owner's values" commits. **Pacing should use
the same loop.** There's already a Choreography dev panel to extend.

### 6.2 Separate mechanical from felt

The sim-side contract (`withBeat` + the three enforcement tests) has **zero feel impact** and real long-term
value — it's what stops the next batch of runes from shipping with dark badges and collapsed beats. Ship it
as its own PR, independent of any clock change. Don't let it die with a feel rejection again.

### 6.3 Separate "apply state" from "schedule next beat"

The deepest insight from the audit: `ctx.advance()` at `contact` currently does **two different jobs**:
1. Fold the result frame (damage numbers, deaths) — **correct at contact**; damage *should* land with the hit.
2. Start the clock toward the next beat — **wrong at contact**; it should start after the flourish's tail.

Today they're the same call. Splitting them is more principled than my `critTail`/`flurryTail` patch, which
was a *hardcoded guess* at FX duration. Concretely: keep `advance()` at contact, but have the impact
register its real tail so the *scheduler* starts the next hold from `contact + tail`.

### 6.4 Prefer "let FX outlive the beat" over "make the beat wait"

For buff tendrils I extended the beat until the tendril landed — which slows the fight. Better: make the
**stat holds survive beat teardown** (keyed by uid with their own timers, released when their own strike
lands) instead of the unconditional wipe at `useCombatReplay.ts:901`. Same visual correctness, zero pacing
cost. Apply the same thinking wherever possible: only block the clock when the *next beat would contradict*
the in-flight FX, not merely because FX are still playing.

### 6.5 Measure before tuning

Add a dev overlay (behind the Choreography panel) that prints, per beat: `kind`, scheduled hold, and the
actual FX duration that fired. The overrun becomes *visible* instead of inferred. That's how you find which
beats genuinely need tails and which are fine — and it's the artifact that would have settled §5.3
immediately.

### 6.6 Architecture options for the long game

| Option | How | Trade-off |
|---|---|---|
| **A. Completion-registered** (what I attempted) | FX report duration; beat ends at `max(minHold, registered completions)`, capped | New FX self-space automatically; but a *forgotten* registration silently reverts to today's behavior |
| **B. Declarative budgets** | Each `MomentKind` declares a duration; FX are `timeScale`d to fit | Fully predictable pacing, no drift; but FX get squashed, and Pixi particles don't scale as cleanly as GSAP |
| **C. Timeline compilation** | Compile the whole fight to an absolute timeline upfront, then play it | Enables scrubbing/seeking and whole-fight rhythm tuning; big rewrite, and FX durations that depend on measured rects aren't known upfront |

**Recommendation: A, with B's discipline** — completion-registration as the mechanism, plus a per-kind
**max cap** so a runaway FX can't stall the fight, plus the §6.5 overlay so missing registrations get found
rather than silently ignored.

---

## 7. Suggested order of work

1. **Sim contract PR** (feel-neutral): `withBeat` + badge-coverage + step-hygiene + beat goldens. Mergeable
   on review; no playtest gate. *(Code exists in closed PR #542 — cherry-pickable.)*
2. **Measurement PR**: the per-beat scheduled-vs-actual overlay in the Choreography panel.
3. **Dark clock PR**: kind-keyed holds calibrated to reproduce today's numbers exactly; `critTail`/`flurryTail`
   present but 0; the tendril stat-hold survival fix (§6.4, which is a *correctness* fix, not a pacing one).
4. **Tuning session** with the owner: dial the tails live, bake what survives.
5. **Step-collapse seams** (§3.2) — *last*, and only with hold retuning in the same pass, since it lengthens
   fights by construction.

---

## 8. Reference

**Files**
- `packages/core/src/combat/simulate.ts` — step emission, `nextStep`/`emit`/`fireTrigger`, SoC block, death/avenge cascade
- `packages/ui/src/useCombatReplay.ts` — the scheduler (`:696–718`), stat holds (`:901`), engine ctx wiring (`:1008`)
- `packages/ui/src/choreo/clock.ts` — `holdMs`, `OVERLAP_INTO`
- `packages/ui/src/choreo/choreoConfig.ts` — the hold table, `KIND_TO_KEY` (currently dead), tuner ranges
- `packages/ui/src/choreo/compile.ts` — moment grouping rules
- `packages/ui/src/choreo/engine.ts` — attack cue orchestration, `onContact` advance, `RALLY_PAUSE_MS`
- `packages/ui/src/choreo/channels/lunge.ts` — the GSAP timeline; `contact` placement at `:101`

**The scrapped code:** GitHub PR **#542** (closed, branch deleted). The diff is intact and cherry-pickable —
in particular the three test files are worth reviving verbatim.

**Dark badges still un-fired** (have a `badgeIdForCombatFlag` mapping, no `fireTrigger`): `runeFury`,
`runeForthcoming`, `runePackcraft`, `runeSalvage`, `runeRebirth`, `runeAftershocks`, `runeTrophy`,
`runeInheritance`, `runeUndertow`, `runeSlaying`, `bloodTrail`, `deepHunger`, `lawOfTeeth`, `oldHunt`,
`feedingLine`, `crateringMissive`. Most are passive/reactive rule-changers where a pulse would spam — the
badge-coverage test's allowlist (in #542) already documents a proposed verdict per flag; it needs an owner
pass to confirm which deserve a real pulse.
