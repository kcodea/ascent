import { useSyncExternalStore } from 'react';
import type { CardDef, Tribe } from '@game/core';

/**
 * REACTIVE CURSOR (owner 2026-11-27, R-CURSOR-REACTIVE-01): a Settings switch (default OFF, saved on this device). While
 * on, the player's own cursor takes the look of the tribe they have the MOST of on their own board.
 *
 *  - Counting: a minion counts toward its printed tribe, its second tribe and any spell-added tribe; an All-types minion
 *    (card or instance) counts toward EVERY tribe, as it does for buffs. Neutral never counts.
 *  - Tie: the tied tribe whose minion sits furthest LEFT wins. When that one minion holds several of the tied tribes, its
 *    tribes in printed order (tribe, tribe2, added) decide; an All-types minion alone settles nothing, so the next minion
 *    to the right is asked. Nothing settles it → no tribe (the gauntlet).
 *  - Only the player's own game: the menus, replays, spectating and live-watching keep the gauntlet. The board read is the
 *    run's recruit board, which combat never edits, so the cursor holds still through a fight.
 *  - A tribe with no art yet (`TRIBES_WITH_CURSOR_ART`) keeps the gauntlet.
 *
 * Performance: the hook re-renders only when the picked tribe (a string) changes, and applying it writes three custom
 * properties on <html> once. Nothing runs per frame.
 */

/** The board fields the pick reads (a `BoardMinion` satisfies it). */
export interface CursorBoardMinion {
  cardId: string;
  addedTribes?: readonly Tribe[];
  universalTribe?: boolean;
}

/** The tribes of one minion, in printed order, and whether it counts as every tribe. Neutral dropped. */
function tribesOfMinion(m: CursorBoardMinion, def: CardDef | undefined): { list: Tribe[]; all: boolean } {
  const list: Tribe[] = [];
  const add = (t: Tribe | undefined): void => { if (t && t !== 'neutral' && !list.includes(t)) list.push(t); };
  add(def?.tribe);
  add(def?.tribe2);
  for (const t of m.addedTribes ?? []) add(t);
  return { list, all: !!def?.universalTribe || !!m.universalTribe };
}

/** The board's dominant tribe for the cursor, or null (empty / all Neutral / unsettled). Pure. */
export function dominantTribe(board: readonly CursorBoardMinion[], cards: Readonly<Record<string, CardDef | undefined>>, tribes: readonly Tribe[]): Tribe | null {
  const real: Tribe[] = tribes.filter((t) => t !== 'neutral');
  const per = board.map((m) => tribesOfMinion(m, cards[m.cardId]));
  const count = new Map<Tribe, number>();
  for (const p of per) for (const t of real) if (p.all || p.list.includes(t)) count.set(t, (count.get(t) ?? 0) + 1);
  let best = 0;
  for (const n of count.values()) best = Math.max(best, n);
  if (best === 0) return null;
  const tied = real.filter((t) => count.get(t) === best);
  if (tied.length === 1) return tied[0]!;
  for (const p of per) {
    const own = p.list.find((t) => tied.includes(t));
    if (own) return own;
    // An All-types minion holds every tied tribe at once: it settles nothing, ask the next one.
  }
  return null;
}

// ── The art ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The three cursor states the game paints, with their hotspots (the gauntlet's). */
export const CURSOR_STATES = {
  default: { hotspot: '6 2' },
  open: { hotspot: '6 2' },
  closed: { hotspot: '13 12' },
} as const;
export type CursorState = keyof typeof CURSOR_STATES;

/**
 * The tribes whose art is in `apps/web/public/cursors/tribes/` (`<tribe>_default.svg`, `_open.svg`, `_closed.svg`).
 * ADD A TRIBE HERE when its three SVGs land; reactiveCursor.test.ts fails if a listed tribe is missing a file.
 */
export const TRIBES_WITH_CURSOR_ART: readonly Tribe[] = [];

/** The Settings switch shows only once some tribe has art: until then it would do nothing. */
export const reactiveCursorReady = (): boolean => TRIBES_WITH_CURSOR_ART.length > 0;

/** Public path of one tribe cursor file (BASE_URL-relative: itch serves the game from a sub-path). */
export function tribeCursorPath(tribe: Tribe, state: CursorState, base = '/'): string {
  return `${base}cursors/tribes/${tribe}_${state}.svg`;
}

/** The custom property every cursor rule in the CSS reads (`cursor: var(--cursor-open), pointer`). */
export const cursorVar = (state: CursorState): string => `--cursor-${state}`;

/** Paint the cursor of `tribe` (null or no art: back to the gauntlet, the CSS defaults). */
export function applyTribeCursor(tribe: Tribe | null, root: HTMLElement = document.documentElement, base = import.meta.env.BASE_URL ?? '/'): void {
  const on = tribe !== null && TRIBES_WITH_CURSOR_ART.includes(tribe);
  for (const state of Object.keys(CURSOR_STATES) as CursorState[]) {
    if (on) root.style.setProperty(cursorVar(state), `url('${tribeCursorPath(tribe, state, base)}') ${CURSOR_STATES[state].hotspot}`);
    else root.style.removeProperty(cursorVar(state));
  }
}

// ── The Settings switch ("Reactive Cursor", default OFF). Saved on this device. ────────────────────────────────────
const PREF_KEY = 'ascent.reactiveCursorOn';
let prefOn: boolean = (() => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(PREF_KEY) === 'on'; } catch { return false; }
})();
const prefListeners = new Set<() => void>();
export function reactiveCursorEnabled(): boolean {
  return prefOn;
}
export function setReactiveCursorEnabled(on: boolean): void {
  prefOn = on;
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* storage unavailable: lasts this session */ }
  prefListeners.forEach((l) => l());
}
const subscribePref = (l: () => void): (() => void) => {
  prefListeners.add(l);
  return () => prefListeners.delete(l);
};
export function useReactiveCursorEnabled(): boolean {
  return useSyncExternalStore(subscribePref, reactiveCursorEnabled, reactiveCursorEnabled);
}
