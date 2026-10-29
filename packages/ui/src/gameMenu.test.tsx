// @vitest-environment jsdom
/**
 * R-ESC-SIDEBAR-01: THE IN-GAME MENU (owner 2026-10-29: "when pressing escape, have the left side bar come up with the
 * play/etc buttons. allow players to view this information in game, and have the settings panel at the bottom baked
 * into a normal 'window' just like these other pages are. so opening settings sits attached to the side bar in its own
 * view with all settings shown").
 *
 * Pins: Escape in a game opens the sidebar over the dimmed game and Escape again closes it (with any page it opened);
 * on the menus Escape opens the Settings page; Resume and a press on the dimmed game close it; the in-game rail swaps
 * Play for a gold Resume and carries Patch Notes, Settings and the leave button, never the dev builders; a page opened
 * in a game wears the in-game rail and no painted backdrop; the Settings page shows every section and no leave button;
 * every leave asks twice and does the right thing per mode; the Shop clock shows on the rail in a Shop turn only; a
 * page action that would leave the game is refused with a note; opening the menu drops a drag in hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mount, type Mounted } from './renderedText.mount';

vi.mock('./remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./remoteBoards')>()),
  remoteEnabled: () => false,
}));
const spies = vi.hoisted(() => ({ forfeit: vi.fn(async () => {}), endReplay: vi.fn() }));
vi.mock('./versus/versusStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./versus/versusStore')>()),
  forfeitMatch: spies.forfeit,
}));
vi.mock('./replay/replayPlayer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./replay/replayPlayer')>()),
  endReplay: spies.endReplay,
  startReplay: vi.fn(),
}));

import { GameMenu, handleEscape } from './GameMenu';
import { SettingsPage } from './EscMenu';
import { Rankings } from './Rankings';
import { leaveKindOf, refuseInGame } from './gameMenuParts';
import { turnClock } from './turnClock';
import { useGame } from './store';

const CLOSED = {
  showCareer: false, careerOf: null, showRankings: false, showLeaderboard: false, showRecentGames: false, showLiveGames: false,
  showCollection: false, settingsOpen: false, gameMenuOpen: false, showBook: false, showPatchNotes: false, inspect: null,
} as const;
const baseRun = useGame.getState().run;
const inGame = (run: Partial<typeof baseRun> = {}, extra: Record<string, unknown> = {}): void => {
  act(() => {
    useGame.setState({
      ...CLOSED, showTitle: false, practiceSetupOpen: false, heroChoices: null, replaying: false, rankedEntry: null,
      run: { ...baseRun, phase: 'recruit', mode: 'lobby', sandbox: undefined, godMode: undefined, ...run },
      ...extra,
    } as never);
  });
};

let ui: Mounted | null = null;
const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
const press = (el: Element | null | undefined): void => { act(() => { el!.dispatchEvent(new Event('pointerdown', { bubbles: true })); }); };
const labels = (root: ParentNode): string[] => [...root.querySelectorAll('.sbbtn')].map((b) => (b.textContent ?? '').trim());

beforeEach(() => { spies.forfeit.mockClear(); spies.endReplay.mockClear(); });
afterEach(() => {
  ui?.unmount(); ui = null;
  act(() => { useGame.setState({ ...CLOSED, showTitle: true, run: baseRun, replaying: false, heroChoices: null } as never); });
});

describe('R-ESC-SIDEBAR-01: Escape', () => {
  it('in a game opens the in-game menu and Escape again closes it, with any page it opened', () => {
    inGame();
    handleEscape();
    expect(useGame.getState().gameMenuOpen).toBe(true);
    expect(useGame.getState().settingsOpen, 'never the Settings page straight away').toBe(false);
    handleEscape();
    expect(useGame.getState().gameMenuOpen).toBe(false);
    handleEscape();
    useGame.getState().goTo('collection');
    expect(useGame.getState().showCollection).toBe(true);
    handleEscape();
    expect(useGame.getState().gameMenuOpen).toBe(false);
    expect(useGame.getState().showCollection, 'the page closes with the menu').toBe(false);
  });

  it('on the menus opens and closes the Settings page', () => {
    act(() => { useGame.setState({ ...CLOSED, showTitle: true }); });
    handleEscape();
    expect(useGame.getState().settingsOpen).toBe(true);
    expect(useGame.getState().gameMenuOpen).toBe(false);
    handleEscape();
    expect(useGame.getState().settingsOpen).toBe(false);
  });

  it('a hero select, a replay and a watched game are games too', () => {
    for (const extra of [{ heroChoices: ['a', 'b'] }, { replaying: true }]) {
      inGame({}, extra);
      handleEscape();
      expect(useGame.getState().gameMenuOpen).toBe(true);
      handleEscape();
    }
  });
});

describe('R-ESC-SIDEBAR-01: the in-game sidebar', () => {
  it('slides in over the dimmed game: Resume (gold) instead of Play, the pages, Patch Notes, Settings, then the leave button; no dev builders', () => {
    inGame();
    act(() => { useGame.getState().openGameMenu(); });
    ui = mount(<GameMenu />);
    const menu = ui.container.querySelector('.gmenu');
    expect(menu).not.toBeNull();
    expect(menu!.querySelector('.gmenu-veil')).not.toBeNull();
    const rail = menu!.querySelector('.msb.msb-ingame')!;
    expect(rail).not.toBeNull();
    const ls = labels(rail);
    expect(ls[0]).toBe('Resume');
    expect(rail.querySelector('.msb-resume')?.classList.contains('sb-play')).toBe(true);
    expect(ls).not.toContain('Play');
    for (const page of ['Career', 'Leaderboard', 'Recent Games', 'Live Games', 'Patch Notes', 'Settings']) expect(ls).toContain(page);
    expect(ls.at(-1)).toBe('Save & Quit');
    expect(ls.at(-2)).toBe('Settings');
    expect(rail.textContent).not.toMatch(/Scene Builder|Stage Builder/);
    expect(ui.container.querySelector('.mbd'), 'no painted backdrop: the game shows through').toBeNull();
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('Resume closes it; so does a press on the dimmed game', () => {
    inGame();
    act(() => { useGame.getState().openGameMenu(); });
    ui = mount(<GameMenu />);
    click(ui.container.querySelector('.msb-resume'));
    expect(useGame.getState().gameMenuOpen).toBe(false);
    expect(ui.container.querySelector('.gmenu')).toBeNull();
    act(() => { useGame.getState().openGameMenu(); });
    press(ui.container.querySelector('.gmenu-veil'));
    expect(useGame.getState().gameMenuOpen).toBe(false);
  });

  it('a page opened in a game wears the in-game rail, no backdrop, and the menu\'s own rail hides under it', () => {
    inGame();
    act(() => { useGame.getState().openGameMenu(); });
    ui = mount(<><GameMenu /><Rankings /></>);
    click([...ui.container.querySelectorAll('.gmenu .sbbtn')].find((b) => b.textContent?.trim() === 'Leaderboard'));
    expect(useGame.getState().showRankings).toBe(true);
    expect(ui.container.querySelector('.gmenu')?.classList.contains('paged')).toBe(true);
    const page = ui.container.querySelector('.lbpage')!;
    expect(page.querySelector('.msb.msb-ingame .msb-resume')).not.toBeNull();
    expect(page.querySelector('.sbbtn[aria-current="page"]')?.textContent?.trim()).toBe('Leaderboard');
    expect(ui.container.querySelector('.mbd')).toBeNull();
    // The mark closes the page, back to the bare rail; the game menu stays.
    click(page.querySelector('.msb-home'));
    expect(useGame.getState().showRankings).toBe(false);
    expect(useGame.getState().gameMenuOpen).toBe(true);
  });

  it('closes itself when the game hands back to the title', () => {
    inGame();
    act(() => { useGame.getState().openGameMenu(); });
    ui = mount(<GameMenu />);
    act(() => { useGame.setState({ showTitle: true }); });
    expect(useGame.getState().gameMenuOpen).toBe(false);
  });
});

describe('R-ESC-SIDEBAR-01: the Settings page', () => {
  it('is a sidebar page with every section and no leave button, on the menus and in a game', () => {
    for (const game of [false, true]) {
      if (game) { inGame(); act(() => { useGame.getState().openGameMenu(); }); } else act(() => { useGame.setState({ ...CLOSED, showTitle: true }); });
      act(() => { useGame.getState().goTo('settings'); });
      ui = mount(<SettingsPage />);
      const page = ui.container.querySelector('.lbpage.set-page')!;
      expect(page).not.toBeNull();
      expect(page.querySelector('.msb .msb-settings')?.getAttribute('aria-current')).toBe('page');
      const secs = [...page.querySelectorAll('.escsec')].map((e) => e.textContent);
      for (const sec of ['Combat', 'Audio', 'Cosmetics', 'Friends', 'Board', 'Performance', 'Account']) expect(secs).toContain(sec);
      expect(secs).not.toContain('Run');
      expect(page.querySelector('.escpanel .escbtn-primary')).toBeNull();
      expect(page.querySelector('.escclose')).toBeNull();
      expect(!!page.querySelector('.msb .msb-leave'), game ? 'in a game the rail carries the leave' : 'the menus have nothing to leave').toBe(game);
      ui.unmount(); ui = null;
    }
  });
});

describe('R-ESC-SIDEBAR-01: leaving, with a confirm step', () => {
  const leaveBtn = (): HTMLElement => ui!.container.querySelector<HTMLElement>('.gmenu .msb-leave')!;
  const open = (): void => { act(() => { useGame.getState().openGameMenu(); }); ui = mount(<GameMenu />); };

  it('reads the leave per mode', () => {
    const s = useGame.getState();
    const st = (o: Record<string, unknown>) => ({ ...s, replaying: false, heroChoices: null, pendingMode: null, rankedEntry: null, run: { ...baseRun, mode: 'lobby' }, ...o }) as never;
    expect(leaveKindOf(st({}), true)).toBe('watch');
    expect(leaveKindOf(st({ replaying: true }), false)).toBe('replay');
    expect(leaveKindOf(st({ run: { ...baseRun, mode: 'versus' } }), false)).toBe('concede');
    expect(leaveKindOf(st({ heroChoices: ['a'], pendingMode: 'versus' }), false)).toBe('concede');
    expect(leaveKindOf(st({ heroChoices: ['a'], pendingMode: 'lobby', rankedEntry: {} }), false)).toBe('abandon');
    expect(leaveKindOf(st({}), false)).toBe('run');
  });

  it('Save & Quit asks twice, then saves and returns to the menu', () => {
    inGame();
    open();
    click(leaveBtn());
    expect(useGame.getState().showTitle, 'the first tap only arms it').toBe(false);
    expect(leaveBtn().textContent).toBe('Tap again to quit');
    expect(ui!.container.querySelector('.msb-leavenote')?.textContent).toMatch(/Continue picks up right here/);
    click(leaveBtn());
    expect(useGame.getState().showTitle).toBe(true);
    expect(useGame.getState().gameMenuOpen).toBe(false);
  });

  it('God Mode leaves without promising a save', () => {
    inGame({ sandbox: true, godMode: true });
    open();
    expect(leaveBtn().textContent).toBe('Leave God Mode');
    click(leaveBtn());
    expect(ui!.container.querySelector('.msb-leavenote')?.textContent).toMatch(/Nothing from this game is saved/);
  });

  it('Versus / Duos concede, twice', () => {
    inGame({ mode: 'versus' });
    open();
    expect(leaveBtn().textContent).toBe('Concede');
    click(leaveBtn());
    expect(spies.forfeit).not.toHaveBeenCalled();
    click(leaveBtn());
    expect(spies.forfeit).toHaveBeenCalledTimes(1);
    expect(useGame.getState().gameMenuOpen).toBe(false);
  });

  it('a ranked hero select abandons, twice', () => {
    const abandon = vi.fn();
    inGame({}, { heroChoices: ['a', 'b'], pendingMode: 'lobby', rankedEntry: {}, abandonRankedEntry: abandon });
    open();
    expect(leaveBtn().textContent).toBe('Abandon match');
    click(leaveBtn());
    expect(ui!.container.querySelector('.msb-leavenote')?.textContent).toMatch(/8th place/);
    click(leaveBtn());
    expect(abandon).toHaveBeenCalledTimes(1);
  });

  it('a replay ends the playback, then the menu', () => {
    inGame({}, { replaying: true });
    open();
    expect(leaveBtn().textContent).toBe('Leave replay');
    click(leaveBtn());
    click(leaveBtn());
    expect(spies.endReplay).toHaveBeenCalledTimes(1);
    expect(useGame.getState().showTitle).toBe(true);
  });
});

describe('R-ESC-SIDEBAR-01: the Shop clock on the rail', () => {
  it('shows the time left in a Shop turn, red in the last 10 s, and nothing in combat or a replay', () => {
    inGame();
    act(() => { turnClock.set(42); useGame.getState().openGameMenu(); });
    ui = mount(<GameMenu />);
    expect(ui.container.querySelector('.msb-clock-v')?.textContent).toBe('0:42');
    expect(ui.container.querySelector('.msb-clock')?.classList.contains('low')).toBe(false);
    act(() => { turnClock.set(7); });
    expect(ui.container.querySelector('.msb-clock-v')?.textContent).toBe('0:07');
    expect(ui.container.querySelector('.msb-clock')?.classList.contains('low')).toBe(true);
    act(() => { useGame.setState({ run: { ...useGame.getState().run, phase: 'combat' } }); });
    expect(ui.container.querySelector('.msb-clock')).toBeNull();
    act(() => { useGame.setState({ run: { ...useGame.getState().run, phase: 'recruit' }, replaying: true }); });
    expect(ui.container.querySelector('.msb-clock')).toBeNull();
  });
});

describe('R-ESC-SIDEBAR-01: never leave the game by accident', () => {
  it('a page action that would leave the game is refused in the menu, with a note on the rail', () => {
    expect(refuseInGame(), 'outside the menu nothing is refused').toBe(false);
    inGame();
    act(() => { useGame.getState().openGameMenu(); });
    ui = mount(<GameMenu />);
    let refused = false;
    act(() => { refused = refuseInGame(); });
    expect(refused).toBe(true);
    expect(ui.container.querySelector('.msb-ingamenote')?.textContent).toBe('Leave this game first to watch.');
  });

  it('wiring: opening the menu drops a drag; menu pages never pause combat; the watch buttons ask first', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const recruit = readFileSync(join(here, 'Recruit.tsx'), 'utf8');
    expect(recruit).toMatch(/st\.gameMenuOpen && !prev\.gameMenuOpen && endSessionRef\.current\) \{ cancelDragTrace\(\); endSessionRef\.current\(\); \}/);
    expect(recruit.split('\n').find((l) => l.includes('const overlayOpen = useGame('))).toContain('&& !s.gameMenuOpen');
    for (const f of ['Career.tsx', 'RecentGames.tsx', 'live/LiveGames.tsx']) expect(readFileSync(join(here, f), 'utf8'), f).toContain('if (refuseInGame()) return;');
  });
});
