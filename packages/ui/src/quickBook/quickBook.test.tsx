// @vitest-environment jsdom
/** THE QUICK COMPENDIUM (R-COMPENDIUM-QUICK-01). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import type { CardDef, Tribe } from '@game/core';
import { poolFor, type SetId } from '@game/content';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import { MinionBook } from '../MinionBook';
import { setPartyHome } from '../partyHome/partyHomeFlag';
import { matchesTab, quickTabs, runeFits, runeOnPage } from './quickBookModel';

const TRIBES: Tribe[] = ['beast', 'dragon', 'kobold', 'dwarf', 'demon'];
let ui: Mounted | null = null;
const initial = useGame.getState();
beforeEach(() => { act(() => { setPartyHome(true); }); });
afterEach(() => {
  ui?.unmount(); ui = null;
  act(() => { setPartyHome(false); useGame.setState(initial, true); });
});
const open = async (setId: SetId = 'set2'): Promise<HTMLElement> => {
  act(() => {
    useGame.setState({ showTitle: false, heroChoices: null, run: { ...useGame.getState().run, mode: 'lobby', setId, tribes: TRIBES } as never });
    useGame.getState().openBookTribe('beast', setId);
  });
  ui = mount(<MinionBook />);
  for (let i = 0; i < 300 && !ui.container.querySelector('.qb'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return ui.container;
};
const press = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };
const title = (el: HTMLElement): string | null | undefined => el.querySelector('.qb-title h2')?.textContent;

describe('the model', () => {
  it('tabs: the tribes of the game as the place hangs them, then Neutral, Spells and Runes', () => {
    expect(quickTabs(['beast', 'dragon', 'murloc' as Tribe], ['dragon', 'undead', 'beast']).map((t) => [t.id, t.sheet])).toEqual([
      ['dragon', true], ['beast', true], ['murloc', false], ['neutral', false], ['spells', false], ['runes', false],
    ]);
    expect(quickTabs(['beast'], null)[0]).toEqual({ id: 'beast', sheet: false });
  });
  it('a dual minion is on both its pages', () => {
    expect(matchesTab({ tribe: 'beast', tribe2: 'demon' } as CardDef, 'demon')).toBe(true);
    expect(matchesTab({ tribe: 'beast' } as CardDef, 'demon')).toBe(false);
  });
  it('runes: only what this game can offer, and the page filter', () => {
    const g = { setId: 'set2', duos: false, tribes: TRIBES };
    expect(runeFits({}, g)).toBe(true);
    expect(runeFits({ sets: ['set3'] }, g)).toBe(false);
    expect(runeFits({ duos: true }, g)).toBe(false);
    expect(runeFits({ tribes: ['undead'] }, g)).toBe(false);
    expect(runeFits({ tribes: ['undead', 'beast'] }, g)).toBe(true);
    expect(runeOnPage({ tribes: ['beast'] }, 'neutral')).toBe(false);
    expect(runeOnPage({}, 'neutral')).toBe(true);
    expect(runeOnPage({ tribes: ['beast'] }, 'beast')).toBe(true);
  });
});

describe('the overlay', () => {
  it('opens on the tribe of the scroll that was pressed, with its whole page counted', async () => {
    const el = await open();
    expect(title(el)).toBe('Beasts');
    const want = poolFor('set2').buyable.filter((c) => matchesTab(c, 'beast')).length;
    expect(Number(el.querySelector('.qb-count')?.textContent)).toBeGreaterThanOrEqual(want > 0 ? 1 : 0);
    expect(el.querySelectorAll('.qb-rail .hs-poster')).toHaveLength(5);
    expect(el.querySelector('.qb-rail .hs-poster.on')?.textContent).toBe('Beasts');
    expect(document.documentElement.hasAttribute('data-qb')).toBe(true);
    expect(el.querySelector('[title]')).toBeNull(); // R: no native tooltips
  });
  it('another scroll switches, the same one closes, and the hover layer comes off with it', async () => {
    const el = await open();
    const demons = [...el.querySelectorAll('.qb-rail .hs-poster')].find((b) => b.textContent === 'Demons')!;
    press(demons);
    expect(title(el)).toBe('Demons');
    press(el.querySelector('.qb-rail .hs-poster.on'));
    expect(useGame.getState().showBook).toBe(false);
    ui!.unmount(); // Game mounts the book only while it is open
    ui = null;
    expect(document.documentElement.hasAttribute('data-qb')).toBe(false);
  });
  it('a press outside closes', async () => {
    const el = await open();
    press(el.querySelector('.qb-dim'));
    expect(useGame.getState().showBook).toBe(false);
  });
  it('tiers narrow the page; Runes opens on the Basic ones', async () => {
    const el = await open();
    const all = Number(el.querySelector('.qb-count')?.textContent);
    press(el.querySelector('.qb-tier'));
    expect(Number(el.querySelector('.qb-count')?.textContent)).toBeLessThan(all);
    press([...el.querySelectorAll('.qb-tab')].find((b) => b.textContent === 'Runes')!);
    expect(title(el)).toBe('Runes');
    expect(el.querySelector('.qb-pill.on')?.textContent).toBe('Basic');
  });
  it('the arrows walk the scrolls', async () => {
    const el = await open();
    const order = [...el.querySelectorAll('.qb-rail .hs-poster')].map((b) => b.textContent);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); });
    expect(title(el)).toBe(order[order.indexOf('Beasts') + 1]);
  });
  it('Full Compendium is one press away, and the next opening is the quick one again', async () => {
    const el = await open();
    press(el.querySelector('.qb-full'));
    expect(useGame.getState().bookFull).toBe(true);
    expect(el.querySelector('.qb')).toBeNull();
    act(() => { useGame.getState().closeBook(); });
    expect(useGame.getState().bookFull).toBe(false);
  });
});
