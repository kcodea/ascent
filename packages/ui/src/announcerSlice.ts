/**
 * THE ANNOUNCER'S PERSISTED SLICE — the part of the announcer that must survive Save & Continue.
 *
 * A LEAF module on purpose: no imports, so the store can hold and serialize this slice (next to the telemetry
 * and derivation slices) without a load-order cycle with `announcer.ts`, which imports the store's gate.
 *
 * `fired` is, per event, the WAVES it has spoken at (an array because three events may speak twice per game:
 * BackToShop, Triple and Knockout, see `announcer.ts`); `count` is how many lines the cap counts (every line except the
 * two end-of-game lines). `seed` pins it to one run: a slice restored against another seed is discarded.
 */

export type AnnouncerEvent =
  | 'gameStart'
  | 'backToShop'
  | 'equipment'
  | 'triple'
  | 'tierSix'
  | 'runeforge'
  | 'epicRuneforge'
  | 'enteringCombat'
  | 'enteringCombatAfterLoss'
  | 'startCombatUnder10hp'
  | 'surviveUnder10hp'
  | 'losingLowOddsFight'
  | 'winningLowOddsFight'
  | 'threeWinStreak'
  | 'minionHits100Stats'
  | 'topFour'
  | 'topTwo'
  | 'gameWon'
  | 'gameLoss'
  // The second batch (owner 2026-09-24).
  | 'knockout'
  | 'bigHit'
  | 'comebackWin'
  | 'flawlessVictory'
  | 'goldenArmy'
  | 'richTurn'
  | 'bigSpender'
  | 'shopBigBuff'
  | 'pair'
  | 'tribeFour'
  | 'randomSpellBuy'
  | 'randomCardBuy'
  | 'randomBeastBuy'
  | 'randomDwarfBuy'
  | 'round7'
  // The shop-clock warning (owner 2026-09-25).
  | 'timeRunningOut';

export interface AnnouncedSlice {
  seed: number;
  fired: Partial<Record<AnnouncerEvent, number[]>>;
  count: number;
}

export function emptyAnnounced(seed: number): AnnouncedSlice {
  return { seed, fired: {}, count: 0 };
}

/** A slice from a save is only adopted for the run it was written for. */
export function announcedFor(slice: AnnouncedSlice | null | undefined, seed: number): AnnouncedSlice {
  if (!slice || slice.seed !== seed || typeof slice.count !== 'number' || !slice.fired) return emptyAnnounced(seed);
  return slice;
}

/** The two end-of-game lines sit outside the per-game cap. */
export const UNCAPPED_EVENTS: readonly AnnouncerEvent[] = ['gameWon', 'gameLoss'];

/** Pure: the slice after `event` spoke at `wave`. */
export function withAnnounced(slice: AnnouncedSlice, event: AnnouncerEvent, wave: number): AnnouncedSlice {
  const waves = [...(slice.fired[event] ?? []), wave];
  return {
    seed: slice.seed,
    fired: { ...slice.fired, [event]: waves },
    count: slice.count + (UNCAPPED_EVENTS.includes(event) ? 0 : 1),
  };
}

export const firedWaves = (slice: AnnouncedSlice, event: AnnouncerEvent): readonly number[] => slice.fired[event] ?? [];
export const hasFired = (slice: AnnouncedSlice, event: AnnouncerEvent): boolean => firedWaves(slice, event).length > 0;
