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

/**
 * THE SECOND CLASS: a factory that names its token IN CODE rather than in params.
 *
 * `summonImps` summons `CARD_INDEX['impscrap']` — a string literal in the factory body — so there is no param
 * for the sweep above to find, and Imp Wrangler's "**Start of Combat:** summon an **Imp**" showed no Imp on
 * hover (owner report 2026-08-04). The param sweep is structurally blind to this, which is why it passed the
 * whole time.
 *
 * Reading the factory source is the only way to re-derive the question rather than pin today's answer. The
 * empty-file assertion is load-bearing: if the factory file moves, this must FAIL rather than quietly find
 * nothing and go green.
 */
describe('factories that hardcode a token id declare it', () => {
  it('every hardcoded CARD_INDEX/getCard literal in the combat factories is surfaced on the cards using it', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../../core/src/effects/factories.ts', import.meta.url));
    const src = readFileSync(path, 'utf8');
    expect(src.length, 'factories.ts moved — this sweep is reading nothing').toBeGreaterThan(1000);

    // Split into top-level factory bodies, then collect the card-id literals each one names.
    const starts = [...src.matchAll(/\n {2}(\w+): \(/g)].map((m) => ({ at: m.index!, name: m[1]! }));
    const hardcoded = new Map<string, Set<string>>();
    starts.forEach(({ at, name }, i) => {
      const body = src.slice(at, starts[i + 1]?.at ?? src.length);
      const lits = [...body.matchAll(/(?:CARD_INDEX|getCard)\(\s*'([\w-]+)'\s*\)/g)]
        .map((m) => m[1]!)
        .filter((id) => !!CARD_INDEX[id]);
      if (lits.length) hardcoded.set(name, new Set(lits));
    });
    expect(hardcoded.size, 'no hardcoded literals found at all — the body split is broken').toBeGreaterThan(0);

    const missing: string[] = [];
    for (const card of ALL_CARDS) {
      const shown = new Set(referencedCardIds(card));
      const effects = [...card.effects, ...(card.chooseOne?.flatMap((o) => o.effects) ?? [])];
      for (const e of effects) {
        for (const id of hardcoded.get(e.do) ?? []) {
          if (id !== card.id && !shown.has(id)) missing.push(`${card.id} (${card.name}) summons ${id} via ${e.do}`);
        }
      }
    }
    expect(
      missing,
      'add the effect to IMPLICIT_REF_EFFECTS in content/index.ts — its token id is a literal in the factory, not a param',
    ).toEqual([]);
  });

  it('Imp Wrangler and Geode Guardian specifically show what they summon', () => {
    expect(referencedCardIds(CARD_INDEX['dm_wrangler']!), 'the reported case').toContain('impscrap');
    expect(referencedCardIds(CARD_INDEX['k_geode']!)).toContain('gemheart-shard');
  });
});
