import type { CardDef } from '@game/core';
import { CardDefSchema } from './schema';
import { TOKENS } from './cards/set1/tokens';
import { ENEMY } from './cards/set1/enemy';
import { SETS, poolFor } from './sets';

export * from './sets';

/**
 * Every card that has ever existed, across every set — the union, NOT the playable pool.
 *
 * This stays global on purpose. `CARD_INDEX` is a pure id→def lookup used at ~500 sites (rendering a card,
 * resolving a summoned token, healing a save), and none of those care which set is live: an id resolves to
 * the same card regardless. Only the ~20 sites that *draw* from a pool are set-aware, and they go through
 * `poolFor(setId)` / sim's `poolOf(state)`.
 *
 * Tokens and enemy filler live here and in no set: they are never drawn, only reached through a card that
 * names them, so they can't leak across sets.
 */
export const ALL_CARDS: CardDef[] = [
  ...Object.values(SETS).flatMap((s) => s.own),
  ...TOKENS,
  ...ENEMY,
].filter((card, i, arr) => arr.findIndex((c) => c.id === card.id) === i); // a shared card appears once

export const CARD_INDEX: Record<string, CardDef> = Object.fromEntries(
  ALL_CARDS.map((card) => [card.id, card]),
);

/**
 * The ACTIVE set's shop-offerable minions.
 *
 * @deprecated for new code — prefer `poolOf(state).buyable` (sim) or `poolFor(setId).buyable`, which honour
 * the set the RUN was pinned to rather than whichever set happens to be enabled right now. Kept because a
 * handful of set-agnostic consumers (the Compendium's "browse everything" mode, balance tooling) legitimately
 * want the live default.
 */
export const BUYABLE_CARDS: CardDef[] = [...poolFor(SETS.set1.id).buyable];

/** Tavern spells — the pool the always-offered right-hand spell slot draws from. Excludes `token` spells
 *  (reward-exclusive, e.g. Feed the Alpha), so quest rewards never roll into the regular shop / spell Discover /
 *  Graverobber's grant. Combat's random-spell grant filters the same way.
 *  @deprecated for new code — see BUYABLE_CARDS. */
export const SPELL_CARDS: CardDef[] = [...poolFor(SETS.set1.id).spells];

/** Effect ids whose params carry a token id (a summoned token that must exist in the pool). */
const TOKEN_REF_EFFECTS = new Set(['deathrattleSummon', 'battlecrySummon', 'onFriendDeathSummon', 'deathrattleSummonOverflowBuff']);
/** Effect ids whose params carry a card id (a granted/transformed card that must exist in the pool), by param key.
 *  (The CardDef-level `ascendInto` transform target is checked separately — it's a field, not an effect param.) */
const CARD_REF_EFFECTS: Record<string, string> = {
  spellCastTransform: 'into',
  deathrattleGrantCardToHand: 'cardId',
  avengeGrantSpell: 'cardId',
  deathrattleBuffCardTypeRunWide: 'cardId',
  // Minions that CAST a named spell — surface that spell on hover so its live (spell-power-aware) value is
  // readable there instead of restated on the minion. Taragosa/Watcher cast a fixed spell with no `spellId`
  // in their factory, so they carry a reference-only `spellId` param purely for this map (the factory ignores it).
  castSpell: 'spellId',
  onKillCastSpell: 'spellId',
  rallyCastSpell: 'spellId',
  endOfTurnCastSpellEscalating: 'spellId',
  onAllyAttackCastGrowth: 'spellId',
  rallyCastTribeAttack: 'spellId',
  battlecryGrantSpell: 'spellId',
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

export { CardDefSchema, QuestDefSchema, RuneDefSchema } from './schema';
export { QUEST_DEFS, QUEST_INDEX, validateQuests } from './quests';
export { RUNES, EPIC_RUNES, RUNE_INDEX, validateRunes } from './runes';
export { badgeIdForCombatFlag } from './questFlags';
export { NEUTRAL } from './cards/set1/neutral';
export { BEASTS } from './cards/set1/beasts';
export { DRAGONS } from './cards/set1/dragons';
export { UNDEAD } from './cards/set1/undead';
export { MECHS } from './cards/set1/mechs';
export { DEMONS } from './cards/set1/demons';
export { TOKENS } from './cards/set1/tokens';
export { SPELLS } from './cards/set1/spells';
export { ENEMY } from './cards/set1/enemy';
