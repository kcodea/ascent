import { describe, expect, it } from 'vitest';
import { searchWiki } from './rulesWiki/search';
import { fingerprint } from './rulesWiki/fingerprint';
import type { WikiEntry } from './rulesWiki/types';

const E: WikiEntry[] = [
  { id: 'a', topic: 'shop', q: 'How do I sell a minion?', a: 'Drag it onto the shop.', aliases: ['get rid of'] },
  { id: 'b', topic: 'combat', q: 'Who attacks first?', a: 'Whoever has more minions. Sell nothing.' },
  { id: 'c', topic: 'shop', q: 'How do I refresh the shop?', a: 'Hit the reroll button.', aliases: ['sell'] },
];

describe('searchWiki', () => {
  it('empty query keeps source order', () => {
    expect(searchWiki(E, '  ', new Set()).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
  it('topic chips narrow', () => {
    expect(searchWiki(E, '', new Set(['shop'])).map((e) => e.id)).toEqual(['a', 'c']);
  });
  it('ranks question > alias > answer', () => {
    expect(searchWiki(E, 'sell', new Set()).map((e) => e.id)).toEqual(['a', 'c', 'b']);
  });
  it('alias-only hit is found', () => {
    expect(searchWiki(E, 'get rid', new Set()).map((e) => e.id)).toEqual(['a']);
  });
  it('every word must match', () => {
    expect(searchWiki(E, 'sell zebra', new Set())).toEqual([]);
  });
  it('is case-insensitive and ignores **bold** markers', () => {
    const bold: WikiEntry[] = [{ id: 'x', topic: 'basics', q: 'Q?', a: 'It is **Ward** time.' }];
    expect(searchWiki(bold, 'WARD TIME', new Set()).map((e) => e.id)).toEqual(['x']);
  });
});

describe('fingerprint', () => {
  it('is stable, 8 hex, and whitespace-insensitive', () => {
    expect(fingerprint('a  b\n c')).toBe(fingerprint('a b c'));
    expect(fingerprint('a b c')).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint('a b c')).not.toBe(fingerprint('a b d'));
  });
});
