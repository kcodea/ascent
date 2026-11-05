import { ALE_IDS } from '@game/core';

/** Edward Keg-hands: "Dwarven Ales you cast from hand trigger twice". He has no effect of his own (the rule lives in
 *  `spellCasts`), so the shop fires his On Watcher binding on his card whenever he multiplies an Ale. */
export const ALE_WATCHER_ID = 'dw_edward';

/** The board uids whose On Watcher binding plays for casting `cardId` from hand: every Keg-hands on board when
 *  the spell is an Ale, else none. Pure, so the rule tests without a DOM. */
export function aleWatcherUids(cardId: string, board: ReadonlyArray<{ uid: string; cardId: string }>): string[] {
  if (!ALE_IDS.includes(cardId)) return [];
  return board.filter((c) => c.cardId === ALE_WATCHER_ID).map((c) => c.uid);
}
