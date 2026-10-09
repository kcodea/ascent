/**
 * LOBBY RAIL GUIDES are data (guides.ts). Pins: every card id a guide names resolves to a real card IN THE GUIDE'S
 * SET, every tribe it names belongs to that set, and the visibility rule (own set only, tribes in the lobby only,
 * neutral always).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { artFor } from '../art';
import { GUIDES, guidesFor } from './guides';

describe('lobby rail guides', () => {
  it('has unique ids and at least one core unit per guide', () => {
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
    for (const g of GUIDES) expect(g.core.length, g.id).toBeGreaterThan(0);
  });

  it('every card id resolves to a card in the guide\'s own set', () => {
    for (const g of GUIDES) {
      const pool = poolFor(g.set);
      const inSet = new Set([...pool.buyable, ...pool.spells].map((c) => c.id));
      for (const id of [...g.core, ...g.enablers]) {
        expect(CARD_INDEX[id], `${g.id}: unknown card id "${id}"`).toBeDefined();
        expect(inSet.has(id), `${g.id}: "${id}" is not in ${g.set}`).toBe(true);
      }
    }
  });

  it("every guide's icon card resolves and has art (the Ale line wears Golden Ale)", () => {
    for (const g of GUIDES) {
      expect(CARD_INDEX[g.iconCard], `${g.id}: unknown icon card "${g.iconCard}"`).toBeDefined();
      expect(artFor(g.iconCard), `${g.id}: no art for "${g.iconCard}"`).toBeTruthy();
    }
    expect(CARD_INDEX[GUIDES.find((g) => g.id === 'set2-dwarf-ale')!.iconCard]!.name).toBe('Golden Ale');
  });

  it('every tribe a guide names is one of its set\'s tribes', () => {
    for (const g of GUIDES) {
      for (const t of [...g.tribes, ...(g.pairsWith ?? [])]) expect(SETS[g.set].tribes, `${g.id}: ${t}`).toContain(t);
    }
  });

  it('names builds without the word "line" (owner 2026-10-09)', () => {
    for (const g of GUIDES) expect(g.title, g.id).not.toMatch(/line/i);
    expect(GUIDES.find((g) => g.id === 'set2-dwarf-ale')!.title).toBe('Ale');
  });

  it('the Dwarves Ale line keeps the owner\'s cards', () => {
    const ale = GUIDES.find((g) => g.id === 'set2-dwarf-ale')!;
    expect(ale.core.map((id) => CARD_INDEX[id]!.name)).toEqual(['Edward Keg-hands', 'Tapkeeper']);
    expect(ale.enablers.map((id) => CARD_INDEX[id]!.name)).toEqual(['Drakko', 'Brunni', 'Blade Thrower']);
  });

  it('shows only this set\'s guides, for tribes in the lobby, plus neutral', () => {
    const ids = guidesFor('set2', ['kobold', 'beast']).map((g) => g.id);
    expect(ids).toEqual(['set2-beast-sunmane', 'set2-beast-oona', 'set2-kobold-combat', 'set2-kobold-mountainbond', 'set2-neutral-paragon']);
    expect(guidesFor('set1', ['beast', 'dragon'])).toEqual([]);
    // A Dwarf crossover never makes a Kobold line show on its own.
    expect(guidesFor('set2', ['dwarf']).map((g) => g.id)).toEqual(['set2-dwarf-ale', 'set2-dwarf-spend', 'set2-neutral-paragon']);
  });

  it('is one card per build line: eleven Set 2 lines, every tribe of the set covered', () => {
    expect(GUIDES.filter((g) => g.set === 'set2')).toHaveLength(11);
    for (const t of SETS.set2.tribes) expect(GUIDES.filter((g) => g.tribes.includes(t)).length, t).toBe(2);
  });
});
