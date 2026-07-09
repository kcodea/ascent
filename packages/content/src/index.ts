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

/** Tavern spells — the pool the always-offered right-hand spell slot draws from. Excludes `token` spells
 *  (reward-exclusive, e.g. Feed the Alpha), so quest rewards never roll into the regular shop / spell Discover /
 *  Graverobber's grant. Combat's random-spell grant filters the same way. */
export const SPELL_CARDS: CardDef[] = ALL_CARDS.filter((card) => card.spell && !card.token);

/** Effect ids whose params carry a token id (a summoned token that must exist in the pool). */
const TOKEN_REF_EFFECTS = new Set(['deathrattleSummon', 'battlecrySummon', 'onFriendDeathSummon', 'deathrattleSummonOverflowBuff']);
/** Effect ids whose params carry a card id (a granted/transformed card that must exist in the pool), by param key.
 *  (The CardDef-level `ascendInto` transform target is checked separately — it's a field, not an effect param.) */
const CARD_REF_EFFECTS: Record<string, string> = {
  spellCastTransform: 'into',
  deathrattleGrantCardToHand: 'cardId',
  avengeGrantSpell: 'cardId',
  deathrattleBuffCardTypeRunWide: 'cardId',
};

/** Every card id a card names in its effects — the tokens it summons (`tokenId`), the cards it grants /
 *  transforms into (`spellCastTransform`, `avengeGrantSpell`, `deathrattleGrantCardToHand`, …), and its
 *  `ascendInto` target. Powers the UI's hover-preview of referenced cards so any card that mentions another card
 *  in its text ("add a Spark Plug", "summon 2 Whelps") surfaces it — reusing the exact ref-param map the
 *  validator checks, so the two never drift. Excludes the card itself. */
export function referencedCardIds(card: CardDef): string[] {
  const ids = new Set<string>();
  if (card.ascendInto) ids.add(card.ascendInto);
  const effects = [...card.effects, ...(card.chooseOne?.flatMap((o) => o.effects) ?? [])];
  for (const effect of effects) {
    const params = (effect.params ?? {}) as Record<string, unknown>;
    if (TOKEN_REF_EFFECTS.has(effect.do) && typeof params.tokenId === 'string') ids.add(params.tokenId);
    const cardKey = CARD_REF_EFFECTS[effect.do];
    if (cardKey && typeof params[cardKey] === 'string') ids.add(params[cardKey] as string);
  }
  ids.delete(card.id);
  return [...ids];
}

/** Validate every card against the schema + cross-reference every token/card id an effect names; throws on
 *  the first problem. Keeps a typo'd summon/grant target from surfacing at runtime instead of in `npm test`. */
export function validateCards(cards: CardDef[] = ALL_CARDS): void {
  const seen = new Set<string>();
  const has = (id: string | undefined): boolean => !!id && cards.some((c) => c.id === id);
  for (const card of cards) {
    CardDefSchema.parse(card);
    if (seen.has(card.id)) throw new Error(`Duplicate card id: ${card.id}`);
    seen.add(card.id);
    // A CardDef-level ascend target (Tara → Taragosa) must resolve.
    if (card.ascendInto && !has(card.ascendInto)) {
      throw new Error(`${card.id}: ascendInto references missing card "${card.ascendInto}"`);
    }
    for (const effect of card.effects) {
      const params = (effect.params ?? {}) as Record<string, unknown>;
      if (TOKEN_REF_EFFECTS.has(effect.do)) {
        const tokenId = params.tokenId as string | undefined;
        if (!has(tokenId)) throw new Error(`${card.id}: ${effect.do} references missing token "${tokenId}"`);
      }
      const cardKey = CARD_REF_EFFECTS[effect.do];
      if (cardKey) {
        const refId = params[cardKey] as string | undefined;
        if (!has(refId)) throw new Error(`${card.id}: ${effect.do} references missing card "${refId}"`);
      }
    }
  }
}

export { CardDefSchema, QuestDefSchema } from './schema';
export { QUEST_DEFS, QUEST_INDEX, validateQuests } from './quests';
export { NEUTRAL } from './cards/neutral';
export { BEASTS } from './cards/beasts';
export { DRAGONS } from './cards/dragons';
export { UNDEAD } from './cards/undead';
export { MECHS } from './cards/mechs';
export { DEMONS } from './cards/demons';
export { TOKENS } from './cards/tokens';
export { SPELLS } from './cards/spells';
export { ENEMY } from './cards/enemy';
