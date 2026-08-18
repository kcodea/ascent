/**
 * TUTORIAL — the action gate (blueprint §9.1).
 *
 * While a guided step is active, the tutorial locks input to the ONE action that step is teaching: the store's
 * `dispatch` (and the choreographed End-Turn commit, and the End Turn button) consult this bus and drop any
 * other player action, flashing a nudge instead. This is what keeps a first-time player in lock-step with the
 * coach — they can't buy the wrong minion, upgrade early, or end the turn before the lesson is done.
 *
 * Safety, by construction — this can NEVER soft-lock the game:
 *  - FLOW and harmless actions ALWAYS pass: `settleCombat` / `resolveCombat` (combat must be able to resolve),
 *    repositioning, sub-choices (`discover` / `chooseOne` / `battlecryTarget`), and inspect. Only the deliberate
 *    player verbs (buy / sell / play / roll / freeze / upgrade / heroPower / faceOmen …) are ever gated.
 *  - The gate is per-step: the controller sets it to the current step's allowed verbs and clears it between
 *    steps, so the player unblocks simply by doing the action the coach is pointing at.
 *  - It is inert unless a gate is set, so every non-tutorial run is untouched.
 */
import type { Action } from '@game/sim';

/** Actions that always pass, whatever the gate: combat-flow transitions, harmless positioning, sub-choices,
 *  and inspection. Gating any of these could soft-lock (combat can't resolve) or just annoy (can't look at a
 *  card). Everything NOT here is a gate-able player verb. */
const ALWAYS_ALLOWED = new Set<string>([
  'settleCombat', 'resolveCombat', // combat MUST be able to resolve
  'reposition', 'reorderShop', 'reorderHand', // positioning is harmless exploration
  'battlecryTarget', 'chooseOne', 'discover', 'closeScout', // sub-choices within an allowed action
]);

interface TutorialGate {
  /** The player verbs allowed right now (reducer Action `type`s). `[]` = nothing but the always-allowed flow
   *  actions (an observe/combat step). A verb not in this list is dropped + nudged. */
  allowedActionKinds: string[];
  /** Shown when a disallowed action is bumped. */
  reason: string;
}

let gate: TutorialGate | null = null;

export function setTutorialGate(next: TutorialGate | null): void {
  gate = next;
}

/** Whether the store should DROP this action (with an optional player-facing reason). */
export function gateBlocks(action: Action): { blocked: boolean; reason?: string } {
  if (!gate) return { blocked: false };
  if (ALWAYS_ALLOWED.has(action.type)) return { blocked: false };
  if (gate.allowedActionKinds.includes(action.type)) return { blocked: false };
  return { blocked: true, reason: gate.reason };
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
