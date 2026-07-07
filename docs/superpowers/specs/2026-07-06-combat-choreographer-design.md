# Combat Choreographer — Design

**Date:** 2026-07-06 · **Owner:** Mike (UI) · **Status:** approved pending user review
**Coordination:** Phase 1 touches `packages/core` (shared boundary) — Kevin has agreed to the scope below.

## Goal

One system that owns the **presentation of every combat event**: what groups into a "moment," the order
and stagger of what shows inside a moment, how long each moment holds, and which effect channels
(lunge, Pixi FX, damage floats, sfx, CSS animations, aura bursts) fire at which offsets. Today those
five concerns are split across `buildBeats` (hardcoded grouping), `pacingConfig` (holds),
`useCombatReplay` (scheduler + four channel systems), and the aura tracker in `Recruit.tsx` — kept in
sync by timing math, which is how the Rise double-burst class of bugs happens.

## Explicit non-goals (owner rulings, 2026-07-06)

- **No change to fight outcomes.** Resolution order in `simulate()` is untouched. The one sim-side
  change (step tags) is pure metadata, verified outcome-neutral by the existing determinism/golden
  tests. The owner explicitly declined outcome-affecting resolution-order control.
- **No re-sorting across causally dependent steps** — effects never display before their causes.
- Content/rules/balance untouched. This is presentation only (plus metadata).

## Architecture

> **Reference:** the full event vocabulary + combat lifecycle/trigger order + the exchange
> micro-order + how step tags map onto it all live in [`docs/combat-events.md`](../../combat-events.md)
> — read that alongside this spec when authoring phase 2–4 score/grouping rules.

```
events[] ─▶ ① Moment Compiler ─▶ moments[] ─▶ ② Score ─▶ ③ Playback Engine ─▶ ④ Channel Adapters
             (config-driven          (ordered      (per-kind     (clock, cues,        lunge · pixiFx · floats ·
              grouping over           slices of     cue table)    anchors, holds)      sfx · CSS anims · aura bursts
              sim step tags)          the log)
```

### ⓪ Sim step tags (`packages/core`) — the honesty foundation

`CombatEvent` gains `step: number` (or events are wrapped per-step — implementation's choice, flat tag
preferred for backward compatibility). `simulate()` increments the step counter at each atomic
resolution point: one attack exchange (attack + shield/dmg/venom/retaliation), one Deathrattle's
effects, one Start-of-Combat cast, one AOE application, etc. **Zero logic/RNG/order changes** — a
counter and tag writes only. This replaces the UI's contiguity *heuristics* with sim-declared
simultaneity: the compiler then KNOWS which events were one atomic thing.

Ordering law derived from tags:
- **Within a step: total presentation-ordering freedom.** Any order of one step's events is a true
  telling (end-of-step state is identical). AOE ripple, shield-break-before-number, per-target splits —
  all legal score choices.
- **Across steps: causal order holds; grouping is free.** Steps can merge into one moment, split into
  sub-moments, or overlap channels (a summon poof starting while the death float lingers) — but a
  step's events never display before an earlier step's.
- **Cosmetic float rule:** `sc` (non-cast narration), `reveal`, `maxGold`, `hpGrant` may float within
  their neighborhood (adjacent moments) by score rule — they barely touch state.

### ① Moment Compiler (`packages/ui/src/choreo/compile.ts`) — pure, golden-tested

`compileMoments(events, rules): Moment[]` where
`Moment = { kind: MomentKind, start, end, events, primary, actors, stagger?: StaggerGroup[] }`.

Grouping `rules` (data, live-tunable): generalizes today's hardcoded behavior —
- `collapse`: event-type sets that merge contiguous runs (today's `RESULT_TYPES`, `buff` runs).
- `absorb`: types pulled into a preceding action's wind-up (today's `WINDUP_ABSORB`).
- `chain`: fold a death + its Deathrattle step into one moment (new capability).
- `splitPerTarget`: break an AOE step into per-victim sub-moments (new capability).
- Within-moment display order + stagger come from the Score (below), legal per the step-tag law.

**Compatibility gate:** with default rules, `compileMoments` must reproduce today's `buildBeats`
grouping exactly — locked by golden tests over real `simulate()` logs (including the
`attackerOfImpact` contract). `computeFrame` still folds the raw log in order; a moment's shown frame
= fold up to `moment.end` (unchanged principle). Within-moment *cue* order never changes the fold.

### ② The Score (`packages/ui/src/choreo/score.ts` + `choreoConfig.ts`)

A declarative table: `Score = Record<MomentKind, Cue[]>` with
`Cue = { ch: Channel, at: Offset, params?, if?: Condition }`.
- `Offset` = ms number | anchor: `'start' | 'contact' | 'landed' | 'end'` | `'stagger'` (× target index).
- Anchors are *produced by channels*: the lunge cue defines `contact` (windup+strike−smackLead); the
  pull-back cue defines `landed`. This replaces today's cross-file timing welds with named joints.
- `Condition` covers the real cases we already ship: `isAttacker` (Rise pull-back), `hasAura`,
  `suppress: 'attacker'` (damage-float rule), `power: 'swing'` (damage-scaled impact).

Day-one score content = today's shipped behavior expressed as data: `attackExchange`, `scCast`,
`summon`, `buffWave`, `death` (incl. aura death-bursts), `riseDeath` (pull-back → burst at `landed` →
fade), `reborn` (re-form at +460ms), `shieldBreak` (delayed shatter), `poison`, `venomSpent`,
`ascend`, `toHand`, `maxGold`, `rally`, `keyword`, `improve`, `hpGrant`, `reveal` — every one of the
18 event types has a row (silent rows are explicit, not missing).

### ③ Playback Engine (`packages/ui/src/choreo/engine.ts`)

Replaces the `setTimeout` beat chain in `useCombatReplay`. Per moment: measure DOM fresh (as today),
build ONE GSAP timeline of the moment's cues (offsets/anchors/staggers are real timeline positions),
advance on completion + hold. A master clock wrapper owns: player `combatSpeed` (timeScale), global
tempo, hidden-tab pause, and — later, free — hit-pause/slow-mo as clock ops. React still renders per
moment index (frame/floats/anim classes), so memoized `Unit` behavior is preserved.

### ④ Channel Adapters (`packages/ui/src/choreo/channels/*`)

Thin, single-purpose functions — the only code touching GSAP/pixiFx/sfx/React setState/CSS classes:
`lunge`, `pullback`, `recoil`, `fx.impact`, `fx.projectile`, `float.dmg`/`float.sym`, `sfx.*`,
`css.<anim>`, `aura.burst`/`aura.clear`. The aura tracker in `Recruit.tsx` KEEPS position-tracking
(bubbles riding cards); burst/break **authority** moves to the choreographer — the double-burst bug
class dies structurally (`data-rising` and `deathBurstRef` bookkeeping are subsumed by the `landed`
anchor).

### Config + DEV panel

`choreoConfig.ts` (localStorage, per repo pattern): per-kind hold, per-kind stagger, per-cue offset
overrides, grouping-rule toggles. **Absorbs `pacingConfig`** (its keys map to per-kind holds; the
Pacing tuner is replaced by the new 🎬 Choreography panel — per-kind cue list, offset sliders, stagger,
hold; Copy/Reset). Content tuners (Lunge/Float/Smoke/Trail) stay — they tune what a channel looks
like; the Choreography panel tunes when/in-what-order.

## Delivery — four phases, each a PR, `main` always playable

1. **Step tags + Compiler.** Core: `step` on `CombatEvent` + counter in `simulate()` (goldens updated
   to carry the tag; determinism suite proves outcomes unchanged). UI: `compileMoments` with default
   rules byte-identical to `buildBeats` (golden tests); `useCombatReplay` consumes moments via a
   `buildBeats`-shaped shim. No visible change.
2. **Engine.** The clock + per-moment cue timelines reproduce current pacing exactly (pacing defaults
   migrate into `choreoConfig`; Pacing tuner marked deprecated but functional). No visible change.
3. **Channels.** One channel per commit moves into the score: sfx → floats → CSS anims → FX/impact →
   lunge/pull-back → aura bursts. Each commit is behavior-preserving; the cross-file welds
   (`data-rising`, smack-lead math, reborn 460ms) become anchors as their channels land. This phase IS
   the original "hit choreographer."
4. **Authoring.** Staggers, `splitPerTarget`/`chain` rules, the 🎬 Choreography DEV panel, retire the
   Pacing tuner, and the first real re-choreographs as proof (AOE death ripple; Deathrattle chain
   folded into its death; shield-break-before-number ordering).

## Testing

- Core: determinism + golden suites extended with step tags; an added invariant test (same outcome,
  same event multiset, tags monotonic).
- Compiler: golden equivalence vs `buildBeats` on real fight logs; unit tests per grouping rule;
  `attackerOfImpact` behavior preserved.
- Score/engine: unit tests on cue scheduling math (offsets, anchors, stagger, speed scaling);
  `npm run harness`-style headless replay walk asserting cue sequences for canonical fights.
- Live: owner feel-pass per phase (the real gate, per this repo's culture) + prod-build perf check
  (docs/performance.md) — the engine must not add per-frame layout reads (DOM measured once per
  moment, as today).

## Risks

- **Size:** `useCombatReplay.ts` is ~900 lines and the hottest UI file; phases 2–3 rewire its core.
  Mitigation: per-channel commits, golden gates, and the shim keeping old/new paths swappable during
  phase 2–3 development.
- **Shared boundary:** `types.ts` change lands in phase 1 only, small, pre-agreed with Kevin; announce
  before taking the file (CLAUDE.md serialize-hot-files rule).
- **Tuner sprawl:** net reduction — Pacing tuner retires into the Choreography panel.
