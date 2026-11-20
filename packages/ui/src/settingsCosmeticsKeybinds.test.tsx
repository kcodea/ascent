// @vitest-environment jsdom
/**
 * SETTINGS: COSMETICS + KEYBINDINGS (owner 2026-11-20). Pinned:
 *  - R-SETTINGS-COSMETICS-01: a category switch turned off puts the default look back wherever it renders, a SPECTATOR's
 *    watch bar included (hero skin, portrait frame), and on the minion / card plate resolvers; every switch defaults
 *    on and is saved on this device; nothing about the snapshot changes.
 *  - R-SETTINGS-KEYBINDS-01: rebinding the Compendium moves it (C no longer opens it); a key another action holds is
 *    swapped; the fixed keys and modifier combos are refused; the spectator's Next / Previous keys step and wrap; the
 *    Settings key buttons capture the next key press without it reaching the game.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cosmeticOf, type RunCosmeticSnapshot } from '@game/progression';
import { mount, type Mounted } from './renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('./store');
const { useSpectate } = await import('./versus/spectate');
const { WatchedPanel } = await import('./versus/SpectatorHud');
const { heroArt } = await import('./art');
const { skinArtOf, minionSkinMap } = await import('./skins/skinArt');
const { cardPlateLookOf } = await import('./cardPlate/cardPlateLook');
const { attackerCosmeticOf } = await import('./heroBlast/attackerCosmetic');
const vis = await import('./cosmetics/cosmeticVisibility');
const kb = await import('./keybinds/keybinds');
const { installCompendiumHotkey } = await import('./compendiumHotkey');
const { spectateKeyTarget } = await import('./versus/SpectatorBar');
const { KeybindsTab } = await import('./partyHome/pages/PhSettingsKeybinds');
const fps = await import('./FpsCounter');

const SKIN = 'skin_albus_1';
const FRAME = 'frame_honey';
const profile = { cosmetics: { heroSkinByHeroId: { albus: SKIN }, portraitFrame: FRAME } };
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(e); });
  return e;
};
const click = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); };

let ui: Mounted | null = null;
beforeEach(() => {
  localStorage.clear();
  vis.reloadCosmeticVisibilityForTest();
  kb.reloadKeybindsForTest();
});
afterEach(() => {
  ui?.unmount(); ui = null;
  localStorage.clear();
  vis.reloadCosmeticVisibilityForTest();
  kb.reloadKeybindsForTest();
  useSpectate.setState({ active: false });
  act(() => { useGame.setState({ showBook: false, settingsOpen: false, showOpponentSkins: true } as never); });
  document.body.innerHTML = '';
});

describe('cosmetic switches (R-SETTINGS-COSMETICS-01)', () => {
  it('every switch defaults on', () => {
    for (const id of vis.COSMETIC_TOGGLES) expect(vis.cosmeticShown(id), id).toBe(true);
  });

  it('a spectator watch bar drops the hero skin and portrait frame when their switches are off, at once', () => {
    useSpectate.setState({ active: true });
    const skinned = skinArtOf(cosmeticOf(SKIN));
    expect(skinned, 'the test skin has art').toBeTruthy();
    ui = mount(<WatchedPanel seats={[
      { key: 'p1', name: 'Rooks', heroId: 'albus', profile, health: 30, armor: 0, on: true, pick: () => undefined },
      { key: 'p2', name: 'Skye', heroId: 'albus', profile, health: 30, armor: 0, on: false, pick: () => undefined },
    ]} />);
    const img = (): string | null => ui!.container.querySelector('.vswatchchip .heroimg')!.getAttribute('src');
    const frame = (): Element | null => ui!.container.querySelector('.vswatchchip .pframe-box');
    expect(img()).toBe(skinned);
    expect(frame()?.getAttribute('data-frame')).toBe(FRAME);

    act(() => { vis.setCosmeticShown('hero_skin', false); });
    expect(img(), 'default hero art').toBe(heroArt('albus'));
    expect(frame(), 'frames still on').not.toBeNull();

    act(() => { vis.setCosmeticShown('portrait_frame', false); });
    expect(frame()).toBeNull();

    act(() => { vis.showAllCosmetics(); });
    expect(img()).toBe(skinned);
    expect(frame()).not.toBeNull();
  });

  it('minion skins, card plates and hero attacks fall back to the default, without touching the snapshot', () => {
    const snap: RunCosmeticSnapshot = { minionSkinByCardId: { x: 'y' }, cardPlate: 'plate_x', heroAttack: 'attack_blast' };
    const before = JSON.stringify(snap);
    vis.setCosmeticShown('minion_skin', false);
    vis.setCosmeticShown('card_plate', false);
    vis.setCosmeticShown('hero_attack', false);
    expect(minionSkinMap(snap).size).toBe(0);
    expect(cardPlateLookOf(snap)).toBeNull();
    expect(attackerCosmeticOf({ cosmetics: snap, lobby: undefined } as never, 'player', true)).toBeNull();
    expect(JSON.stringify(snap)).toBe(before);
  });

  it('is saved on this device', () => {
    vis.setCosmeticShown('title', false);
    vis.reloadCosmeticVisibilityForTest();
    expect(vis.cosmeticShown('title')).toBe(false);
    expect(vis.cosmeticShown('hero_skin')).toBe(true);
  });
});

describe('key bindings (R-SETTINGS-KEYBINDS-01)', () => {
  it('rebinding the Compendium to K opens it on K, and C no longer does', () => {
    const off = installCompendiumHotkey();
    try {
      act(() => { useGame.setState({ showBook: false, heroChoices: null, settingsOpen: false }); });
      expect(kb.rebind('compendium', 0, 'K').ok).toBe(true);
      press('c');
      expect(useGame.getState().showBook).toBe(false);
      press('k');
      expect(useGame.getState().showBook).toBe(true);
      press('k');
      expect(useGame.getState().showBook).toBe(false);
      expect(JSON.parse(localStorage.getItem('ascent.keybinds.v1')!)).toEqual({ compendium: ['k'] });
    } finally { off(); }
  });

  it('a key another action holds is swapped, never shared', () => {
    const r = kb.rebind('compendium', 0, 'e'); // E is Next player's
    expect(r).toMatchObject({ ok: true, swappedWith: 'spectateNext', gave: 'c' });
    expect(kb.keysOf('compendium')).toEqual(['e']);
    expect(kb.keysOf('spectateNext')).toEqual(['c']);
    // The chat's second key (Y) onto Q: Previous player takes Y.
    const r2 = kb.rebind('lobbyChat', 1, 'q');
    expect(r2).toMatchObject({ ok: true, swappedWith: 'spectatePrev', gave: 'y' });
    expect(kb.keysOf('spectatePrev')).toEqual(['y']);
    // Taking a key into an EMPTY slot leaves the holder with none.
    kb.clearSecondKey('lobbyChat');
    expect(kb.rebind('lobbyChat', 1, 'y')).toMatchObject({ ok: true, swappedWith: 'spectatePrev', gave: null });
    expect(kb.keysOf('spectatePrev')).toEqual([]);
    const all = kb.KEY_ACTIONS.flatMap((a) => kb.keysOf(a.id));
    expect(new Set(all).size).toBe(all.length);
    kb.resetBinding('spectatePrev');
    expect(kb.keysOf('spectatePrev')).toEqual(['q']);
    expect(kb.keysOf('lobbyChat')).toEqual(['Enter', 'y']);
    kb.resetAllBindings();
    expect(kb.keysOf('compendium')).toEqual(['c']);
    expect(localStorage.getItem('ascent.keybinds.v1')).toBeNull();
  });

  it('refuses the fixed keys, and never fires with Ctrl, Cmd or Alt held', () => {
    expect(kb.rebind('compendium', 0, 'Escape')).toMatchObject({ ok: false });
    expect(kb.rebind('compendium', 0, 'F11')).toMatchObject({ ok: false });
    expect(kb.matchesAction('compendium', { key: 'c', ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
    expect(kb.matchesAction('compendium', { key: 'C', ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
  });

  it('spectating: Next and Previous step through the players still in and wrap; the seat keys pick directly', () => {
    const k = (key: string) => ({ key, ctrlKey: false, metaKey: false, altKey: false });
    const seats = ['p1', 'p2', 'p3'] as const;
    expect(spectateKeyTarget(k('e'), seats, 'p1')).toBe('p2');
    expect(spectateKeyTarget(k('e'), seats, 'p3')).toBe('p1');
    expect(spectateKeyTarget(k('q'), seats, 'p1')).toBe('p3');
    expect(spectateKeyTarget(k('2'), seats, 'p1')).toBe('p2');
    expect(spectateKeyTarget(k('4'), seats, 'p1'), 'a seat key past the players: consumed, no seat').toBeNull();
    expect(spectateKeyTarget(k('x'), seats, 'p1'), 'not a spectator key').toBeUndefined();
    kb.rebind('spectateNext', 0, ']');
    expect(spectateKeyTarget(k(']'), seats, 'p2')).toBe('p3');
    expect(spectateKeyTarget(k('e'), seats, 'p2')).toBeUndefined();
  });

  it('the Settings key button takes the next key press, which never reaches the game; Esc only cancels', () => {
    const off = installCompendiumHotkey();
    try {
      act(() => { useGame.setState({ showBook: false, heroChoices: null, settingsOpen: false }); });
      ui = mount(<KeybindsTab />);
      const btn = (): HTMLButtonElement => ui!.container.querySelector<HTMLButtonElement>('button.phs-key[aria-label^="Compendium:"], button.phs-key.waiting')!;
      expect(btn().textContent).toBe('C');
      click(btn());
      expect(btn().textContent).toBe('Press a key');
      expect(kb.keyCaptureActive()).toBe(true);
      press('Escape');
      expect(kb.keyCaptureActive()).toBe(false);
      expect(kb.keysOf('compendium')).toEqual(['c']);
      click(btn());
      press('j');
      expect(kb.keysOf('compendium')).toEqual(['j']);
      expect(useGame.getState().showBook, 'the bound key never also toggled the book').toBe(false);
      expect(btn().textContent).toBe('J');
      expect(ui.container.querySelector('[role="status"]')?.textContent).toBe('Compendium: J.');
      click(btn());
      press('e'); // Next player's: swapped
      expect(ui.container.querySelector('[role="status"]')?.textContent).toBe('E was on Next player. Next player now uses J.');
    } finally { off(); }
  });
});

describe('the FPS counter (R-SETTINGS-FPS-01)', () => {
  it('is off by default, mounts its readout when switched on, and is saved on this device', () => {
    ui = mount(<fps.FpsCounter />);
    expect(ui.container.querySelector('.fps-counter')).toBeNull();
    act(() => { fps.setFpsCounterOn(true); });
    expect(ui.container.querySelector('.fps-counter')).not.toBeNull();
    expect(localStorage.getItem('ascent.fpsCounter')).toBe('1');
    act(() => { fps.setFpsCounterOn(false); });
    expect(ui.container.querySelector('.fps-counter')).toBeNull();
  });
});
