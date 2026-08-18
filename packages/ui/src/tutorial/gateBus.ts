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
import type { Action, RunState } from '@game/sim';

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
  /** When set, a `buy`/`play` is restricted to THIS card id — buying/playing any other offered minion is
   *  dropped. This is what stops a new player buying the wrong shop card on a "buy Packstrider" step. */
  allowedCardId?: string;
  /** Shown when a disallowed action is bumped. */
  reason: string;
}

let gate: TutorialGate | null = null;

export function setTutorialGate(next: TutorialGate | null): void {
  gate = next;
}

/** Whether the store should DROP this action (with an optional player-facing reason). `run` (the state BEFORE
 *  the action) lets the per-card check map a buy/play uid back to its card id. */
export function gateBlocks(action: Action, run?: RunState): { blocked: boolean; reason?: string } {
  if (!gate) return { blocked: false };
  if (ALWAYS_ALLOWED.has(action.type)) return { blocked: false };
  if (!gate.allowedActionKinds.includes(action.type)) return { blocked: true, reason: gate.reason };
  // Per-card restriction: on a "buy X" / "play X" / "sell X" step, only the highlighted card is allowed through.
  if (gate.allowedCardId && run && (action.type === 'buy' || action.type === 'play' || action.type === 'sell') && 'uid' in action) {
    const zone = action.type === 'buy' ? run.shop : action.type === 'sell' ? run.board : run.hand;
    const cardId = zone.find((c) => c.uid === action.uid)?.cardId;
    // A sell can target a board OR hand minion; fall back to hand if not found on the board.
    const resolved = cardId ?? run.hand.find((c) => c.uid === (action as { uid: string }).uid)?.cardId;
    if (resolved !== gate.allowedCardId) {
      return { blocked: true, reason: 'That is not the highlighted minion — follow the spotlight.' };
    }
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
