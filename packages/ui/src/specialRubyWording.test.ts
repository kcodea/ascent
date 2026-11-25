/** R-RUBY-SPECIAL-01 (owner 2026-11-25): "\"random ruby\" becomes \"Special Ruby\" and is ALWAYS a non-standard Ruby". */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { SPECIAL_RUBY_IDS } from '@game/core';
import { relatedCardIds, relatedPickOneIds } from './cardRefs';
import { detectCardKeywords } from './detectCardKeywords';

const pills = (text: string): string[] => detectCardKeywords({ keywords: [], text }).map((k) => k.id);

describe('Special Ruby', () => {
  it('no card or rune says "random Ruby" any more', () => {
    for (const c of [...Object.values(CARD_INDEX), ...RUNES, ...EPIC_RUNES]) {
      const txt = `${c.text} ${'goldenText' in c ? c.goldenText ?? '' : ''}`.replace(/\*\*/g, '');
      expect(txt, c.id).not.toMatch(/random Rub(y|ies)/i);
      expect(txt, c.id).not.toMatch(/special Rub(y|ies)/); // always capitalised
    }
  });

  it('previews one of the five, never the plain Ruby it is not', () => {
    expect(relatedPickOneIds('rubyshipment')).toEqual([...SPECIAL_RUBY_IDS]);
    expect(relatedCardIds('rubyshipment')).not.toContain('ruby');
    // a card that says both previews both
    expect(relatedCardIds('k_gemsage')).toContain('ruby');
    expect(relatedPickOneIds('k_gemsage')).toEqual([...SPECIAL_RUBY_IDS]);
    expect(relatedPickOneIds('k_candleconduit')).toEqual([]);
  });

  it('has its own keyword pill, apart from Ruby', () => {
    expect(pills('Get a **Special Ruby**.')).toEqual(['specialruby']);
    expect(pills('Get a **Ruby**.')).toEqual(['ruby']);
    expect(pills('When you get a **Ruby**, also get **2 Special Rubies**.')).toEqual(['ruby', 'specialruby']);
  });
});
