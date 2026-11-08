// @vitest-environment jsdom
/**
 * R-ESC-SETTINGS-01: ESCAPE OPENS SETTINGS ON EVERY SCREEN (owner 2026-11-07: "when on the main screen, pressing escape should
 * bring up the settings menu" ... "it should actually open the settings on any screen. in game it should open the settings menu
 * too").
 *
 * Pins: with nothing open, Escape opens Settings on the menus, on a party home page (the page stays under it) and in a game
 * (the Settings page over the dimmed game); Escape again closes it, and in a game goes straight back to the game; whatever is
 * open on top (a layer, the in-game menu) closes first; a card being inspected and a field being typed in claim Escape; the
 * gear still opens the in-game menu itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.mock('./remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./remoteBoards')>()),
  remoteEnabled: () => false,
}));

import { closeInGamePageState, handleEscape, openMenu } from './GameMenu';
import { phAttach, phLayer, phPagePushed } from './partyHome/shell/phHistory';
import { useGame } from './store';

const CLOSED = {
  showCareer: false, careerOf: null, showRankings: false, showLeaderboard: false, showRecentGames: false, showLiveGames: false,
  showCollection: false, settingsOpen: false, gameMenuOpen: false, showBook: false, showPatchNotes: false, inspect: null,
} as const;
const baseRun = useGame.getState().run;
const inGame = (extra: Record<string, unknown> = {}): void => {
  act(() => {
    useGame.setState({
      ...CLOSED, showTitle: false, practiceSetupOpen: false, heroChoices: null, replaying: false,
      run: { ...baseRun, phase: 'recruit', mode: 'lobby' }, ...extra,
    } as never);
  });
};
const onMenus = (extra: Record<string, unknown> = {}): void => {
  act(() => { useGame.setState({ ...CLOSED, showTitle: true, practiceSetupOpen: false, ...extra } as never); });
};
const esc = (): void => { act(() => { handleEscape(); }); };
const st = () => useGame.getState();

afterEach(() => {
  act(() => { useGame.setState({ ...CLOSED, showTitle: true, run: baseRun, replaying: false, heroChoices: null } as never); });
});

describe('R-ESC-SETTINGS-01: Escape opens Settings on every screen', () => {
  it('on the main screen Escape opens Settings, and Escape again closes it', () => {
    onMenus();
    esc();
    expect(st().settingsOpen).toBe(true);
    expect(st().gameMenuOpen).toBe(false);
    esc();
    expect(st().settingsOpen).toBe(false);
  });

  it('in a game Escape opens the Settings page over the dimmed game, and Escape again goes straight back to the game', () => {
    inGame();
    esc();
    expect(st().settingsOpen, 'Settings, not just the sidebar').toBe(true);
    expect(st().gameMenuOpen, 'over the dimmed game, like the in-game menu\'s own Settings page').toBe(true);
    esc();
    expect(st().settingsOpen).toBe(false);
    expect(st().gameMenuOpen, 'back in the game, not left on the sidebar').toBe(false);
  });

  it('a hero select and a replay are games too', () => {
    for (const extra of [{ heroChoices: ['a', 'b'] }, { replaying: true }]) {
      inGame(extra);
      esc();
      expect(st().settingsOpen).toBe(true);
      expect(st().gameMenuOpen).toBe(true);
      esc();
      expect(st().gameMenuOpen).toBe(false);
    }
  });

  it('the shell\'s Back on Escape-opened Settings in a game returns to the game; Settings opened from the sidebar returns to the sidebar', () => {
    inGame();
    esc();
    act(() => { useGame.setState(closeInGamePageState()); });
    expect(st().settingsOpen).toBe(false);
    expect(st().gameMenuOpen).toBe(false);
    act(() => { st().openGameMenu(); st().goTo('settings'); });
    expect(st().settingsOpen).toBe(true);
    act(() => { useGame.setState(closeInGamePageState()); });
    expect(st().settingsOpen).toBe(false);
    expect(st().gameMenuOpen, 'opened from the sidebar: Back lands on the sidebar').toBe(true);
  });

  it('the gear still opens the in-game menu itself', () => {
    inGame();
    act(() => { openMenu(); });
    expect(st().gameMenuOpen).toBe(true);
    expect(st().settingsOpen).toBe(false);
    esc();
    expect(st().gameMenuOpen, 'an open menu closes first').toBe(false);
    expect(st().settingsOpen).toBe(false);
  });

  it('the Compendium closes first; a card being inspected claims Escape', () => {
    onMenus({ showBook: true });
    esc();
    expect(st().showBook).toBe(false);
    expect(st().settingsOpen).toBe(false);
    onMenus({ inspect: { id: 'x' } });
    esc();
    expect(st().settingsOpen).toBe(false);
  });

  it('typing in a field: Escape lets go of the field and opens nothing', () => {
    onMenus();
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    esc();
    expect(st().settingsOpen).toBe(false);
    expect(document.activeElement).not.toBe(input);
    input.remove();
  });

  it('under the party home shell: on a page Escape opens Settings over it, an open layer closes first, and Escape closes Settings back to the page', () => {
    const entries: unknown[] = [null];
    let at = 0;
    const pending: number[] = [];
    vi.spyOn(history, 'pushState').mockImplementation((s) => { entries.length = at + 1; entries.push(s); at++; });
    vi.spyOn(history, 'replaceState').mockImplementation((s) => { entries[at] = s; });
    vi.spyOn(history, 'back').mockImplementation(() => { pending.push(-1); });
    const flush = (): void => { while (pending.length) { pending.shift(); if (at === 0) continue; at--; window.dispatchEvent(new PopStateEvent('popstate', { state: entries[at] })); } };
    const show = vi.fn();
    const detach = phAttach(show);
    try {
      phPagePushed('home'); phPagePushed('collection');
      onMenus({ showCollection: true });
      // A pop-up on the page goes first.
      const close = vi.fn();
      phLayer(close);
      esc(); flush();
      expect(close).toHaveBeenCalledOnce();
      expect(st().settingsOpen).toBe(false);
      // Nothing open: Settings opens over the page, which stays.
      esc();
      expect(st().settingsOpen).toBe(true);
      expect(st().showCollection).toBe(true);
      phPagePushed('settings'); // the shell's nav follows the store (PhSteadyNav)
      // Escape again takes Settings off, back to the page.
      esc(); flush();
      expect(show).toHaveBeenLastCalledWith('collection');
    } finally {
      detach();
      vi.restoreAllMocks();
    }
  });
});
