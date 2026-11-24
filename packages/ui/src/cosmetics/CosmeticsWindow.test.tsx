// @vitest-environment jsdom
/**
 * THE COSMETICS WINDOW (showcase player card, PR 3 Task 6): one window, four tabs (Avatar, Frame, Title, Card plate).
 *  - it opens on the tab it was asked for (`openCosmetics('frame')`);
 *  - a press selects (Use turns on), nothing is saved until Use (or a double press); Esc closes without saving;
 *  - a frame tile is the ring on its own, never an avatar inside it;
 *  - a failed save says so and the window stays open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProgressionProfile } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../remoteBoards', async (orig) => ({ ...(await orig<typeof import('../remoteBoards')>()), pushProfileAvatar: async () => undefined }));
const saves = vi.hoisted(() => ({ cosmetic: vi.fn(async (..._a: unknown[]) => true), title: vi.fn(async (..._a: unknown[]) => true) }));
vi.mock('../progression/progressionStore', async (orig) => ({
  ...(await orig<typeof import('../progression/progressionStore')>()),
  equipCosmetic: (...a: unknown[]) => saves.cosmetic(...a),
  equipTitle: (...a: unknown[]) => saves.title(...a),
}));

import { CosmeticsWindow } from './CosmeticsWindow';
import { resetProgressionForTests, useProgression } from '../progression/progressionStore';
import { useGame } from '../store';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; resetProgressionForTests(); });
beforeEach(() => {
  resetProgressionForTests();
  localStorage.clear();
  saves.cosmetic.mockReset(); saves.cosmetic.mockImplementation(async () => true);
  saves.title.mockReset(); saves.title.mockImplementation(async () => true);
  useGame.setState({
    account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null },
    showTitle: true, showCollection: false, avatarPickerOpen: false, playerAvatar: null, playerName: 'Kevin',
  });
});

const base: ProgressionProfile = {
  accountXp: 0, accountLevel: 1, revision: 1, equippedTitleId: null, titles: ['title_wanderer'],
  cosmetics: ['frame_honey', 'frame_ruby', 'title_wanderer', 'plate_bamboo', 'skin_blackbelt_1'], loadout: {},
};
function open(tab?: 'avatar' | 'frame' | 'title' | 'plate'): void {
  useProgression.setState({ capability: 'on', mirror: { userId: 'u-1', ...base } });
  act(() => useGame.getState().openCosmetics(tab));
  ui = mount(<CosmeticsWindow />);
}
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const tile = (id: string): HTMLElement => $(`.cw-tile[data-id="${id}"]`)!;
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

describe('the cosmetics window', () => {
  it('opens on the tab passed to openCosmetics', () => {
    open('frame');
    expect($('.cw-tabs [role="tab"][aria-selected="true"] .cw-tabname')!.textContent).toBe('Frame');
    expect(useGame.getState().cosmeticsTab).toBe('frame');
  });

  it('openAvatarPicker opens it on the Avatar tab', () => {
    useProgression.setState({ capability: 'on', mirror: { userId: 'u-1', ...base } });
    act(() => useGame.getState().openAvatarPicker());
    ui = mount(<CosmeticsWindow />);
    expect($('.cw-tabs [role="tab"][aria-selected="true"] .cw-tabname')!.textContent).toBe('Avatar');
    expect($('.avp-tile')).not.toBeNull();
  });

  it('one press selects and turns Use on; Esc closes and nothing is saved', () => {
    open('frame');
    expect(($('.cw-use') as HTMLButtonElement).disabled).toBe(true);
    act(() => tile('frame_honey').click());
    expect(tile('frame_honey').getAttribute('aria-pressed')).toBe('true');
    expect(($('.cw-use') as HTMLButtonElement).disabled).toBe(false);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(useGame.getState().avatarPickerOpen).toBe(false);
    expect(useGame.getState().playerAvatar).toBeNull();
    expect(useProgression.getState().mirror!.loadout).toEqual({});
    expect(saves.cosmetic).not.toHaveBeenCalled();
  });

  it('frame tiles are the ring on its own: one image per tile, no avatar inside', () => {
    open('frame');
    const frames = $$('.cw-tile .cw-frame');
    expect(frames.length).toBeGreaterThanOrEqual(2);
    for (const f of frames.filter((x) => !x.classList.contains('cw-none'))) expect(f.querySelectorAll('img')).toHaveLength(1);
    // Only owned frames, plus the default ring.
    expect($$('.cw-tile').map((t) => t.dataset.id)).toEqual(['', 'frame_honey', 'frame_ruby']);
  });

  it('Use saves the frame and closes', async () => {
    open('frame');
    act(() => tile('frame_ruby').click());
    act(() => $('.cw-use')!.click());
    await flush();
    expect(saves.cosmetic).toHaveBeenCalledWith('portrait_frame', '', 'frame_ruby');
    expect(useGame.getState().avatarPickerOpen).toBe(false);
  });

  it('a double press applies and closes', async () => {
    open('title');
    act(() => tile('title_wanderer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await flush();
    expect(saves.title).toHaveBeenCalledWith('title_wanderer');
    expect(useGame.getState().avatarPickerOpen).toBe(false);
  });

  it('a failed save shows the error line and the window stays open', async () => {
    saves.cosmetic.mockImplementation(async () => false);
    open('frame');
    act(() => tile('frame_honey').click());
    act(() => $('.cw-use')!.click());
    await flush();
    expect($('.cw-error')!.textContent).toBe('Could not change your portrait frame. Try again.');
    expect(useGame.getState().avatarPickerOpen).toBe(true);
  });

  it('Reset to default sets only the current tab back to its default', () => {
    useProgression.setState({ capability: 'on', mirror: { userId: 'u-1', ...base, loadout: { cardPlate: 'plate_bamboo' } } });
    act(() => useGame.getState().openCosmetics('plate'));
    ui = mount(<CosmeticsWindow />);
    expect(tile('plate_bamboo').querySelector('.cw-used')!.textContent).toBe('In use');
    expect(($('.cw-use') as HTMLButtonElement).disabled).toBe(true);
    act(() => $('.cw-reset')!.click());
    expect(tile('').getAttribute('aria-pressed')).toBe('true');
    expect(($('.cw-use') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders nothing for a guest', () => {
    useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } });
    open('frame');
    expect($('.cw')).toBeNull();
  });

  it('keeps the house rules: no native tooltip, no em dash, no plain cursor, no raw viewport units', () => {
    open('title');
    expect(document.querySelector('[title]')).toBeNull();
    expect(document.querySelector('.cw')!.textContent).not.toContain('\u2014');
    const css = readFileSync(join(__dirname, 'cosmeticsWindow.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/cursor\s*:/);
    expect(css.replace(/var\(--lv[wh], 100v[wh]\)/g, '')).not.toMatch(/\d(vw|vh)\b/);
    for (const img of $$('.cw img')) {
      expect(img.getAttribute('decoding')).toBe('sync');
      expect(img.getAttribute('draggable')).toBe('false');
    }
  });
});
