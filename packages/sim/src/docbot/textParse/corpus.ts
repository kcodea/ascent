/**
 * DOC BOT 2.0 WP E — the printed-text corpus: one row per ACTIVE content object, with its displayed text
 * resolved from the indexes (never duplicated — the friction-9 doctrine: text lives in CARD_INDEX /
 * RUNE_INDEX / QUEST_DEFS / HEROES, contracts and parsers read it at check time).
 *
 * The enumeration is driven BY THE CONTRACT REGISTRY (the caller passes `allContracts()`), so WP E's
 * classification surface is definitionally the same inventory the WP B exit gate counts — an object
 * cannot be in the contract inventory yet missing from the text sweep, or vice versa.
 *
 * Quests print no free text (their name/objective/reward render from data), so their rows are
 * `textless: true` — counted separately in every report, never conflated with a parsed text.
 */
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import type { ContentContract } from '@game/rules/contracts/schema';
import { heroIdOfContentId } from '@game/rules/contracts/schema';
import { HEROES } from '../../heroes';

export interface TextObject {
  contentId: string;
  contentType: ContentContract['contentType'];
  /** The plain printed text ('' when the object prints none). */
  text: string;
  /** Authored gilded text, when the object has one (cards only). */
  goldenText?: string;
  textless: boolean;
}

let HERO_BY_ID: Map<string, (typeof HEROES)[number]> | null = null;
const heroOf = (heroId: string) => {
  if (!HERO_BY_ID) HERO_BY_ID = new Map(HEROES.map((h) => [h.id, h]));
  return HERO_BY_ID.get(heroId);
};

/** Resolve one contract's printed text legs from the live indexes. */
export function textObjectOf(c: ContentContract): TextObject {
  const base = { contentId: c.contentId, contentType: c.contentType };
  switch (c.contentType) {
    case 'rune': {
      const text = (RUNE_INDEX[c.contentId] as { text?: string } | undefined)?.text ?? '';
      return { ...base, text, textless: !text };
    }
    case 'quest':
      return { ...base, text: '', textless: true };
    case 'hero-power': {
      const hero = heroOf(heroIdOfContentId(c.contentId) ?? '');
      const text = hero?.power.text ?? '';
      return { ...base, text, textless: !text };
    }
    default: {
      const def = CARD_INDEX[c.contentId];
      const text = def?.text ?? '';
      return { ...base, text, ...(def?.goldenText ? { goldenText: def.goldenText } : {}), textless: !text };
    }
  }
}
