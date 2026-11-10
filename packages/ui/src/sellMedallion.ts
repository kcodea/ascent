import { CARD_INDEX } from '@game/content';
import type { CardView } from './Card';
import { isEpicUnit } from './epicMedallion';
import { resolveMech } from './mechIcon';

/**
 * Does `cardId` wear the SELL medallion (R-FX-SELL-01)? The same pick the card face makes: its first-mentioned
 * mechanic is Sell, and it is not an Epic card (those wear the Epic medallion instead).
 */
export function hasSellMedallion(cardId: string): boolean {
  const def = CARD_INDEX[cardId];
  if (!def || isEpicUnit(cardId)) return false;
  const view = { cardId, keywords: [...(def.keywords ?? [])], text: def.text ?? '' } as unknown as CardView;
  return resolveMech(view)?.id === 'sell';
}

/** Quick Sale: its bonus Gold rides the next sale this turn, and its On Sell effect plays on the unit sold (R-FX-SELL-01). */
export const QUICK_SALE_ID = 'quicksale';

/** Does this card boost a later sale (Quick Sale's next-sell Gold)? Its On Sell slot plays on the unit whose sale it boosts. */
export function boostsNextSell(cardId: string): boolean {
  return CARD_INDEX[cardId]?.effects?.some((e) => e.do === 'spellNextSellBonus') ?? false;
}
