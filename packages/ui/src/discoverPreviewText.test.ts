// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, discoverOfferCard, type RunState } from '@game/sim';
import { discoverCardText } from './Recruit';
import { withGrantedKeywords } from './cardText';

/**
 * R-DISCOVER-PREVIEW-01 (owner 2026-11-16): a Discover option prints what the pick gains. The option's text reads the
 * sim's preview of the pick (`discoverOfferCard`), so a granted keyword with no mark on the card body (Critical Strike,
 * Engraved) ends its text, like a granted Rise, and a Gilded pick reads its golden text.
 */
const PLAIN = Object.values(CARD_INDEX).find((d) => !d.spell && !d.ruby && !d.token && d.tier <= 2 && d.effects.length === 0 && d.keywords.length === 0 && d.text.trim() === '')
  ?? Object.values(CARD_INDEX).find((d) => !d.spell && !d.ruby && !d.token && d.tier <= 2 && d.effects.length === 0 && d.keywords.length === 0)!;
const run = (over: Partial<RunState>): RunState => ({ ...createRun(7, 'keshi'), phase: 'recruit', hand: [], board: [], ...over } as RunState);

describe('a Discover option prints the keywords its pick gains', () => {
  it('a granted Critical Strike / Engraved ends the text; a printed one is not repeated', () => {
    expect(withGrantedKeywords(PLAIN.id, 'Hello.', ['CR'])).toBe('Hello. **Critical Strike.**');
    expect(withGrantedKeywords(PLAIN.id, '', ['EG'])).toBe('**Engraved.**');
    expect(withGrantedKeywords(PLAIN.id, 'Hello.', ['R', 'EG'])).toBe('Hello. **Rise.** **Engraved.**');
    const printsEg = Object.values(CARD_INDEX).find((d) => !d.spell && d.keywords.includes('EG'));
    if (printsEg) expect(withGrantedKeywords(printsEg.id, printsEg.text, ['EG'])).toBe(printsEg.text);
  });

  it('the Discover text follows the pick preview: Rising Echoes’ Rise shows on the option', () => {
    const s = run({ discover: [PLAIN.id], discoverKeywords: ['R', 'CR'] });
    const pick = discoverOfferCard(s, 0);
    const t = discoverCardText(s, PLAIN.id, {}, pick).text;
    expect(t).toContain('**Rise.**');
    expect(t).toContain('**Critical Strike.**');
    // Without the preview (the old row) neither showed.
    expect(discoverCardText(s, PLAIN.id, {}).text).not.toContain('**Critical Strike.**');
  });
});
