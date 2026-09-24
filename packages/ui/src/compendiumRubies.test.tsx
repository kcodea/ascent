// @vitest-environment jsdom
/**
 * The Compendium's Spells section lists the RUBIES (owner ask 2026-09-24: "the ruby types should show in the
 * spells section of the compendium as well").
 *
 * The rule: every `ruby: true` card, in every set whose pool can make a Ruby. Rubies are tokens, and they are the
 * ONLY tokens brought back: Ruby Blast (Blast Pump's hidden cast) and every other token stay out.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { RUBY_TYPE_IDS } from '@game/core';
import { CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';
import { createRun } from '@game/sim';
import { MinionBook, rubyCardsFor, toView } from './MinionBook';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

const RUBY_NAMES = RUBY_TYPE_IDS.map((id) => CARD_INDEX[id]!.name).sort();

describe('rubyCardsFor: which sets list Rubies', () => {
  it('Set 2 and Set 3 (both mint Rubies) list all six Ruby types; Set 1 lists none', () => {
    expect(rubyCardsFor(poolFor('set2').all).map((c) => c.id).sort()).toEqual([...RUBY_TYPE_IDS].sort());
    expect(rubyCardsFor(poolFor('set3').all).map((c) => c.id).sort()).toEqual([...RUBY_TYPE_IDS].sort());
    expect(rubyCardsFor(poolFor('set1').all)).toEqual([]);
  });

  it('never lists Ruby Blast or any other non-Ruby token', () => {
    for (const id of Object.keys(SETS) as SetId[]) {
      for (const c of rubyCardsFor(poolFor(id).all)) expect(c.ruby, c.id).toBe(true);
    }
    expect(CARD_INDEX['rubyblast']?.ruby).toBeFalsy();
  });
});

describe('Compendium Spells section', () => {
  let m: Mounted;
  let prev: { showTitle: boolean };
  const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
  const names = (): string[] => [...m.container.querySelectorAll('.book-grid .book-cell .cn')].map((n) => n.textContent ?? '');
  const pickSet = (id: SetId): void => {
    click(m.container.querySelector('.book-setpick-btn'));
    click([...m.container.querySelectorAll('.book-setpick-opt')].find((o) => o.textContent?.startsWith(SETS[id].name)));
  };

  beforeEach(() => {
    prev = { showTitle: useGame.getState().showTitle };
    useGame.setState({ showTitle: true });
    m = mount(<MinionBook />);
    click(m.container.querySelector('.book-rail .book-cat[aria-label="Spells"]'));
  });
  afterEach(() => {
    m.unmount();
    useGame.setState(prev);
  });

  for (const id of ['set2', 'set3'] as SetId[]) {
    it(`${id}: lists every Ruby, and no token that is not a Ruby`, () => {
      pickSet(id);
      const shown = names();
      for (const n of RUBY_NAMES) expect(shown, n).toContain(n);
      expect(shown).not.toContain('Ruby Blast');
      // Everything else in the section is a drawable tavern spell of this set.
      const spellNames = new Set(poolFor(id).spells.map((c) => c.name));
      for (const n of shown) expect(spellNames.has(n) || RUBY_NAMES.includes(n), n).toBe(true);
    });
  }

  it('set1: no Rubies', () => {
    pickSet('set1');
    for (const n of RUBY_NAMES) expect(names()).not.toContain(n);
  });

  it('the tier filter and search narrow Rubies like any spell (they are Tier 1)', () => {
    pickSet('set2');
    click(m.container.querySelector('.book-tiers button[aria-label="Tier 1"]'));
    expect(names()).toEqual(expect.arrayContaining(RUBY_NAMES));
    act(() => {
      const input = m.container.querySelector('input.book-search') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Ripple');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(names()).toContain('Ripple Ruby');
    expect(names()).not.toContain('Dark Ruby');
  });
});

describe('Ruby view in the Compendium', () => {
  it('renders as a Ruby, never Gilded, printed off-run', () => {
    const v = toView(CARD_INDEX['golden-ruby']!, true);
    expect(v.ruby).toBe(true);
    expect(v.golden).toBe(false);
    expect(v.text).toBe(CARD_INDEX['golden-ruby']!.text);
  });

  it('in a run, prints the live grant it would mint at (base + the run Ruby strength)', () => {
    const run = { ...createRun(1, undefined, undefined, undefined, 'set2'), rubyBonus: { attack: 2, health: 1 } };
    const v = toView(CARD_INDEX['dark-ruby']!, false, run);
    expect(v.text).toBe(CARD_INDEX['dark-ruby']!.text.replace('**+1/+1**', '**{{+3/+2}}**'));
    expect([v.attack, v.health]).toEqual([3, 2]);
  });
});
