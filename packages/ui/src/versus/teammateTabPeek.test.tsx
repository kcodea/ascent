// @vitest-environment jsdom
/**
 * VERSUS DUOS: TAB IS THE PEEK, AND ONLY THE PEEK (R-DUOS-TAB-PEEK-01, the Duos audit of 2026-11-09).
 *
 * Tab had two listeners for a seated Duos player: the teammate view's (hold Tab to peek at your teammate, capture phase)
 * and the Compendium's (Tab opens the book, bubble phase). The first called `preventDefault` but let the press travel on,
 * so one press peeked AND opened the Compendium over the teammate's board; a held Tab's key repeats then toggled the book
 * again and again. While the teammate-view keys are on, the press now stops at the peek.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const watch = vi.fn();
const leave = vi.fn();
vi.mock('./spectate', async (orig) => ({
  ...(await orig<typeof import('./spectate')>()),
  watchTeammate: (...a: unknown[]) => watch(...a),
  leaveTeammate: (...a: unknown[]) => leave(...a),
  flushSpectateRender: () => undefined,
}));

const { mount } = await import('../renderedText.mount');
const { useGame } = await import('../store');
const { useVersus } = await import('./versusStore');
const { useSpectate } = await import('./spectate');
const { installCompendiumHotkey } = await import('../compendiumHotkey');
const view = await import('./teammateView');

function Keys({ on }: { on: boolean }): null {
  view.useTeammateViewKeys(on);
  return null;
}
/** A real key press: it starts at the focused element (the page body), as a keyboard's does. */
const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent(type, { key: 'Tab', bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(e);
  return e;
};

let off: () => void;
let ui: ReturnType<typeof mount> | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
  off = installCompendiumHotkey();
  useVersus.setState({ match: { phase: 'shop', paused_at: null, group: { me: 'p1', duos: { team: 'a', mate: 'p2', first: { a: 'p1', b: 'p3' } } } } } as never);
  useGame.setState({ showBook: false, heroChoices: null, settingsOpen: false, run: { ...useGame.getState().run, mode: 'versus', phase: 'recruit' } } as never);
  useSpectate.setState({ teammate: false });
  watch.mockImplementation(() => { useSpectate.setState({ teammate: true }); });
  leave.mockImplementation(() => { useSpectate.setState({ teammate: false }); });
});
afterEach(() => {
  ui?.unmount();
  ui = null;
  off();
  vi.clearAllMocks();
  useSpectate.setState({ teammate: false });
  useVersus.setState({ match: null } as never);
  useGame.setState({ showBook: false });
});

describe('R-DUOS-TAB-PEEK-01: Tab peeks at the teammate and does not open the Compendium', () => {
  it('a seated Duos player: Tab opens the teammate view, the Compendium stays shut, letting go comes back', () => {
    ui = mount(<Keys on />);
    const e = key('keydown');
    expect(watch).toHaveBeenCalledWith('p2');
    expect(useGame.getState().showBook).toBe(false);
    expect(e.defaultPrevented).toBe(true); // and no browser focus-cycling
    key('keyup');
    expect(leave).toHaveBeenCalledTimes(1);
    expect(useGame.getState().showBook).toBe(false);
  });

  it('a held Tab repeats: every repeat stops at the peek too (the book used to flicker open and shut)', () => {
    ui = mount(<Keys on />);
    key('keydown');
    for (let i = 0; i < 5; i++) {
      const e = key('keydown', { repeat: true });
      expect(e.defaultPrevented).toBe(true);
      expect(useGame.getState().showBook).toBe(false);
    }
    expect(watch).toHaveBeenCalledTimes(1);
    expect(leave).not.toHaveBeenCalled(); // still peeking
  });

  it('without the teammate-view keys (not a seated Duos player) Tab is the Compendium, as everywhere else', () => {
    ui = mount(<Keys on={false} />);
    key('keydown');
    expect(useGame.getState().showBook).toBe(true);
    expect(watch).not.toHaveBeenCalled();
    key('keydown');
    expect(useGame.getState().showBook).toBe(false);
  });

  it('with the Compendium already open, Tab closes it and does not peek behind it', () => {
    ui = mount(<Keys on />);
    useGame.setState({ showBook: true });
    key('keydown');
    expect(useGame.getState().showBook).toBe(false);
    expect(watch).not.toHaveBeenCalled();
  });

  it('typing in a text field keeps Tab for the field', () => {
    ui = mount(<Keys on />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(e);
    expect(watch).not.toHaveBeenCalled(); // the peek left the press alone
  });
});
