// @vitest-environment jsdom
/**
 * THE PORTRAIT WINDOW (2026-11-19 rebuild, owner: "this portrait select menu is so extremely outdated ... propose a
 * change" then "add a section that allows players to also select any hero or minion cosmetic they've unlocked"):
 *  - a press on a tile SELECTS and previews; only "Use portrait" (or a double press) saves and closes;
 *  - My Skins lists exactly the hero / minion skins the account OWNS, saved as `skin:<art key>`, and every viewer's
 *    `avatarSrc` resolves that id; with none owned the tab says so and points at the Collection;
 *  - search filters by name and the tab counts follow it;
 *  - "Reset to default" selects the default; Esc closes without saving.
 * No native tooltips, no em dashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProgressionProfile } from '@game/progression';
import { mount, type Mounted } from './renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./remoteBoards', async (orig) => ({ ...(await orig<typeof import('./remoteBoards')>()), pushProfileAvatar: async () => undefined }));

import { AvatarPicker } from './AvatarPicker';
import { avatarSrc, skinArt } from './art';
import { resetProgressionForTests, useProgression } from './progression/progressionStore';
import { useGame } from './store';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; resetProgressionForTests(); });
beforeEach(() => {
  resetProgressionForTests();
  localStorage.clear();
  useGame.setState({
    account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null },
    showTitle: true, showCollection: false, avatarPickerOpen: true, playerAvatar: null, playerName: 'Kevin',
  });
});

const base: ProgressionProfile = { accountXp: 0, accountLevel: 1, revision: 1, equippedTitleId: null, titles: [], cosmetics: ['skin_blackbelt_1', 'skin_albus_1'], loadout: {} };
function open(over: Partial<ProgressionProfile> = {}): void {
  useProgression.setState({ capability: 'on', mirror: { userId: 'u-1', ...base, ...over } });
  ui = mount(<AvatarPicker />);
}
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const tab = (label: string): HTMLElement => $$('[role="tab"]').find((t) => t.querySelector('.avp-tabname')!.textContent === label)!;
const countOf = (label: string): string => tab(label).querySelector('.avp-n')!.textContent!;
const type = (text: string): void => {
  const input = $('.avp-search') as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { set.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
};

describe('the portrait window', () => {
  it('a press selects and previews; nothing is saved until Use portrait', () => {
    open();
    act(() => tab('Heroes').click());
    const tile = $('.avp-tile')!;
    act(() => tile.click());
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    expect($('.avp-name')!.textContent).toBe(tile.dataset.name);
    expect(useGame.getState().playerAvatar).toBeNull();
    expect(useGame.getState().avatarPickerOpen).toBe(true);
    act(() => $('.avp-use')!.click());
    expect(useGame.getState().playerAvatar).toMatch(/^hero:/);
    expect(useGame.getState().avatarPickerOpen).toBe(false);
  });

  it('My Skins lists exactly the owned hero and minion skins, and a skin saves as skin:<art key> that every viewer resolves', () => {
    open();
    expect(tab('My Skins').getAttribute('aria-selected')).toBe('true');
    expect($$('.avp-grouplbl').map((g) => g.textContent)).toEqual(['Hero skins', 'Minion skins']);
    expect($$('.avp-tile')).toHaveLength(2);
    expect(countOf('My Skins')).toBe('2');
    const brian = $$('.avp-tile').find((t) => t.dataset.name === 'Sheriff Brian')!;
    expect(brian.querySelector('.colls-gem')).not.toBeNull();
    act(() => brian.click());
    expect($('.avp-sub')!.textContent).toContain('skin');
    act(() => $('.avp-use')!.click());
    expect(useGame.getState().playerAvatar).toBe('skin:skin_blackbelt_1');
    expect(avatarSrc('skin:skin_blackbelt_1')).toBe(skinArt('skin_blackbelt_1'));
    expect(avatarSrc('skin:skin_blackbelt_1')).toBeTruthy();
  });

  it('with no skins owned the tab says so and points at the Collection', () => {
    open({ cosmetics: [] });
    expect(tab('Heroes').getAttribute('aria-selected')).toBe('true');
    act(() => tab('My Skins').click());
    expect($$('.avp-tile')).toHaveLength(0);
    expect($('.phk-emptytitle')!.textContent).toBe('No skins yet');
    act(() => ($('.phk-empty button') as HTMLButtonElement).click());
    expect(useGame.getState().avatarPickerOpen).toBe(false);
    expect(useGame.getState().showCollection).toBe(true);
  });

  it('search filters by name and the tab counts follow it', () => {
    open();
    const heroes = Number(countOf('Heroes'));
    type('sheriff');
    expect($$('.avp-tile').map((t) => t.dataset.name)).toEqual(['Sheriff Brian']);
    expect(countOf('My Skins')).toBe('1');
    expect(Number(countOf('Heroes'))).toBeLessThan(heroes);
    type('zzzz no such portrait');
    expect($('.phk-emptytitle')!.textContent).toBe('No matches');
  });

  it('opens on the tab of the portrait in use and tags it; Reset to default selects the default', () => {
    useGame.setState({ playerAvatar: 'skin:skin_albus_1' });
    open();
    expect(tab('My Skins').getAttribute('aria-selected')).toBe('true');
    expect($('.avp-tile.used')!.querySelector('.avp-used')!.textContent).toBe('In use');
    expect(($('.avp-use') as HTMLButtonElement).disabled).toBe(true);
    act(() => $('.avp-reset')!.click());
    expect($('.avp-name')!.textContent).toBe('Default');
    act(() => $('.avp-use')!.click());
    expect(useGame.getState().playerAvatar).toBeNull();
  });

  it('a double press applies at once; Esc closes without saving', () => {
    open();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(useGame.getState().avatarPickerOpen).toBe(false);
    expect(useGame.getState().playerAvatar).toBeNull();
    act(() => useGame.getState().openAvatarPicker());
    act(() => $('.avp-tile')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(useGame.getState().playerAvatar).toMatch(/^skin:/);
    expect(useGame.getState().avatarPickerOpen).toBe(false);
  });

  it('the stylesheet keeps the house rules: no plain cursor, no raw viewport units, only the list scrolls', () => {
    const css = readFileSync(join(__dirname, 'avatarPicker.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/cursor\s*:/);
    expect(css.replace(/var\(--lv[wh], 100v[wh]\)/g, '')).not.toMatch(/\d(vw|vh)\b/);
    expect(css.match(/overflow-y:\s*auto/g)).toHaveLength(1);
    expect(document.querySelector('[title]')).toBeNull();
  });
});
