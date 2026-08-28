import { describe, it, expect } from 'vitest';
import { runeModifiedNote } from './cardText';

/**
 * RUNE-MODIFIED CARD RULES SAY SO ON THE CARD (owner rule 2026-08-02, generalizing the Rune of the Mammoth
 * pattern): a rune that changes how a specific card behaves makes that card's printed rule inaccurate — the
 * card gets a green live note on every surface (shop, board, hand, combat — the note rides the shared chain).
 */
describe('runeModifiedNote — the audit set', () => {
  it('covers every rune-modified card, and only when the rune is owned', () => {
    expect(runeModifiedNote('b2_runebloom', { matriarch: true })).toContain('twice');
    expect(runeModifiedNote('k_rubybroker', { brokerage: true })).toContain('No per-turn limit');
    expect(runeModifiedNote('gemheart-shard', { livingTreasure: true })).toContain('Echo');
    // Facetwright is no longer a NOTE: since 2026-08-28 the rune makes the card skip its prompt entirely, and
    // the card prints a coloured (Both) with both branches (see `chooseBothText`) instead of a footnote under a
    // "Choose One:" label that is no longer true.
    expect(runeModifiedNote('facetwright', {})).toBeNull();
    // Without the rune: silence — the printed rule is accurate.
    expect(runeModifiedNote('b2_runebloom', {})).toBeNull();
    expect(runeModifiedNote('b2_runebloom', undefined)).toBeNull();
    // The flag never leaks onto an unrelated card.
    expect(runeModifiedNote('drummer', { matriarch: true, brokerage: true, livingTreasure: true })).toBeNull();
  });
});
