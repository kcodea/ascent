// @vitest-environment jsdom
/**
 * R-SETTINGS-SAVEQUIT-01 (owner 2026-11-08: "lets add a Save and Quit Match Button above Quit to Ascent then. in settings").
 *
 * Pins: in a game the Settings page's Game tab carries Save and Quit Match right above Quit game; it asks for a second press,
 * then saves and returns to the menu; a Versus match words it as its own leave (Concede); on the menus it is not there.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../../renderedText.mount';

vi.mock('../../remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../remoteBoards')>()),
  remoteEnabled: () => false,
}));

import { useGame } from '../../store';
import { PhSettings } from './PhSettings';

const baseRun = useGame.getState().run;
const CLOSED = { settingsOpen: false, gameMenuOpen: false, showBook: false, showPatchNotes: false } as const;
let ui: Mounted | null = null;
const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
const inGame = (run: Partial<typeof baseRun> = {}): void => {
  act(() => {
    useGame.setState({
      ...CLOSED, showTitle: false, practiceSetupOpen: false, heroChoices: null, replaying: false, rankedEntry: null,
      gameMenuOpen: true, settingsOpen: true,
      run: { ...baseRun, phase: 'recruit', mode: 'lobby', sandbox: undefined, godMode: undefined, ...run },
    } as never);
  });
};
const rowLabels = (): string[] => [...ui!.container.querySelectorAll('.phs-row button')].map((b) => (b.textContent ?? '').trim());

afterEach(() => {
  ui?.unmount(); ui = null;
  act(() => { useGame.setState({ ...CLOSED, showTitle: true, run: baseRun, replaying: false, heroChoices: null } as never); });
});

describe('R-SETTINGS-SAVEQUIT-01: Save and Quit Match in Settings', () => {
  it('in a game it sits right above Quit game', () => {
    inGame();
    ui = mount(<PhSettings />);
    const labels = rowLabels();
    const save = labels.indexOf('Save and Quit Match');
    expect(save, 'the button is there').toBeGreaterThanOrEqual(0);
    expect(labels[save + 1], 'right above Quit game').toBe('Quit game');
  });

  it('asks for a second press, then saves and returns to the menu', () => {
    inGame();
    ui = mount(<PhSettings />);
    const btn = (): HTMLElement => [...ui!.container.querySelectorAll<HTMLElement>('.phs-row button')]
      .find((b) => /Save and Quit Match|Press again to quit/.test(b.textContent ?? ''))!;
    click(btn());
    expect(btn().textContent).toBe('Press again to quit');
    expect(useGame.getState().showTitle, 'one press never leaves').toBe(false);
    click(btn());
    expect(useGame.getState().showTitle).toBe(true);
  });

  it('a Versus match words it as its own leave', () => {
    inGame({ mode: 'versus' });
    ui = mount(<PhSettings />);
    expect(rowLabels()).toContain('Concede');
    expect(rowLabels()).not.toContain('Save and Quit Match');
  });

  it('on the menus it is not there', () => {
    act(() => { useGame.setState({ ...CLOSED, showTitle: true } as never); });
    ui = mount(<PhSettings />);
    expect(rowLabels()).not.toContain('Save and Quit Match');
  });
});
