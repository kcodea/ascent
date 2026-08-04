import { describe, it, expect } from 'vitest';
import { ALL_CARDS, CARD_INDEX, referencedCardIds } from './index';

/**
 * A card that NAMES another card in its text must show that card on hover — the same rule the runes follow
 * (owner 2026-08-01), and the reason `referencedCardIds` exists.
 *
 * The trap is that the rule is enforced by a MAP keyed on effect id: add a factory that names a card in its
 * params and forget the map entry, and the promise silently never renders. That is exactly what happened to
 * Commander Warpath ("Shout: get a Brood Whelp" — owner report 2026-08-03); the sweep below found five more
 * in the same state.
 *
 * So rather than pin the six, this re-derives the question: any effect param that holds a REAL card id and
 * isn't surfaced is a finding. A future card gets caught here instead of shipping a promise it doesn't show.
 */
describe('every card a card names is previewable', () => {
  it('no effect param names a card that the hover preview would miss', () => {
    const missing: string[] = [];
    for (const card of ALL_CARDS) {
      const shown = new Set(referencedCardIds(card));
      const effects = [...card.effects, ...(card.chooseOne?.flatMap((o) => o.effects) ?? [])];
      for (const e of effects) {
        for (const [key, v] of Object.entries(e.params ?? {})) {
          if (typeof v !== 'string' || v === card.id) continue;
          if (!CARD_INDEX[v]) continue; // not a card id — just a string param
          if (shown.has(v)) continue;
          missing.push(`${card.id} (${card.name}) names ${v} via ${e.do}.${key}`);
        }
      }
    }
    expect(
      missing,
      'add the effect to CARD_REF_EFFECTS in content/index.ts (or, if the param genuinely is not a card reference, exclude it there)',
    ).toEqual([]);
  });

  it('Commander Warpath specifically shows its Brood Whelp', () => {
    expect(referencedCardIds(CARD_INDEX['d2_blazingkeeper']!)).toContain('d2_broodwhelp');
  });
});
