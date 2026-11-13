import type { CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { Moment } from '../compile';

/** The effects that GIVE another minion a keyword at random; a card whose one grants Execute gets the slot. */
const KEYWORD_GIVING_EFFECTS: ReadonlySet<string> = new Set([
  'rallyGrantKeywordRandomTribe',  // Raven
  'avengeGrantKeywordRandomTribe', // Tort
]);

/** Does this card give ANOTHER minion Execute? The cards the workbench offers an "On Execute given" slot. */
export function givesExecute(cardId: string | null | undefined): boolean {
  return !!cardId && !!CARD_INDEX[cardId]?.effects?.some((f) => KEYWORD_GIVING_EFFECTS.has(f.do) && f.params?.keyword === 'V');
}

export interface ExecuteGiven {
  /** The giving card (the binding's key). */
  cardId: string;
  /** The giving body: alive, since both givers act from the board (a Rally, an Avenge). */
  source: string;
  target: string;
}

/**
 * Every Execute a minion GAVE another minion in this moment: a `keyword` event for Execute that names its source.
 * The engine stamps the giver on the grant (`ctx.log({ type: 'keyword', …, source })`), so unlike a Ward there is no
 * death or rally to search for. A keyword a unit gave ITSELF is not a travel and is left out.
 */
export function executesGivenIn(moment: Moment, events: CombatEvent[], cardIds: ReadonlyMap<string, string> | undefined): ExecuteGiven[] {
  const out: ExecuteGiven[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (e?.type !== 'keyword' || e.keyword !== 'V' || typeof e.source !== 'string' || e.source === e.target) continue;
    const cardId = cardIds?.get(e.source);
    if (cardId) out.push({ cardId, source: e.source, target: e.target });
  }
  return out;
}
