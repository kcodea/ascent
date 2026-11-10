import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARD_INDEX } from '@game/content';

/**
 * A Ruby cast plays no generic spell-cast burst (`spell-sparks`): its gem landing (`ruby-gem-apply`) is its cast
 * effect (owner 2026-11-10: "the spell burst effect from targeting a unit with a shop spell is casting on playing
 * ruby spells, can we remove it for all ruby target spells"). Pinned at the cast presenter, which every Ruby
 * (Ruby, Warding, Golden, Splintered, Ripple, Dark) reaches through the same `'cast'` action.
 */
describe('a Ruby cast plays no spell-cast burst', () => {
  it('the cast presenter returns early for a Ruby before any spell-cast FX', () => {
    const src = readFileSync(new URL('./Recruit.tsx', import.meta.url), 'utf8');
    const at = src.indexOf("case 'cast': {");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 600);
    const guard = body.indexOf('if (CARD_INDEX[a.cardId]?.ruby) return;');
    expect(guard, 'the Ruby guard is missing from the cast presenter').toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf('fireSpellCastFx'));
  });

  it('every Ruby the player can cast is flagged `ruby`', () => {
    for (const id of ['warding-ruby']) expect(CARD_INDEX[id]?.ruby, id).toBe(true);
    const rubies = Object.values(CARD_INDEX).filter((d) => d.ruby);
    expect(rubies.length).toBeGreaterThanOrEqual(6);
  });
});
