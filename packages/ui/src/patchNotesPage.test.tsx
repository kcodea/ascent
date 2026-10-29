// @vitest-environment jsdom
/**
 * R-PATCHNOTES-PAGE-01: PATCH NOTES IS A PAGE (owner 2026-10-29: "patch notes should also be a page i think").
 *
 * Pins: Patch Notes is a sidebar page like Settings (the rail with Patch Notes current, the page title, the changelog in
 * the page's scroller), reached from the rail on the menus AND in a game, and from the title's Patch Notes button; one
 * component serves both places; a rail hop to it closes the page it came from; in a game it wears the in-game rail and
 * no painted backdrop, and Escape / Resume / a press on the dimmed game close it with the menu; on the menus Escape and
 * the rail's Home close it; the old centred overlay (`.pnov`, its ✕) is gone; no `title=` anywhere.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mount, type Mounted } from './renderedText.mount';

vi.mock('./remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./remoteBoards')>()),
  remoteEnabled: () => false,
}));

import { GameMenu, handleEscape } from './GameMenu';
import { MenuSidebar } from './MenuSidebar';
import { PatchNotesPage } from './PatchNotesPage';
import { anyPageOpen, useGame } from './store';

const here = dirname(fileURLToPath(import.meta.url));
const CLOSED = {
  showCareer: false, careerOf: null, showRankings: false, showLeaderboard: false, showRecentGames: false, showLiveGames: false,
  showCollection: false, settingsOpen: false, gameMenuOpen: false, showBook: false, showPatchNotes: false, inspect: null,
} as const;
const baseRun = useGame.getState().run;
const onMenus = (): void => { act(() => { useGame.setState({ ...CLOSED, showTitle: true } as never); }); };
const inGame = (): void => {
  act(() => {
    useGame.setState({
      ...CLOSED, showTitle: false, practiceSetupOpen: false, heroChoices: null, replaying: false, rankedEntry: null,
      run: { ...baseRun, phase: 'recruit', mode: 'lobby', sandbox: undefined, godMode: undefined },
    } as never);
  });
};

let ui: Mounted | null = null;
const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
const press = (el: Element | null | undefined): void => { act(() => { el!.dispatchEvent(new Event('pointerdown', { bubbles: true })); }); };
const plaque = (root: ParentNode, label: string): HTMLElement | undefined =>
  [...root.querySelectorAll<HTMLElement>('.sbbtn')].find((b) => b.textContent?.trim() === label);
/** The changelog is its own lazy chunk: let it resolve and render. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20 && !ui?.container.querySelector('.pnpatch'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
};

afterEach(() => {
  ui?.unmount(); ui = null;
  act(() => { useGame.setState({ ...CLOSED, showTitle: true, run: baseRun, replaying: false, heroChoices: null } as never); });
});

describe('R-PATCHNOTES-PAGE-01: Patch Notes is a sidebar page', () => {
  it('the rail carries Patch Notes on the menus, and a hop to it closes the page it came from', () => {
    onMenus();
    act(() => { useGame.getState().goTo('settings'); });
    ui = mount(<MenuSidebar current="settings" />);
    click(plaque(ui.container, 'Patch Notes'));
    const st = useGame.getState();
    expect(st.showPatchNotes).toBe(true);
    expect(st.settingsOpen, 'the source page closes').toBe(false);
    expect(anyPageOpen(st)).toBe(true);
  });

  it('is the ordinary page shell: rail with Patch Notes current, the title, the changelog in the scroller; no overlay', async () => {
    onMenus();
    act(() => { useGame.getState().openPatchNotes(); });
    ui = mount(<PatchNotesPage />);
    const page = ui.container.querySelector('.lbpage.pn-page')!;
    expect(page).not.toBeNull();
    expect(page.querySelector('.msb .sbbtn[aria-current="page"]')?.textContent?.trim()).toBe('Patch Notes');
    expect(page.querySelector('.lbtopbar .lbtitle')?.textContent).toContain('Patch Notes');
    expect(page.querySelector('.mbd'), 'on the menus the painted backdrop rides the rail').not.toBeNull();
    await settle();
    expect(page.querySelector('.lbscroll.pnscroll .pnpatch')).not.toBeNull();
    expect(page.querySelector('[role="tablist"]')).not.toBeNull();
    expect(ui.container.querySelector('.pnov, .pnpanel, .pnclose'), 'the old overlay and its close are gone').toBeNull();
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('on the menus Escape closes it, and so does the rail\'s Home', () => {
    onMenus();
    act(() => { useGame.getState().openPatchNotes(); });
    handleEscape();
    expect(useGame.getState().showPatchNotes).toBe(false);
    expect(useGame.getState().settingsOpen, 'Escape closed the page, it did not open Settings').toBe(false);
    act(() => { useGame.getState().goTo('patchnotes'); });
    ui = mount(<PatchNotesPage />);
    click(ui.container.querySelector('.msb-home'));
    expect(useGame.getState().showPatchNotes).toBe(false);
  });

  it('in a game: opened from the in-game rail, it wears that rail and no backdrop; Escape closes it with the menu', () => {
    inGame();
    act(() => { useGame.getState().openGameMenu(); });
    ui = mount(<><GameMenu /><PatchNotesPage /></>);
    click(plaque(ui.container.querySelector('.gmenu')!, 'Patch Notes'));
    expect(useGame.getState().showPatchNotes).toBe(true);
    expect(ui.container.querySelector('.gmenu')?.classList.contains('paged')).toBe(true);
    const page = ui.container.querySelector('.lbpage.pn-page')!;
    expect(page.querySelector('.msb.msb-ingame .msb-resume')).not.toBeNull();
    expect(page.querySelector('.msb .msb-leave')).not.toBeNull();
    expect(ui.container.querySelector('.mbd'), 'the dimmed game shows through').toBeNull();
    handleEscape();
    expect(useGame.getState().gameMenuOpen).toBe(false);
    expect(useGame.getState().showPatchNotes, 'the page closes with the menu').toBe(false);
  });

  it('in a game: Resume and a press on the dimmed game close it with the menu', () => {
    inGame();
    act(() => { useGame.getState().openGameMenu(); useGame.getState().goTo('patchnotes'); });
    ui = mount(<><GameMenu /><PatchNotesPage /></>);
    click(ui.container.querySelector('.lbpage.pn-page .msb-resume'));
    expect(useGame.getState().gameMenuOpen).toBe(false);
    expect(useGame.getState().showPatchNotes).toBe(false);
    act(() => { useGame.getState().openGameMenu(); useGame.getState().goTo('patchnotes'); });
    press(ui.container.querySelector('.gmenu-veil'));
    expect(useGame.getState().gameMenuOpen).toBe(false);
    expect(useGame.getState().showPatchNotes).toBe(false);
  });

  it('wiring: the title button and Game mount the one page; the overlay module is gone', () => {
    const title = readFileSync(join(here, 'Title.tsx'), 'utf8');
    expect(title).toMatch(/openPatchNotes\(\)/);
    const game = readFileSync(join(here, 'Game.tsx'), 'utf8');
    expect(game).toContain('<PatchNotesPage />');
    expect(game).not.toContain('PatchNotesOverlay');
    const css = readFileSync(join(here, 'styles.css'), 'utf8');
    expect(css).not.toMatch(/\.pnov\b|\.pnpanel\b|\.pnclose\b/);
  });
});
