import type { Action, RunState } from './state';

/**
 * THE SHOP CLOCK LOCK (owner report 2026-09-30: "goldspring is usable after timer ends. make sure hero powers
 * cant be used after timer ends"; R-TIMER-LOCK-01).
 *
 * The recruit clock is UI-owned: the engine never reads wall time. When the UI's tick loop takes the clock to 0 it
 * dispatches `shopClockExpired`, which sets `RunState.shopClockExpired`; the next turn flip clears it. While it is
 * set, the reducer rejects every action this table marks `'locked'`, in ONE place (`reduceCore`), BEFORE the clone.
 *
 * Before this, the lock lived only in the UI: Buy / Sell / Refresh / Upgrade / hand plays checked `timeUp`, but the
 * hero-power button, the second (Void) power, the Equipment slot and the Henchman chip did not, and the reducer
 * accepted all of them, so an untargeted power (Nadja's Goldspring) fired at 0:00.
 *
 * The table is a `Record` keyed on `Action['type']`: adding an action to the union without classifying it here is
 * a TYPE error, so a new player action cannot silently forget the lock.
 *
 * What stays OPEN after 0:00, and why:
 *  - `faceOmen` (End Turn): the only way forward.
 *  - `freeze`: owner 2026-07-21, Freeze is deliberately not gated on the clock.
 *  - `reposition` / `reorderShop` / `reorderHand` / `selectEquipment`: arrangement only, no Gold, no effect.
 *  - the modal answers (Discover, Choose One, aim, quest / power / Runeforge / Ancient picks, scout close): the
 *    clock is PAUSED while any of them is open, so they never start after 0:00; leaving them answerable means a
 *    legacy save can never strand one (the softlock class `endTurnSoftlock.test.ts` pins).
 *  - the automatic transitions and display-only previews (combat flow, death settle, Thymepiece expiry, dev tools).
 *
 * REPLAYS stay deterministic by construction: the expiry is itself a recorded action, so a new recording replays
 * the lock exactly where the player lived it, and an OLD recording (made before this action existed) has no expiry
 * in its stream, so nothing is locked and it reduces exactly as it always did.
 */
export const SHOP_CLOCK_POLICY: Record<Action['type'], 'open' | 'locked'> = {
  // The player's Gold-spending / effect-firing Shop actions: locked once the clock runs out.
  buy: 'locked',
  buyHenchman: 'locked',
  play: 'locked',
  sell: 'locked',
  roll: 'locked',
  upgrade: 'locked',
  heroPower: 'locked',
  activateEquipment: 'locked',
  // Arrangement, End Turn and Freeze.
  faceOmen: 'open',
  freeze: 'open',
  reposition: 'open',
  reorderShop: 'open',
  reorderHand: 'open',
  selectEquipment: 'open',
  // Modal answers (the clock is paused while any is open).
  discover: 'open',
  chooseOne: 'open',
  cancelChoice: 'open',
  battlecryTarget: 'open',
  buyQuest: 'open',
  pickPower: 'open',
  buyRune: 'open',
  skipRuneforge: 'open',
  rerollRuneforge: 'open',
  pickAncient: 'open',
  closeScout: 'open',
  // Automatic transitions, display-only previews, the clock's own ticks, dev tooling.
  shopClockExpired: 'open',
  discountWindowExpired: 'open',
  resolveShopDeath: 'open',
  settleCombat: 'open',
  resolveCombat: 'open',
  combatEscalationPreview: 'open',
  combatSpellPowerPreview: 'open',
  combatSpellCastPreview: 'open',
  combatFriendlyDeathPreview: 'open',
  combatBladeAttackPreview: 'open',
  combatScoutPreview: 'open',
  devGrant: 'open',
  ancientSetMeter: 'open',
};

/** The Shop's clock has run out this recruit turn: only End Turn, Freeze, arrangement and modal answers remain. */
export function shopLocked(state: Pick<RunState, 'phase' | 'shopClockExpired'>): boolean {
  return state.phase === 'recruit' && !!state.shopClockExpired;
}

/** Would the reducer refuse this action because the Shop's clock has run out? The ONE predicate the reducer and
 *  any caller (UI, bots, tools) share. */
export function blockedByShopClock(state: Pick<RunState, 'phase' | 'shopClockExpired'>, action: Action): boolean {
  return shopLocked(state) && SHOP_CLOCK_POLICY[action.type] === 'locked';
}
