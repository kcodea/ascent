import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type RunState } from './index';
import { runSpells } from './spellPool';
import { rollShop, rollSpellShop } from './shop';

/** TRIBE-GATED SPELLS (owner 2026-09-10): a spell with a tribe is offered only when that tribe is a run tribe. */
const set3 = (tribes: RunState['tribes'], seed = 3): RunState => ({ ...createRun(seed), setId: 'set3', tier: 6, tribes, shop: [], spell: null } as RunState);

describe('runSpells — the one tribe-gated spell pool', () => {
  it('a Kobold spell is absent without Kobolds and present with them; neutral spells are always there', () => {
    const without = runSpells(set3(['dwarf', 'undead', 'spirit']));
    const withK = runSpells(set3(['kobold', 'undead', 'spirit']));
    for (const id of ['rubyshipment', 'facetwright', 'veinstorm', 'rubytransfer']) {
      expect(without.some((c) => c.id === id), `${id} leaked into a Kobold-less run`).toBe(false);
      expect(withK.some((c) => c.id === id), `${id} missing with Kobolds active`).toBe(true);
    }
    expect(without.some((c) => c.id === 'onthehouse'), 'On the House needs Dwarves').toBe(true);
    expect(withK.some((c) => c.id === 'onthehouse')).toBe(false);
    expect(without.some((c) => c.id === 'lanternofsouls') && withK.some((c) => c.id === 'lanternofsouls'), 'Undead spells follow Undead').toBe(true);
    expect(runSpells(set3(['dwarf', 'kobold', 'spirit'])).some((c) => c.id === 'undeadarmy')).toBe(false);
    for (const id of ['growth', 'apples', 'wo_mine', 'sparkplug']) expect(without.some((c) => c.id === id) && withK.some((c) => c.id === id), id).toBe(true);
  });

  it('the shop roll and the Spell Cart never offer a gated spell to a run without its tribe (400 seeds)', () => {
    const gated = new Set(['rubyshipment', 'facetwright', 'veinstorm', 'rubytransfer', 'undeadarmy', 'lanternofsouls']);
    let offered = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s = set3(['dwarf', 'spirit', 'celestial'], seed);
      rollShop(s);
      if (s.spell && gated.has(s.spell.cardId)) offered += 1;
      const cart = set3(['dwarf', 'spirit', 'celestial'], seed);
      rollSpellShop(cart);
      for (const o of cart.shop) if (gated.has(o.cardId)) offered += 1;
    }
    expect(offered).toBe(0);
  });

  it('every gated spell on the sheet carries its tribe in data', () => {
    expect(['rubyshipment', 'facetwright', 'veinstorm', 'rubytransfer'].map((id) => CARD_INDEX[id]!.tribe)).toEqual(['kobold', 'kobold', 'kobold', 'kobold']);
    expect(CARD_INDEX['onthehouse']!.tribe).toBe('dwarf');
    expect([CARD_INDEX['lanternofsouls']!.tribe, CARD_INDEX['undeadarmy']!.tribe]).toEqual(['undead', 'undead']);
  });
});
