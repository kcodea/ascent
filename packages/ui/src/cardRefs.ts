import { CARD_INDEX, referencedCardIds } from '@game/content';
import { ALE_IDS } from '@game/core';

/** The MANUAL related-card map — Fodder/Imp cards whose references aren't effect params (Feed *consumes* Fodder).
 *  The shop's hover popup and the Compendium's both read it, on top of `referencedCardIds` (every card an effect
 *  names). Lived inside Recruit.tsx until 2026-09-18; moved out so the Compendium could share it without importing
 *  the shop. */
export const CARD_REFERENCES: Record<string, string[]> = {
  alley: ['stray'], shaper: ['stray'], pack: ['pup'], brood: ['impscrap'], combinator: ['cling', 'moneybot', 'betterbot'],
  feed: ['fred'], ritualist: ['fred', 'impscrap'], maw: ['fred'],
  // Imp summoners / buffers — the popup shows the Imp token at its current buffed stats. Cards that touch
  // both Fodder and Imps (Ritualist, Bane, Fodder Feeder) reference both.
  impking: ['impscrap'], fodderfeeder: ['fred', 'impscrap'], bane: ['fred', 'impscrap'],
};

/** Every card id a card's hover popup should show: the manual map first, then the effect-named cards, then the
 *  derived Ruby rule (a card that talks about Rubies in general previews the Ruby — unless it already names a
 *  particular one; owner 2026-07-25 / 2026-08-31). De-duped, manual order wins, unknown ids dropped. ONE rule for
 *  the shop and the Compendium, so a card previews the same things wherever you hover it. */
export function relatedCardIds(cardId: string): string[] {
  const def = CARD_INDEX[cardId];
  const mentionsRuby = !!def && !def.ruby && /\bRub(y|ies)\b/i.test(`${def.text} ${def.goldenText ?? ''}`);
  const named = [...(CARD_REFERENCES[cardId] ?? []), ...(def ? referencedCardIds(def) : [])];
  const namesARuby = named.some((id) => CARD_INDEX[id]?.ruby);
  return [...new Set([...named, ...(mentionsRuby && !namesARuby ? ['ruby'] : [])])].filter((id) => CARD_INDEX[id]);
}

/** A POOL the hover popup shows ONE random member of per open (owner ask 2026-09-18): a card that talks about
 *  Dwarven Ales previews one Ale — a different one each time — rather than all five side by side. Only when the
 *  card names no particular Ale itself. */
export function relatedPickOneIds(cardId: string): string[] {
  const def = CARD_INDEX[cardId];
  if (!def) return [];
  const txt = `${def.text} ${def.goldenText ?? ''}`;
  if (/\b(Dwarven )?Ales?\b/.test(txt) && !relatedCardIds(cardId).some((id) => ALE_IDS.includes(id))) return [...ALE_IDS].filter((id) => CARD_INDEX[id]);
  return [];
}
