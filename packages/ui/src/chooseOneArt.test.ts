import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_INDEX } from '@game/content';
import { artVariantKey } from './art';

/**
 * Choose One per-branch ART (owner 2026-07-25): a resolved instance wears the art of the branch it became.
 * The wiring is a NAMING convention rather than a data field — option index N renders `<cardId><N+1>`, so
 * option 0 keeps the base file and Wildwood Shaper's Stray branch (index 1) is `shaper2`.
 *
 * That convention is invisible to typecheck: a file dropped under the wrong number doesn't fail a build, it
 * just silently never renders (too high) or renders on the wrong branch (wrong index). These tests are the
 * only thing standing between a mis-named drop and dead art, so they check the FILES, not the lookup.
 */
const ART_DIR = join(__dirname, 'art', 'minions');
const SPELL_DIR = join(__dirname, 'art', 'spells');

const artIds = (dir: string): string[] => {
  try {
    return readdirSync(dir).map((f) => f.replace(/\.(png|webp)$/i, ''));
  } catch {
    return [];
  }
};
const ALL_ART = [...artIds(ART_DIR), ...artIds(SPELL_DIR)];

/** Every card that actually offers a choice. */
const CHOOSE_ONE = Object.values(CARD_INDEX).filter((c) => (c.chooseOne?.length ?? 0) > 0);

describe('Choose One per-branch art', () => {
  it('there are Choose One cards to check (guards against a vacuous sweep)', () => {
    expect(CHOOSE_ONE.length).toBeGreaterThan(5);
  });

  it('every branch-art file maps to an option that EXISTS on its card', () => {
    for (const c of CHOOSE_ONE) {
      const branchFiles = ALL_ART.filter((id) => new RegExp(`^${c.id}\\d+$`).test(id));
      for (const file of branchFiles) {
        const n = Number(file.slice(c.id.length));
        // `<id>2` is option index 1, so the highest legal file number is the option count.
        expect(n, `${file}: ${c.name} has ${c.chooseOne!.length} options, so ${file} would never render`)
          .toBeLessThanOrEqual(c.chooseOne!.length);
        expect(n, `${file}: option 0 uses the BASE art (${c.id}), so there is no "${c.id}1"`)
          .toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('Wildwood Shaper ships art for its Stray branch, at the index that branch actually occupies', () => {
    const shaper = CARD_INDEX['shaper']!;
    // The owner's reference case. If the option ORDER is ever swapped, the art silently follows the wrong
    // branch — so pin which index summons the Stray rather than just that two options exist.
    const strayIdx = shaper.chooseOne!.findIndex((o) => /Stray/i.test(o.text));
    expect(strayIdx, 'the Stray branch is option index 1 → shaper2').toBe(1);
    expect(ALL_ART, 'shaper2 art is wired').toContain(`${shaper.id}${strayIdx + 1}`);
  });
});

/**
 * PER-BRANCH FRAMING (owner ask 2026-08-28). Framing is per IMAGE, not per card: the base art and a branch's
 * art are different pictures and rarely want the same zoom and offset. Coppercoat Spellsword's second option
 * inherited the base art's crop with no way to dial it.
 */
describe('branch art is framed under its own key', () => {
  it('a resolved branch with its own art keys on the VARIANT, not the card', () => {
    const shaper = CARD_INDEX['shaper']!;
    expect(ALL_ART, 'fixture: the Stray branch art must exist for this to mean anything').toContain('shaper2');
    expect(artVariantKey('shaper', 1), 'option index 1 frames under shaper2').toBe('shaper2');
    expect(artVariantKey('shaper', 0), 'option 0 keeps the base art, so it keeps the base key').toBe('shaper');
    expect(artVariantKey('shaper', undefined), 'an unresolved card is still the base').toBe('shaper');
    expect(shaper.chooseOne, 'fixture sanity').toBeDefined();
  });

  it('a branch with NO art of its own falls back to the card key — nothing changes for those cards', () => {
    // The Godfodder has a Choose One but no second-option illustration.
    expect(ALL_ART, 'fixture: this card must have no branch art').not.toContain('godfodder2');
    expect(artVariantKey('godfodder', 1)).toBe('godfodder');
  });
});
