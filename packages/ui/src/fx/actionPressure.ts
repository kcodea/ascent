/**
 * HOW FAST THE PLAYER IS ACTING IN THE SHOP (R-PERF-APM-01, owner 2026-11-18: "when i have a board with cards like
 * Karwind and im playing APM the game gets bogged down and nearly impossible to play. this needs to be butter smooth").
 *
 * One played Shout on an engine board is a second or more of authored presentation: staggered buff waves, a stat roll
 * on every badge, a trail per recipient. That is right for one action. At four to eight actions a second it means
 * six to nine actions' presentation playing at once, and every badge permanently behind the number the run really
 * holds (measured, `npm run perf:apm`: badges behind the truth in 81 to 95% of samples, up to five seconds in a row).
 *
 * This module only COUNTS. The store notes every accepted player Shop action here (`noteShopAction`); the stat holds
 * (`fx/statHold.ts`) and the Shop's buff waves (`fx/shopFxQueue.ts`) ask `shopInputRapid()` and, while it is true,
 * present the newest action only: older numbers land at once, older waves that have not started yet are dropped, and
 * the new numbers land with one pop instead of a roll.
 *
 * RAPID = at least `RAPID_ACTIONS` accepted actions inside the last `RAPID_WINDOW_MS`. Three inside one second: the
 * third action of a burst is the first one presented in short form. Once rapid it STAYS rapid until fewer than
 * `RAPID_EXIT_ACTIONS` (two) are inside the window, so a steady two and a half actions a second is presented one way,
 * not short and full by turns; a second without input ends it. A player acting at up to two actions a second never
 * sees any of this: every effect plays exactly as authored.
 *
 * It never touches gameplay: nothing here is read by the reducer, a replay or a snapshot.
 */

/** The window the action count is taken over. */
export const RAPID_WINDOW_MS = 1000;
/** Accepted actions inside the window (this one included) from which input counts as rapid. */
export const RAPID_ACTIONS = 3;
/** Once rapid, input stays rapid until fewer than this many actions are inside the window. */
export const RAPID_EXIT_ACTIONS = 2;

/** The player actions that count: the ones a player repeats at speed. Not End Turn, not a modal's pick. */
const COUNTED: ReadonlySet<string> = new Set(['buy', 'sell', 'play', 'roll', 'upgrade', 'heroPower', 'freeze', 'buyHenchman', 'activateEquipment']);
/** The actions that END the Shop's turn: what follows them (End of Turn beats, the fight) is always presented in full. */
const ENDS_TURN: ReadonlySet<string> = new Set(['faceOmen', 'landCombat', 'settleCombat', 'resolveCombat']);

/** Times of the counted actions still inside the window, oldest first. At most a few dozen entries. */
let stamps: number[] = [];
/** Bumped on every counted action: "which action is this presentation from". */
let epoch = 0;
/** Is input rapid right now? Latched: set at `RAPID_ACTIONS`, cleared under `RAPID_EXIT_ACTIONS`. */
let rapid = false;
const listeners = new Set<(rapid: boolean) => void>();

function trim(now: number): void {
  const from = now - RAPID_WINDOW_MS;
  let drop = 0;
  while (drop < stamps.length && stamps[drop]! <= from) drop++;
  if (drop > 0) stamps = stamps.slice(drop);
  if (stamps.length >= RAPID_ACTIONS) rapid = true;
  else if (stamps.length < RAPID_EXIT_ACTIONS) rapid = false;
}

/** Does this action type count toward the pressure? */
export function countsAsShopAction(type: string): boolean {
  return COUNTED.has(type);
}

/**
 * Note one ACCEPTED Shop action. Called by the store after the reducer took it and before React renders it, so
 * everything that presents the action can already ask `shopInputRapid()`. Listeners hear whether input is rapid as of
 * this action. `now` is injectable for tests.
 */
export function noteShopAction(type: string, now: number = performance.now()): void {
  if (ENDS_TURN.has(type)) { stamps = []; rapid = false; return; }
  if (!COUNTED.has(type)) return;
  stamps.push(now);
  trim(now);
  epoch++;
  for (const l of listeners) l(rapid);
}

/** Counted actions inside the last `RAPID_WINDOW_MS`. */
export function shopActionPressure(now: number = performance.now()): number {
  trim(now);
  return stamps.length;
}

/** Is the player acting fast enough that only the newest action should be presented in full? */
export function shopInputRapid(now: number = performance.now()): boolean {
  trim(now);
  return rapid;
}

/** The number of counted actions so far: presentation scheduled under an older number belongs to an older action. */
export function shopActionEpoch(): number {
  return epoch;
}

/** Hear every counted action, with whether input is rapid as of it. Returns the unsubscribe. */
export function onShopAction(fn: (rapid: boolean) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Forget everything (a new run, a phase change, a test). */
export function resetShopActionPressure(): void {
  stamps = [];
  rapid = false;
}
