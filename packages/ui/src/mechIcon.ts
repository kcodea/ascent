/**
 * The minion medallion glyph. Detects the mechanics the card ITSELF has (via the shared MECHANICS registry),
 * and returns the FIRST one mentioned in the card's text — or null for a blank badge. Never the tribe.
 * CardView has no `effects`, so the def is looked up in CARD_INDEX; keywords come from the live view.
 */
import { CARD_INDEX } from '@game/content';
import type { CardView } from './Card';
import { MECHANICS, type Mechanic, type MechInput } from './mechanics';

/** Index of the mechanic's first term in the text (bold markers stripped), or -1 if absent. Ordering only. */
export function firstMentionIndex(text: string, m: Mechanic): number {
  if (!m.termRe) return -1;
  const match = m.termRe.exec(text.replace(/\*\*/g, ''));
  return match ? match.index : -1;
}

export function resolveMechIcon(view: CardView): string | null {
  const def = CARD_INDEX[view.cardId];
  const input: MechInput = {
    keywords: view.keywords,
    effects: def?.effects ?? [],
    chooseOne: def?.chooseOne,
    text: view.text ?? '',
  };
  const owned = MECHANICS.filter((m) => m.detect(input));
  if (owned.length === 0) return null;
  if (owned.length === 1) return owned[0]!.glyph;
  const kwPos = (m: Mechanic): number => (m.kw ? input.keywords.indexOf(m.kw) : -1);
  const winner = owned.slice().sort((a, b) => {
    const pa = firstMentionIndex(input.text, a), pb = firstMentionIndex(input.text, b);
    if (pa !== -1 && pb !== -1) return pa - pb;        // both in text → text order
    if (pa !== -1) return -1;                          // only a in text → a wins
    if (pb !== -1) return 1;                            // only b in text → b wins
    const ka = kwPos(a), kb = kwPos(b);                 // neither in text: keyword order…
    if (ka !== -1 && kb !== -1) return ka - kb;
    if (ka !== -1) return -1;
    if (kb !== -1) return 1;
    return a.order - b.order;                           // …then global order
  })[0]!;
  return winner.glyph;
}
