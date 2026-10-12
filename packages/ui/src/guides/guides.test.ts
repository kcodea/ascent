/**
 * LOBBY RAIL GUIDES are data (guides.ts, guides.bundled.ts). Guides are edited live now, and the built-in file is
 * regenerated from them by `npm run guides:pull`, so this file pins only the STRUCTURE: every card id a guide names
 * resolves to a real card IN THE GUIDE'S SET, every tribe it names belongs to that set, the icon has art, no
 * placeholder or em dash is left in player text, and the visibility rule (own set only, tribes in the lobby only,
 * neutral always). It never pins a particular title or card list.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { artFor } from '../art';
import { GUIDES, PLACEHOLDER_BODY, guidesFor } from './guides';
import { BUNDLED_GUIDE_DATA } from './guides.bundled';

describe('lobby rail guides', () => {
  it('has unique ids and at least one core unit per guide', () => {
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
    for (const g of GUIDES) expect(g.core.length, g.id).toBeGreaterThan(0);
  });

  it('every card id resolves to a card in the guide\'s own set', () => {
    for (const g of BUNDLED_GUIDE_DATA) {
      const pool = poolFor(g.set);
      const inSet = new Set([...pool.buyable, ...pool.spells].map((c) => c.id));
      for (const id of [...g.core, ...g.enablers, ...(g.mentions ?? [])]) {
        expect(CARD_INDEX[id], `${g.id}: unknown card id "${id}"`).toBeDefined();
        expect(inSet.has(id), `${g.id}: "${id}" is not in ${g.set}`).toBe(true);
      }
    }
  });

  it("every guide's icon card resolves and has art", () => {
    for (const g of GUIDES) {
      expect(CARD_INDEX[g.iconCard], `${g.id}: unknown icon card "${g.iconCard}"`).toBeDefined();
      expect(artFor(g.iconCard), `${g.id}: no art for "${g.iconCard}"`).toBeTruthy();
    }
  });

  it('every tribe a guide names is one of its set\'s tribes', () => {
    for (const g of BUNDLED_GUIDE_DATA) {
      for (const t of [...g.tribes, ...(g.pairsWith ?? [])]) expect(SETS[g.set].tribes, `${g.id}: ${t}`).toContain(t);
    }
  });

  it('every alias names a card the guide lists, and every mention is named in the body', () => {
    for (const g of GUIDES) {
      const listed = new Set([...g.core, ...g.enablers, ...(g.mentions ?? [])]);
      for (const [word, id] of Object.entries(g.aliases ?? {})) {
        expect(listed.has(id), `${g.id}: alias "${word}" -> ${id}`).toBe(true);
        expect(g.body.toLowerCase(), `${g.id}: alias "${word}"`).toContain(word.toLowerCase());
      }
      for (const id of g.mentions ?? []) expect(g.body, `${g.id}: mention ${id}`).toContain(CARD_INDEX[id]!.name);
    }
  });

  it('no set 2 guide is a placeholder, and no player text holds an em dash', () => {
    for (const g of BUNDLED_GUIDE_DATA.filter((x) => x.set === 'set2')) expect(g.body, g.id).not.toBe(PLACEHOLDER_BODY);
    for (const g of GUIDES) expect(g.body, g.id).not.toMatch(/\u2014|--/); // no em dashes in player text
  });

  it('shows only this set\'s guides, for tribes in the lobby, plus neutral', () => {
    const ids = guidesFor('set2', ['kobold', 'beast']).map((g) => g.id);
    expect(ids).toEqual(['set2-beast-sunmane', 'set2-beast-oona', 'set2-kobold-combat', 'set2-kobold-mountainbond', 'set2-neutral-paragon']);
    expect(guidesFor('set1', ['beast', 'dragon'])).toEqual([]);
    // A Dwarf crossover never makes a Kobold line show on its own.
    expect(guidesFor('set2', ['dwarf']).map((g) => g.id)).toEqual(['set2-dwarf-ale', 'set2-dwarf-spend', 'set2-neutral-paragon']);
  });

  it('is one card per build line: eleven Set 2 lines, every tribe of the set covered', () => {
    expect(BUNDLED_GUIDE_DATA.filter((g) => g.set === 'set2')).toHaveLength(11);
    for (const t of SETS.set2.tribes) expect(GUIDES.filter((g) => g.tribes.includes(t)).length, t).toBe(2);
  });
});
