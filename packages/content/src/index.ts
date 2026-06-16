import type { CardDef } from '@game/core';
import { CardDefSchema } from './schema';
import { NEUTRAL } from './cards/neutral';
import { BEASTS } from './cards/beasts';
import { DRAGONS } from './cards/dragons';
import { TOKENS } from './cards/tokens';
import { ENEMY } from './cards/enemy';

export const ALL_CARDS: CardDef[] = [...NEUTRAL, ...BEASTS, ...DRAGONS, ...TOKENS, ...ENEMY];

export const CARD_INDEX: Record<string, CardDef> = Object.fromEntries(
  ALL_CARDS.map((card) => [card.id, card]),
);

/** Cards offered in the shop (buyable only — excludes tokens and enemy filler). */
export const BUYABLE_CARDS: CardDef[] = ALL_CARDS.filter((card) => !card.token);

/** Validate every card against the schema; throws on the first problem. */
export function validateCards(cards: CardDef[] = ALL_CARDS): void {
  const seen = new Set<string>();
  for (const card of cards) {
    CardDefSchema.parse(card);
    if (seen.has(card.id)) throw new Error(`Duplicate card id: ${card.id}`);
    seen.add(card.id);
    for (const effect of card.effects) {
      if (effect.do === 'deathrattleSummon' || effect.do === 'battlecrySummon') {
        const tokenId = (effect.params as { tokenId?: string } | undefined)?.tokenId;
        if (!tokenId || !cards.some((c) => c.id === tokenId)) {
          throw new Error(`${card.id}: ${effect.do} references missing token "${tokenId}"`);
        }
      }
    }
  }
}

export { CardDefSchema } from './schema';
export { NEUTRAL } from './cards/neutral';
export { BEASTS } from './cards/beasts';
export { DRAGONS } from './cards/dragons';
export { TOKENS } from './cards/tokens';
export { ENEMY } from './cards/enemy';
