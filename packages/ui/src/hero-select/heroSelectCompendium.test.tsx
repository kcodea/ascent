// @vitest-environment jsdom
/**
 * VIEW COMPENDIUM FROM HERO SELECT (owner ask 2026-11-20): a small button under the heroes opens the Compendium through the
 * store's own `toggleBook` (the corner button's and Tab's path), over the picker, and closing it leaves the offer as it was.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { HeroSelect } from '../HeroSelect';
import { useGame } from '../store';
import { setPartyHome } from '../partyHome/partyHomeFlag';
import { setHeroShowcase } from './heroShowcaseFlag';

let ui: Mounted | null = null;
afterEach(() => {
  ui?.unmount(); ui = null;
  act(() => { setPartyHome(false); setHeroShowcase(true); useGame.setState({ showBook: false, settingsOpen: false }); });
});

const OFFER = ['aster', 'warden', 'soren'];
const open = (opts: { ph: boolean; showcase: boolean; mode?: 'ascent' | 'lobby' | 'practice' }): HTMLElement => {
  act(() => {
    setPartyHome(opts.ph); setHeroShowcase(opts.showcase);
    useGame.setState({ pendingMode: opts.mode ?? 'ascent', heroChoices: [...OFFER], heroReroll: null, rankedEntry: null, showBook: false });
  });
  ui = mount(<HeroSelect />);
  return ui.container;
};
const button = (el: HTMLElement): HTMLButtonElement | null => el.querySelector<HTMLButtonElement>('.hsbook');

describe('View Compendium on hero select', () => {
  for (const variant of [{ ph: false, showcase: false }, { ph: true, showcase: false }, { ph: true, showcase: true }]) {
    it(`shows under the heroes and opens the book (party home ${variant.ph}, showcase ${variant.showcase})`, () => {
      const el = open(variant);
      const btn = button(el)!;
      expect(btn).not.toBeNull();
      expect(btn.textContent).toBe('View Compendium');
      expect(btn.getAttribute('title')).toBeNull();
      expect(btn.closest('.hsbox')).not.toBeNull(); // in the centred group, under the heroes
      act(() => { btn.click(); });
      expect(useGame.getState().showBook).toBe(true);
      expect(useGame.getState().bookOpensTo).toBe('cards');
      // The pick is untouched: the same offer, the picker still up.
      expect(useGame.getState().heroChoices).toEqual(OFFER);
      expect(el.querySelector('.heroselect')).not.toBeNull();
      // Closing it lands back on hero select.
      act(() => { useGame.getState().closeBook(); });
      expect(useGame.getState().heroChoices).toEqual(OFFER);
      expect(button(el)).not.toBeNull();
    });
  }

  it('a second press never closes the book it opened, and Settings gives way to it', () => {
    const el = open({ ph: false, showcase: false, mode: 'lobby' });
    act(() => { useGame.setState({ settingsOpen: true }); });
    act(() => { button(el)!.click(); });
    expect(useGame.getState().settingsOpen).toBe(false);
    expect(useGame.getState().showBook).toBe(true);
    act(() => { button(el)!.click(); });
    expect(useGame.getState().showBook).toBe(true);
  });

  it('a watched Hero Select has no button', () => {
    act(() => { setPartyHome(false); useGame.setState({ heroChoices: null }); });
    ui = mount(<HeroSelect watch={{ frame: { offer: OFFER, mode: 'versus', reroll: null, picked: null, canReroll: false }, fx: false, clock: 'none' }} />);
    expect(button(ui.container)).toBeNull();
  });
});
