# Combat Aftermath Ordering — Design

**Date:** 2026-07-10 · **Author:** Mike (+ Claude) · **Status:** approved, pre-plan

A combat-feel change to the choreographer: after a swing lands and the attacker **settles**, its remaining
consequences resolve in a clean, ordered cadence instead of overlapping the settle. **Presentation-only —
the sim event log is untouched, so no fight outcome changes.** The imposed order already matches the sim's
resolution order (shield-break → death/deathrattle → reborn), so this only *retimes and regroups* what's
shown.

## Current behavior (what we're changing)

The beat clock advances the frame at **contact** (engine-driven), and an attack's consequence beats — the
collapsed impact beat (`dmg`/`shield`/`death`), then the `summon`/`buff`/`reborn` beats — play in quick
succession right after contact (`OVERLAP_INTO` / short holds), *overlapping* the attacker's elastic settle.
The shield-break gold shatter (`auraBreak` cue, +300ms on the impact beat), death aura bursts (`auraBurst`,
0ms), the deathrattle skull FX (fired from the replay layout effect), and the reborn re-form (`auraReform`,
+460ms) all land while the attacker is still returning home.

## Desired behavior

For each swing:

1. **On contact (unchanged):** the smack sound/FX, the damage float, the defender knockback, and any dying
   unit's **collapse** happen immediately. A unit that dies **with** a deathrattle still collapses on the
   hit (owner ruling) — only its deathrattle *effect* waits.
2. **The attacker plays its full settle** (`lungeConfig.settleDur`).
3. **After the settle**, the swing's remaining aftermath replays in **global phases**, left→right within
   each, with a **very brief** stagger between each effect:
   - **Phase 1 — Divine-shield breaks** (gold shatter).
   - **Phase 2 — Deathrattles** — the skull shatter + the summons/buffs they spawn (summoned units *appear*
     here, not on the hit).
   - **Phase 3 — Reborns** — the re-form glow + return.
   Any other post-hit aftermath in that clash (non-deathrattle death aura bursts, `buff` waves, `ascend`,
   `improve`, `maxGold`, `toHand`) resolves in this same post-settle window, slotted with its cause.
4. **The next swing waits** for the aftermath to finish (the cadence is sequential).
5. A **plain death** (no deathrattle / shield / reborn) just collapses on the hit — it has no post-settle
   effect (matches "units that die without an effect resolve before the settle, as today").

## Non-goals

- No `@game/core`/`sim`/`content` changes. Event log, resolution order, and outcomes are untouched.
- Not building a general per-cue authoring UI (that's the choreographer's later Phase-4 scope). This ships
  the specific aftermath cadence above, with a couple of tunable timing knobs.

## Approach

Two levers, both in `packages/ui`'s choreographer:

1. **Hold for the settle (clock).** When the shown moment is an attack's impact and the next moment is a
   consequence of that swing, the replay clock holds ~`settleDur` before advancing — so the aftermath
   starts only once the attacker is home. New `choreoConfig` knob `aftermathHold` (ms, ≈ settleDur) instead
   of hard-coupling to `settleDur`, so it's tunable.
2. **Phase + stagger the aftermath (sequencer).** The consequence effects are grouped into the three phases
   and fired left→right with a small inter-effect stagger (new `choreoConfig` knob `aftermathStagger`, ms,
   "very brief"). The **death collapse stays on the impact beat** (on hit); what moves into the phased
   window is: the shield-break gold shatter, the death aura bursts, the deathrattle skull + its
   summon/buff appearances, and the reborn re-form. Concretely this means decoupling those effect firings
   (today the `auraBurst`/`auraBreak` cues on the impact beat + the summon/reborn beats) from the impact
   beat's contact timing and driving them from the post-settle sequence.

The exact split between "compiler regroup" and "a dedicated aftermath sequencer in `useCombatReplay`" is an
implementation detail settled in the plan; the pure, testable pieces (the clock hold; any reorder/grouping
pass) get unit tests, and the visual cadence is tuned live on a preview.

## Tunables (choreoConfig, dialed in the Pacing/Choreography tuner)

- `aftermathHold` (ms) — the wait after contact before the aftermath begins (≈ the settle).
- `aftermathStagger` (ms) — the brief gap between consecutive aftermath effects and between phases.

## Testing

- Unit-test the clock hold (an attack→consequence transition waits `aftermathHold`) and any pure
  grouping/ordering pass (phases emitted shield → deathrattle → reborn, left→right; plain deaths excluded;
  order-neutral vs the event log).
- Full suite green (the compiler equivalence oracle updates if grouping changes).
- **Live preview** on the worktree dev server to confirm the phase order + cadence reads right and to tune
  `aftermathHold` / `aftermathStagger`, then bake.

## Rollout

Built in an isolated worktree (`feat/aftermath-ordering`, off `main`). Incremental, TDD where the logic is
pure; live-verified and tuned before baking + PR. Owner previews before merge.
