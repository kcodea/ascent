import type { CardDef } from '@game/core';
import { CardDefSchema } from './schema';
import { NEUTRAL } from './cards/neutral';
import { BEASTS } from './cards/beasts';
import { DRAGONS } from './cards/dragons';
import { UNDEAD } from './cards/undead';
import { MECHS } from './cards/mechs';
import { DEMONS } from './cards/demons';
import { TOKENS } from './cards/tokens';
import { SPELLS } from './cards/spells';
import { ENEMY } from './cards/enemy';

export const ALL_CARDS: CardDef[] = [
  ...NEUTRAL,
  ...BEASTS,
  ...DRAGONS,
  ...UNDEAD,
  ...MECHS,
  ...DEMONS,
  ...TOKENS,
  ...SPELLS,
  ...ENEMY,
];

export const CARD_INDEX: Record<string, CardDef> = Object.fromEntries(
  ALL_CARDS.map((card) => [card.id, card]),
);

/** Minions offered in the shop (excludes tokens, spells, and enemy filler). */
export const BUYABLE_CARDS: CardDef[] = ALL_CARDS.filter((card) => !card.token && !card.spell);

/** Tavern spells — the pool the always-offered right-hand spell slot draws from. */
export const SPELL_CARDS: CardDef[] = ALL_CARDS.filter((card) => card.spell);

/** Validate every card against the schema; throws on the first problem. */
export function validateCards(cards: CardDef[] = ALL_CARDS): void {
  const seen = new Set<string>();
  for (const card of cards) {
    CardDefSchema.parse(card);
    if (seen.has(card.id)) throw new Error(`Duplicate card id: ${card.id}`);
    seen.add(card.id);
    for (const effect of card.effects) {
      if (
        effect.do === 'deathrattleSummon' ||
        effect.do === 'battlecrySummon' ||
        effect.do === 'onFriendDeathSummon'
      ) {
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
export { UNDEAD } from './cards/undead';
export { MECHS } from './cards/mechs';
export { DEMONS } from './cards/demons';
export { TOKENS } from './cards/tokens';
export { SPELLS } from './cards/spells';
export { ENEMY } from './cards/enemy';
