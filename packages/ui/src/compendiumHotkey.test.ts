// @vitest-environment jsdom
/**
 * R-COMPENDIUM-TAB-01: Tab opens and closes the Compendium on the party home menus (the production UI, so the desktop app)
 * and in a match, one press at a time. Regression: the listener stood down under `html[data-ph-shell]`, so on the exe's
 * main menu Tab did nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installCompendiumHotkey } from './compendiumHotkey';
import { useGame } from './store';

const tab = (): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
};

describe('Tab toggles the Compendium (R-COMPENDIUM-TAB-01)', () => {
  let off: () => void;
  beforeEach(() => {
    off = installCompendiumHotkey();
    useGame.setState({ showBook: false, heroChoices: null, settingsOpen: false });
  });
  afterEach(() => { off(); document.documentElement.removeAttribute('data-ph-shell'); });

  it('opens and closes it on the party home menus', () => {
    document.documentElement.setAttribute('data-ph-shell', '');
    const e = tab();
    expect(useGame.getState().showBook).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    tab();
    expect(useGame.getState().showBook).toBe(false);
  });

  it('opens it over Settings by swapping to the book', () => {
    document.documentElement.setAttribute('data-ph-shell', '');
    useGame.setState({ settingsOpen: true });
    tab();
    expect(useGame.getState().showBook).toBe(true);
    expect(useGame.getState().settingsOpen).toBe(false);
  });

  it('does nothing during hero select', () => {
    useGame.setState({ heroChoices: ['a', 'b'] });
    tab();
    expect(useGame.getState().showBook).toBe(false);
  });

  it('is the only Tab listener for the book: the in-match page has none of its own', () => {
    const page = readFileSync(join(__dirname, 'partyHome', 'pages', 'PhCompendium.tsx'), 'utf8');
    expect(page).not.toMatch(/key === 'Tab'/);
    const game = readFileSync(join(__dirname, 'Game.tsx'), 'utf8');
    expect(game).toMatch(/installCompendiumHotkey\(\)/);
  });
});
