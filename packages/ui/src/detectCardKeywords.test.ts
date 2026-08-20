import { describe, it, expect } from 'vitest';
import { detectCardKeywords } from './detectCardKeywords';

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
});
