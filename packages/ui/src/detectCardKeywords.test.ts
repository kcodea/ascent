import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { detectCardKeywords } from './detectCardKeywords';
import { KEYWORD_GLOSSARY } from './keywordGlossary';

const ids = (card: { keywords: any[]; text: string }) => detectCardKeywords(card).map((e) => e.id);

describe('detectCardKeywords', () => {
  it('returns badge keywords in glossary order (Taunt before Ward)', () => {
    expect(ids({ keywords: ['DS', 'T'], text: '' })).toEqual(['taunt', 'ward']);
  });

  it('detects terms from the text, in glossary order not text order', () => {
    // Echo is declared before Choose One in the glossary.
    expect(ids({ keywords: [], text: '**Echo:** do a thing. **Choose One:** a or b.' }))
      .toEqual(['echo', 'chooseone']);
  });

  it('unions badge + text and de-dupes (Ward named AND badged appears once)', () => {
    expect(ids({ keywords: ['DS'], text: 'Gain **Ward**.' })).toEqual(['ward']);
  });

  it('matches classic aliases in raw text (Deathrattle -> echo)', () => {
    expect(ids({ keywords: [], text: '**Deathrattle:** boom.' })).toEqual(['echo']);
  });

  it('respects word boundaries (Warden does not match Ward; Uprising not Rise)', () => {
    expect(ids({ keywords: [], text: 'The Warden watches the Uprising.' })).toEqual([]);
  });

  it('returns [] for a vanilla card', () => {
    expect(ids({ keywords: [], text: '' })).toEqual([]);
  });

  // The three owner-worded pills (2026-09-18): Equip fires on the "**Equip <Name> (cost):**" text every Equipment
  // minion prints (no schema badge); Collapse + Starform fire on their nouns. Wording is pinned verbatim.
  it('Equip / Starform / Collapse pills: detection + the owner wording', () => {
    const lens = CARD_INDEX['ce3_lensgrinder']!; // "**Equip Stellar Lens (2):** create a **Starform**, …"
    const found = detectCardKeywords({ keywords: lens.keywords, text: lens.text ?? '' });
    expect(found.map((d) => d.id)).toEqual(['starform', 'equip']);
    expect(found.find((d) => d.id === 'equip')!.def).toBe('Can be triggered once per turn, per equipment, for a cost.');
    expect(found.find((d) => d.id === 'starform')!.def).toBe('A minion that occupies a Shop slot and stays in place until purchased or destroyed. Purchasing a Starform grants stats to the left-most Celestial.');
    expect(ids({ keywords: [], text: '**Shout:** Collapse your **Starform**.' })).toEqual(['shout', 'collapse', 'starform']);
    expect(KEYWORD_GLOSSARY.find((d) => d.id === 'collapse')!.def).toBe("Grant 50% of your Starform's stats to 3 Celestials and destroy it.");
    // "Equipment" (the noun) alone is not the Equip pill; a rune saying "an Equip minion" is.
    expect(ids({ keywords: [], text: 'its Equipment costs 0.' })).toEqual([]);
    expect(ids({ keywords: [], text: '**Discover** an Equip minion.' })).toEqual(['equip', 'discover']);
  });
});
