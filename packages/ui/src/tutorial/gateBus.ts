/**
 * TUTORIAL — the action gate (blueprint §9.1, conservative).
 *
 * A guided step can HARD-gate the one lesson-breaking action a new player reaches for: ending the turn before
 * they've done the step. Without this, a player who presses End Turn on the "buy a minion" step fights with an
 * empty board and the step never completes — the tutorial stalls. So while a shop/lobby step is active, the
 * controller asks this bus to block `faceOmen` (End Turn); the store's `dispatch` consults it and drops that one
 * action, firing a nudge instead.
 *
 * Safety, by construction — this can NEVER soft-lock the game:
 *  - It only ever blocks `faceOmen`. Every other action (buy, play, sell, roll, hero power, reposition, and
 *    crucially the combat-flow `settleCombat`/`resolveCombat`) always passes.
 *  - The gate is per-step and cleared the moment the step allows ending the turn (or the tutorial ends), so the
 *    player unblocks simply by doing the step the coach is pointing at.
 *  - The whole thing is inert unless a gate is explicitly set, so every non-tutorial run is untouched.
 */
import type { Action } from '@game/sim';

interface TutorialGate {
  /** Block `faceOmen` (End Turn) — set while a shop/lobby step must be finished before combat. */
  blockEndTurn: boolean;
}

let gate: TutorialGate | null = null;

export function setTutorialGate(next: TutorialGate | null): void {
  gate = next;
}

/** Whether the store should DROP this action (with an optional player-facing reason). */
export function gateBlocks(action: Action): { blocked: boolean; reason?: string } {
  if (!gate) return { blocked: false };
  if (gate.blockEndTurn && action.type === 'faceOmen') {
    return { blocked: true, reason: 'Finish the highlighted step first, then end your turn.' };
  }
  return { blocked: false };
}

// A blocked action fires a nudge so the coach can flash the reason. Fire-and-forget; no-op when unsubscribed.
type GateNudge = (reason: string) => void;
const nudgeObservers = new Set<GateNudge>();

export function subscribeGateNudge(fn: GateNudge): () => void {
  nudgeObservers.add(fn);
  return () => nudgeObservers.delete(fn);
}

export function notifyGateNudge(reason: string): void {
  for (const fn of nudgeObservers) {
    try { fn(reason); } catch { /* a nudge observer must never break dispatch */ }
  }
}
