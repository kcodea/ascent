import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { KEYWORD_GLOSSARY } from './keywordGlossary';
import { detectCardKeywords } from './detectCardKeywords';

// Terms that are real game vocabulary but never appear inside a single card's own body text:
// 'gilded' is a display STATE of a card, not a word a card prints about itself.
// 'stealth' is a mechanic not yet implemented on any cards in the current pool.
const EXEMPT = new Set(['gilded', 'stealth']);

describe('keyword glossary coverage', () => {
  it('every glossary term is detected on at least one real card', () => {
    const seen = new Set<string>();
    for (const def of Object.values(CARD_INDEX)) {
      const card = { keywords: def.keywords ?? [], text: def.text ?? '' };
      for (const e of detectCardKeywords(card)) seen.add(e.id);
    }
    const missing = KEYWORD_GLOSSARY.map((e) => e.id).filter((id) => !seen.has(id) && !EXEMPT.has(id));
    expect(missing).toEqual([]);
  });
});
