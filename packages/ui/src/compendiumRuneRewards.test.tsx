// @vitest-environment jsdom
/**
 * The Compendium's RUNE REWARDS are scoped to the SHOWN set, and search finds them by tribe (owner report
 * 2026-10-26: "searching mech returns this minion, which isnt even possible in set 2 - but the other mechs from
 * rune rewards don't show up. like clockwork assistant and wanderer").
 *
 * Reconfigurator is Rune of Reconfiguration's reward, a `sets: ['set1']` rune, so a Set-2 book must not list it.
 * Clockwork Assistant (Clockwork Promotion) and Ancient Wanderer (Ancient Expenditure) are rewards of runes in
 * Set 2; their text never says "Mech", so a "mech" search must match their tribe.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { CARD_INDEX, EPIC_RUNES, RUNES, SETS, type SetId } from '@game/content';
import { MinionBook } from './MinionBook';
import { questRewardCardsFor, runeRewardCardsFor } from './compendiumRewards';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

const ids = (setId: SetId): string[] => runeRewardCardsFor(setId).map((c) => c.id);

describe('runeRewardCardsFor: only what the set\'s runes can hand you', () => {
  it('Set 2 lists Clockwork Assistant and Ancient Wanderer, and not Reconfigurator', () => {
    expect(ids('set2')).toEqual(expect.arrayContaining(['n2_clockwork', 'n2_wanderer']));
    expect(ids('set2')).not.toContain('reconfiguredcombinator');
    expect(ids('set2')).not.toContain('feastingbogrot'); // Feast is Set-1 only too
  });

  it('Set 1 (where Rune of Reconfiguration lives) does list Reconfigurator', () => {
    expect(ids('set1')).toContain('reconfiguredcombinator');
  });

  it('every listed card is the named grant of a rune offered in that set, in every set', () => {
    for (const setId of Object.keys(SETS) as SetId[]) {
      const runes = [...RUNES, ...EPIC_RUNES].filter((r) => !r.sets || r.sets.includes(setId));
      const blob = JSON.stringify(runes.map((r) => r.reward));
      for (const id of ids(setId)) expect(blob.includes(`"${id}"`), `${setId}: ${id}`).toBe(true);
    }
  });

  it('quest rewards are set-scoped the same way (a Set-1 quest token never reaches Set 2)', () => {
    const set2 = questRewardCardsFor('set2').map((x) => x.card.id);
    expect(set2).not.toContain('hoardwhelp'); // Coin Hoard is `sets: ['set1']`
  });
});

describe('Compendium Rune Rewards section', () => {
  let m: Mounted;
  let prev: { showTitle: boolean };
  const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
  const names = (): string[] => [...m.container.querySelectorAll('.book-grid .book-cell .cn')].map((n) => n.textContent ?? '');
  const pickSet = (id: SetId): void => {
    click(m.container.querySelector('.book-setpick-btn'));
    click([...m.container.querySelectorAll('.book-setpick-opt')].find((o) => o.textContent?.startsWith(SETS[id].name)));
  };
  const search = (q: string): void => {
    act(() => {
      const input = m.container.querySelector('input.book-search') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, q);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const nameOf = (id: string): string => CARD_INDEX[id]!.name;

  beforeEach(() => {
    prev = { showTitle: useGame.getState().showTitle };
    useGame.setState({ showTitle: true });
    m = mount(<MinionBook />);
    click(m.container.querySelector('.book-rail .book-cat[aria-label="Rune Rewards"]'));
  });
  afterEach(() => {
    m.unmount();
    useGame.setState(prev);
  });

  it('Set 2: lists exactly the set\'s rune rewards (Clockwork Assistant, Ancient Wanderer; no Reconfigurator)', () => {
    pickSet('set2');
    const shown = names();
    expect([...shown].sort()).toEqual(runeRewardCardsFor('set2').map((c) => c.name).sort());
    expect(shown).toContain(nameOf('n2_clockwork'));
    expect(shown).toContain(nameOf('n2_wanderer'));
    expect(shown).not.toContain(nameOf('reconfiguredcombinator'));
  });

  it('Set 2: searching "mech" returns the Set 2 Mech rune rewards and nothing from another set', () => {
    pickSet('set2');
    search('mech');
    const shown = names();
    const mechs = runeRewardCardsFor('set2').filter((c) => c.tribe === 'mech' || c.tribe2 === 'mech').map((c) => c.name);
    expect(mechs).toEqual(expect.arrayContaining([nameOf('n2_clockwork'), nameOf('n2_wanderer')]));
    for (const n of mechs) expect(shown, n).toContain(n);
    expect(shown).not.toContain(nameOf('reconfiguredcombinator'));
  });

  it('Set 1: its own rune rewards, Reconfigurator included', () => {
    pickSet('set1');
    expect([...names()].sort()).toEqual(runeRewardCardsFor('set1').map((c) => c.name).sort());
    expect(names()).toContain(nameOf('reconfiguredcombinator'));
  });
});
