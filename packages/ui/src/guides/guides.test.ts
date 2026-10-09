/**
 * LOBBY RAIL GUIDES are data (guides.ts). Pins: every card id a guide names resolves to a real card IN THE GUIDE'S
 * SET, every tribe it names belongs to that set, and the visibility rule (own set only, tribes in the lobby only,
 * neutral always).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { artFor } from '../art';
import { GUIDES, PLACEHOLDER_BODY, guidesFor } from './guides';

describe('lobby rail guides', () => {
  it('has unique ids and at least one core unit per guide', () => {
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
    for (const g of GUIDES) expect(g.core.length, g.id).toBeGreaterThan(0);
  });

  it('every card id resolves to a card in the guide\'s own set', () => {
    for (const g of GUIDES) {
      const pool = poolFor(g.set);
      const inSet = new Set([...pool.buyable, ...pool.spells].map((c) => c.id));
      for (const id of [...g.core, ...g.enablers, ...(g.mentions ?? [])]) {
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

  it('the owner-written guides keep the owner\'s cards and titles (2026-10-09)', () => {
    const names = (id: string, k: 'core' | 'enablers'): string[] => GUIDES.find((g) => g.id === id)![k].map((c) => CARD_INDEX[c]!.name);
    const title = (id: string): string => GUIDES.find((g) => g.id === id)!.title;
    expect(title('set2-beast-sunmane')).toBe('Sunmane');
    expect(names('set2-beast-sunmane', 'core')).toEqual(['Sunmane', 'Solaris']);
    expect(names('set2-beast-sunmane', 'enablers')).toEqual(['Sunmane']);
    expect(names('set2-beast-oona', 'core')).toEqual(['King Oona', 'Grim', 'Vicious']);
    expect(names('set2-beast-oona', 'enablers')).toEqual(['Armadiyo', 'Bullseye', 'Beardsley']);
    expect(title('set2-dragon-breath')).toBe('Dragonflame');
    expect(names('set2-dragon-breath', 'core')).toEqual(['Captain Flamus', 'Transcendant']);
    expect(names('set2-dragon-breath', 'enablers')).toEqual(['Fel Conjurer', 'Flamebeat Drake', 'Chorus Drake']);
    expect(title('set2-dragon-shout')).toBe('Shout Dragons');
    expect(names('set2-dragon-shout', 'core')).toEqual(['Karwind', 'Drakko', 'Voicekeeper']);
    expect(names('set2-dragon-shout', 'enablers')).toEqual(['Karwind', 'Roarcollector']);
    const pins: [string, string, string[], string[]][] = [
      ['set2-kobold-combat', 'Combat Rubies', ['Delvey', 'Crownvein'], ['Kobebes', 'Boulderdash', 'Mineral Master']],
      ['set2-kobold-mountainbond', 'APM Mountainbond', ['Mountainbond', 'Tapkeeper', 'Edward Keg-hands'], ['Drakko', 'Brunni', 'Crownvein']],
      ['set2-dwarf-spend', 'APM Spend', ['Billings', 'Drakko', 'Chef Gary Toast'], ['Gangplank', 'Coinfire', 'Kringle']],
      ['set2-demon-consume', 'Consume', ['Chipper', 'Grevlin & Co.', 'Soul Defiler'], ['Bob Blart', 'Demon Horse', 'Big Huggies']],
      ['set2-demon-imps', 'Imps', ['Impossible Todd', 'Fel Spikes', 'Sylus'], ['Brood Matron', 'Legion Shepherd']],
      ['set2-neutral-paragon', 'Paragon Rally', ['Paragon', 'Lieutenant Thane'], ['Standard Bearer', 'Raven', 'Blazer']],
    ];
    for (const [id, t, core, enablers] of pins) {
      expect(title(id), id).toBe(t);
      expect(names(id, 'core'), id).toEqual(core);
      expect(names(id, 'enablers'), id).toEqual(enablers);
    }
    // Every Set 2 guide is written now: no placeholder left.
    for (const g of GUIDES.filter((x) => x.set === 'set2')) expect(g.body, g.id).not.toBe(PLACEHOLDER_BODY);
    for (const g of GUIDES) expect(g.body, g.id).not.toMatch(/—|--/); // no em dashes in player text
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
