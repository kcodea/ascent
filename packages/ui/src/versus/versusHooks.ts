/**
 * VERSUS — the narrow seam between the main store's ONE commit path and the Versus session (blueprint 11: "keep
 * the main Zustand store boundary narrow"). The store imports only this file; the Versus controller installs the
 * handlers when a match runs and removes them after. With nothing installed every function is an identity /
 * no-op, so non-Versus play pays one property read.
 */
import type { CombatResult } from '@game/core';
import type { Action, RunState } from '@game/sim';

interface VersusCommitHandlers {
  /** The authoritative fight for `wave` from this seat's perspective, once the server committed it. */
  fightFor(wave: number): CombatResult | null;
  /** Called after every committed Versus action (prev → next), off the reducer, for the session to react. */
  afterCommit(action: Action, prev: RunState, next: RunState): void;
  /** Is input frozen right now? 'paused': a disconnect pause or its 3-2-1 (nothing goes through). 'held': this shop is
   *  not this player's to play (waiting on the other player): the player's own actions are refused. */
  freeze?(run: RunState): VersusFreeze;
}

export type VersusFreeze = 'paused' | 'held' | null;

/**
 * The actions the game itself plays while a shop is HELD (the End Turn that lands the fight, the fight's own settle and
 * exit, a shop death finishing). A PAUSE refuses these too: the screen and its clocks wait for the resume.
 */
const SYSTEM_ACTIONS: ReadonlySet<Action['type']> = new Set<Action['type']>([
  'faceOmen', 'landCombat', 'settleCombat', 'resolveCombat', 'resolveShopDeath', 'shopClockExpired', 'sellWindowExpired',
  'combatEscalationPreview', 'combatSpellPowerPreview', 'combatSpellCastPreview', 'combatFriendlyDeathPreview',
  'combatBladeAttackPreview', 'combatScoutPreview',
  'receivePass', 'passRefunded', // VERSUS DUOS: a teammate's pass (or its refusal) lands while the shop is held (re-delivered after a pause)
]);

let handlers: VersusCommitHandlers | null = null;

export function installVersusHandlers(h: VersusCommitHandlers | null): void {
  handlers = h;
}

/** The current freeze ('paused' / 'held' / null). Null outside a live Versus match. */
export function versusFreeze(run: RunState): VersusFreeze {
  return run.mode === 'versus' && handlers?.freeze ? handlers.freeze(run) : null;
}

/**
 * THE ACTION-LAYER GATE (owner 2026-10-14: "i was able to hero power during this, fix that"). While a Versus match is
 * paused NO run action goes through (hero power, buy, sell, play, roll, freeze, level up, drag, End Turn, Equipment,
 * Discover, hotkeys: they all reach the run through `dispatch` / `preparePresentationAction`, which ask this first).
 * While the shop is held only the game's own actions do. The click-blocking veil is the look; this is the rule.
 */
export function versusRefuses(run: RunState, action: Action): boolean {
  const f = versusFreeze(run);
  return f === 'paused' || (f === 'held' && !SYSTEM_ACTIONS.has(action.type));
}

/** End Turn in Versus parks the side for the server (`deferFight`); every other action passes through. */
export function versusAction(run: RunState, action: Action): Action {
  if (run.mode === 'versus' && action.type === 'faceOmen' && !action.deferFight) return { type: 'faceOmen', deferFight: true };
  return action;
}

/**
 * Inside the commit: a Versus End Turn that just parked its side lands the server's fight in the SAME commit, so
 * the screen goes straight from the shop to this round's fight (never to the previous round's `lastCombat`).
 */
export function versusLand(reduce: (s: RunState, a: Action) => RunState, action: Action, next: RunState): RunState {
  if (next.mode !== 'versus' || action.type !== 'faceOmen' || !next.pendingCombatSide || !handlers) return next;
  const fight = handlers.fightFor(next.wave);
  if (!fight) return next;
  return reduce(next, { type: 'landCombat', fight: { result: fight, damageTaken: 0 } });
}

export function versusAfterCommit(action: Action, prev: RunState, next: RunState): void {
  if (next.mode === 'versus' && handlers) handlers.afterCommit(action, prev, next);
}
