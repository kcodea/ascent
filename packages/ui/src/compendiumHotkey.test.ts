// @vitest-environment jsdom
/**
 * R-COMPENDIUM-TAB-01: C opens and closes the Compendium on the party home menus (the production UI, so the desktop app),
 * in a match and on my own Hero Select, one press at a time (the key was Tab until 2026-11-20). Regression: the listener
 * stood down under `html[data-ph-shell]`, so on the exe's main menu the key did nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMPENDIUM_KEY, installCompendiumHotkey } from './compendiumHotkey';
import { useGame } from './store';
import { useSpectate } from './versus/spectate';
import { setOwnHeroPick } from './hero-select/ownHeroPick';

const press = (init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};
const book = (): boolean => useGame.getState().showBook;

describe('C toggles the Compendium (R-COMPENDIUM-TAB-01)', () => {
  let off: () => void;
  beforeEach(() => {
    off = installCompendiumHotkey();
    useGame.setState({ showBook: false, heroChoices: null, settingsOpen: false });
  });
  afterEach(() => {
    off();
    document.documentElement.removeAttribute('data-ph-shell');
    document.body.innerHTML = '';
    useSpectate.setState({ hero: null, teammateHero: false, active: false });
    setOwnHeroPick(null);
  });

  it('the default key is C', () => { expect(COMPENDIUM_KEY).toBe('c'); });

  it('opens and closes it on the party home menus', () => {
    document.documentElement.setAttribute('data-ph-shell', '');
    const e = press();
    expect(book()).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    press({ key: 'C' }); // Shift or Caps Lock: still C
    expect(book()).toBe(false);
  });

  it('Tab no longer opens it', () => {
    press({ key: 'Tab' });
    expect(book()).toBe(false);
  });

  it('opens it over Settings by swapping to the book', () => {
    useGame.setState({ settingsOpen: true });
    press();
    expect(book()).toBe(true);
    expect(useGame.getState().settingsOpen).toBe(false);
  });

  it('opens it on my own Hero Select, and closes it again', () => {
    useGame.setState({ heroChoices: ['a', 'b'] });
    press();
    expect(book()).toBe(true);
    press();
    expect(book()).toBe(false);
    expect(useGame.getState().heroChoices).toEqual(['a', 'b']);
  });

  it('not once my pick is playing its ceremony', () => {
    useGame.setState({ heroChoices: ['a', 'b'] });
    setOwnHeroPick('a');
    press();
    expect(book()).toBe(false);
  });

  it('not on someone else\'s Hero Select (the stands, a Duos teammate\'s choices); an open book still closes', () => {
    const frame = { offer: ['a', 'b', 'c'], picked: null, reroll: null, canReroll: false, mode: 'versus' as const };
    useSpectate.setState({ hero: frame, active: true });
    press();
    expect(book()).toBe(false);
    useSpectate.setState({ hero: frame, active: false, teammateHero: true });
    useGame.setState({ heroChoices: ['a', 'b'] });
    press();
    expect(book()).toBe(false);
    useGame.setState({ showBook: true });
    press();
    expect(book()).toBe(false);
  });

  it('a letter typed into a field stays text, and Ctrl+C keeps copying', () => {
    for (const make of [() => document.createElement('input'), () => document.createElement('textarea'), () => { const d = document.createElement('div'); d.setAttribute('contenteditable', 'true'); return d; }]) {
      const el = make();
      document.body.appendChild(el);
      const e = press({}, el);
      expect(book()).toBe(false);
      expect(e.defaultPrevented).toBe(false);
    }
    press({ ctrlKey: true });
    press({ metaKey: true });
    expect(book()).toBe(false);
  });

  it('a held key does not flicker the book', () => {
    press();
    for (let i = 0; i < 4; i++) press({ repeat: true });
    expect(book()).toBe(true);
  });

  it('is the only key listener for the book: the in-match page has none of its own', () => {
    const page = readFileSync(join(__dirname, 'partyHome', 'pages', 'PhCompendium.tsx'), 'utf8');
    expect(page).not.toMatch(/key === '(Tab|c|C)'/);
    const game = readFileSync(join(__dirname, 'Game.tsx'), 'utf8');
    expect(game).toMatch(/installCompendiumHotkey\(\)/);
  });
});
