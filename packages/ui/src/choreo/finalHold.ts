import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { bindingFor } from './bindings';
import { getDef } from '../fx/fxDefs';
import { layerNaturalSpanMs } from '../fx/playLifetime';
import { pummelsFiredIn, PUMMEL_STACK_MS } from './channels/pummelFired';

/**
 * THE FINAL HOLD — how long the replay lingers on its LAST beat before reporting `done` (which starts the
 * end-of-combat hand-off: the frame drops the dead, the hero-strike tally flies from the survivors).
 *
 * Pure, so it can be proven without a renderer (there is no renderHook harness for `useCombatReplay`). The
 * hook computes the two inputs it always had — the base `finalHold` (÷ speed) and a returning death's
 * pull-home floor (wall-clock) — and this function adds the third:
 *
 * ── the pummel floor (owner ask 2026-09-21) ────────────────────────────────────────────────────────────
 * "If it triggers from the last attack of combat, please make sure it still fires the animation and beat."
 * A damage-meter crossing on the killing blow (Goldvein's third hit into the last dummy, Han Gover's 40th
 * point of damage ending the fight) lands in the LAST impact moment. Its cue fires — every beat's cues do, the
 * last included — but the def plays at WALL CLOCK (the score never passes `speed` to `playDef`) while
 * `finalHold` divides by the player's speed: at 4× the fight settled 225ms after contact, with the owner's
 * `pummel-trigger` barely 100ms in. Nothing killed the play (a def owns its container; `clearParticles`
 * does not reach it), but `done` dropped a dead meter body from the DOM under it and started the tally over
 * it — the beat was not awaited. So: when the last beat carries a crossing, the hold is floored at the bound
 * def's VISUAL end, wall-clock, plus the stack stride for a body that crossed more than once. The same shape
 * as the pull-home floor (a fixed CSS fade the speed slider cannot shorten).
 */
export interface FinalHoldInputs {
  /** `getChoreoConfig().finalHold` — the base read, divided by the speed. */
  finalHold: number;
  /** The player's in-combat speed multiplier (≤0 treated as 1). */
  combatSpeed: number;
  /** `pulledHomeAttackerHold(last, …)` — a returning death's pull-home + skull read, wall-clock; 0 when none. */
  pull: number;
  /** The wall-clock read of the def bound at `pummelTrigger` for a card, in ms — 0 when nothing is bound.
   *  Defaults to `pummelReadMs` (the real registry); injectable for the pure tests. */
  readMs?: (cardId: string | null) => number;
  /** Wall-clock ms still to run on a pummel flash fired on an EARLIER beat (Han Gover's crossing is followed
   *  by its Ale's `toHand` beat and the death beat before the end) — `pummelRemainingMs` at the time the
   *  final hold is computed. 0 when none. */
  pendingPummelMs?: number;
}

export function finalHoldMs(
  last: Moment | undefined,
  events: CombatEvent[],
  cardIds: ReadonlyMap<string, string>,
  inputs: FinalHoldInputs,
): number {
  const spd = inputs.combatSpeed > 0 ? inputs.combatSpeed : 1;
  let hold = Math.max(inputs.finalHold / spd, inputs.pull > 0 ? inputs.pull + 100 : 0, inputs.pendingPummelMs ?? 0);
  if (!last) return hold;
  const readMs = inputs.readMs ?? pummelReadMs;
  for (const f of pummelsFiredIn(last, events)) {
    const read = readMs(cardIds.get(f.uid) ?? null);
    if (read <= 0) continue; // nothing bound for this body → nothing on screen to wait for
    // A body that fired N times plays N stacked detonations, the last starting (N-1) strides in (÷ speed,
    // matching the cue's own scheduling); wait for THAT one to finish.
    hold = Math.max(hold, read + ((f.count - 1) * PUMMEL_STACK_MS) / spd);
  }
  return hold;
}

/** A pummel flash the replay fired: when (wall clock) and how long it reads for (the def's visual end plus
 *  the stack stride for a multi-crossing body). Recorded by the hook's `onPummelProc`. */
export interface PummelFire {
  at: number;
  readMs: number;
}

/** How much of `fire` is still to run at `now` — the floor the final hold needs for a crossing that fired on an
 *  EARLIER beat than the last (the last beat's own crossings are scanned directly, since the cue runner fires
 *  them in the same commit that computes the hold). 0 for no fire, or one already finished. */
export function pummelRemainingMs(fire: PummelFire | null, now: number): number {
  if (!fire) return 0;
  return Math.max(0, fire.at + fire.readMs - now);
}

/**
 * The VISUAL end of one play of the def bound at `pummelTrigger` for `cardId`: the last non-sound layer to
 * finish (`at + its natural span`), floored at the def's authored `duration`. NOT `playLifetimeMs`: that is
 * the runtime's CLEANUP ceiling, which grants an unmodelled `sound` layer a 3s tail and pads a grace on top —
 * a bound for retiring a stuck play, not a read. For the owner's `pummel-trigger` (900ms; a 96-diamond burst
 * at 100ms living 880ms; a shockwave at 90ms) this is ~980ms. 0 when nothing is bound or the def is unknown.
 */
export function pummelReadMs(cardId: string | null): number {
  const binding = bindingFor(cardId, 'pummelTrigger');
  if (!binding) return 0;
  const def = getDef(binding.def);
  if (!def) return 0;
  let end = Number.isFinite(def.duration) && def.duration > 0 ? def.duration : 0;
  for (const layer of def.layers) {
    if (layer.primitive === 'sound') continue;
    const at = Number.isFinite(layer.at) && layer.at > 0 ? layer.at : 0;
    end = Math.max(end, at + (layerNaturalSpanMs(layer) ?? 0));
  }
  return end;
}
