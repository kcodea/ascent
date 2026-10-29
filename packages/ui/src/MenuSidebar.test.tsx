// @vitest-environment jsdom
/**
 * THE MENU SIDEBAR (owner ask 2026-09-21) — jsdom renders of the four ladder pages (backend disabled, so each
 * paints its designed "unavailable" state; the sidebar is the subject) plus the store's `goTo`. Pins: the
 * sidebar renders inside every page's `.lbpage` with the ASCENT mark (Home) first and the nine plaques (no Friends since R-FRIENDS-DOCK-02; Patch Notes since R-PATCHNOTES-PAGE-01) in the
 * regrouped order (Play; Progress: Career, Collection; Community: the four ladder pages; Settings at the foot);
 * the CURRENT page's plaque is the blue `.active` one and `aria-current="page"`; a plaque hop goes through
 * `goTo`, which closes EVERY page flag before opening the destination (the pages are z-470 siblings that
 * stack in DOM order, so a hop that only opened a flag would leave the current page painted on top); Home (which replaced Back in the WS-2 regroup, 2026-10-16) goes to the main menu with
 * every page closed and pulses once; Settings opens the
 * store's modal flag; Play opens the mode picker view; `openTitle` lands on the main menu. What must NOT be
 * there: any `title=` attribute (the owner banned native tooltips — Career.test asserts none page-wide), any
 * `scrollIntoView` call from the sidebar, and any `lb-` / `cv2-` class on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';

vi.mock('./remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./remoteBoards')>()),
  remoteEnabled: () => false,
}));
vi.mock('./replay/replayPlayer', () => ({ startReplay: vi.fn() }));
// These pins cover the full rail WITH the Hall of Champions; its hidden state (hallFlag.ts, owner 2026-10-16) is
// pinned in hallHidden.test.tsx.
vi.mock('./hallFlag', () => ({ HALL_VISIBLE: true }));
// LIVE GAMES glow (owner 2026-10-16): the shared count is mocked; a test sets it.
const live = vi.hoisted(() => ({ n: 0 }));
vi.mock('./live/liveCount', () => ({ useLiveCount: () => live.n, useWindowFocused: () => true }));

import { Career } from './Career';
import { Rankings } from './Rankings';
import { Leaderboard } from './Leaderboard';
import { RecentGames } from './RecentGames';
import { SettingsPanel } from './EscMenu';
import { sfx } from './sfx';
import { useGame } from './store';
import { setPlayParty } from './versus/playParty';

// Collection (2026-09-28) shows once crates are live, and always in DEV builds, which is what this test runs as.
const LABELS = ['Play', 'Career', 'Collection', 'Leaderboard', 'Hall of Champions', 'Recent Games', 'Live Games', 'Patch Notes', 'Settings'];
const PAGES_CLOSED = { showRankings: false, showLeaderboard: false, showRecentGames: false, showCareer: false, careerOf: null } as const;
const flagsOf = () => {
  const s = useGame.getState();
  return { showRankings: s.showRankings, showLeaderboard: s.showLeaderboard, showRecentGames: s.showRecentGames, showCareer: s.showCareer, careerOf: s.careerOf };
};

let ui: Mounted | null = null;
const scrollIntoView = vi.fn();
const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
const labels = (root: ParentNode): string[] => [...root.querySelectorAll('.sbbtn')].map((b) => (b.textContent ?? '').trim());
const current = (root: ParentNode): string | undefined => (root.querySelector('.sbbtn[aria-current="page"]')?.textContent ?? '').trim();

beforeEach(() => {
  scrollIntoView.mockReset();
  (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;
  useGame.setState({ ...PAGES_CLOSED, titleView: 'menu', settingsOpen: false, savedRun: null, navHopAt: -1e9, account: { userId: 'me-1', email: null, anonymous: true, discriminator: '4821' } });
});
afterEach(() => { ui?.unmount(); ui = null; vi.restoreAllMocks(); useGame.setState({ ...PAGES_CLOSED, titleView: 'menu', settingsOpen: false, navHopAt: -1e9 }); });

describe('the sidebar on each ladder page', () => {
  const cases: [string, () => JSX.Element, Partial<ReturnType<typeof flagsOf>>, string][] = [
    ['Career', () => <Career />, { showCareer: true }, 'Career'],
    ['Leaderboard (Rankings)', () => <Rankings />, { showRankings: true }, 'Leaderboard'],
    ['Hall of Champions', () => <Leaderboard />, { showLeaderboard: true }, 'Hall of Champions'],
    ['Recent Games', () => <RecentGames />, { showRecentGames: true }, 'Recent Games'],
  ];
  for (const [name, render, open, active] of cases) {
    it(`${name}: renders inside .lbpage with Home first, the nine plaques in the rail's order, and its own plaque current`, () => {
      useGame.setState(open);
      ui = mount(render());
      const page = ui.container.querySelector('.lbpage');
      expect(page).not.toBeNull();
      const sb = page!.querySelector('.msb');
      expect(sb, 'the sidebar lives inside the page shell').not.toBeNull();
      expect(sb!.firstElementChild?.classList.contains('msb-home')).toBe(true);
      // The groups are labelled for assistive tech; Play leads, Settings sits at the foot, outside the nav.
      expect([...sb!.querySelectorAll('.msb-group')].map((g) => g.getAttribute('aria-label'))).toEqual(['Progress', 'Community']);
      expect(sb!.querySelector('.msb-nav .sbbtn')?.classList.contains('sb-play')).toBe(true);
      // Settings closes the rail; only the Friends dock's slot (R-FRIENDS-DOCK-03) follows it.
      expect(sb!.querySelector(':scope > .msb-settings + .msb-dock:last-child')).not.toBeNull();
      expect(labels(sb!)).toEqual(LABELS);
      expect(current(sb!)).toBe(active);
      expect(sb!.querySelectorAll('.sbbtn.active')).toHaveLength(1);
      expect(sb!.querySelector('.sbbtn.active')?.getAttribute('aria-current')).toBe('page');
      // No Back pill anywhere (the rail reaches every page it used to); the page title still leads the top bar.
      expect(page!.querySelectorAll('.lbback')).toHaveLength(0);
      expect(page!.querySelector('.lbtopbar')?.firstElementChild?.classList.contains('lbtitle')).toBe(true);
      // Nothing native, nothing borrowed from the pages' pinned classes, and no scroll-into-view of its own.
      expect(sb!.querySelector('[title]')).toBeNull();
      expect([...sb!.querySelectorAll('*')].some((n) => [...n.classList].some((c) => /^(lb-|cv2-)/.test(c)))).toBe(false);
      expect(sb!.querySelector('.lbtitle')).toBeNull();
    });
  }

  it('never calls scrollIntoView (the Leaderboard row scroll is the only caller, and only on Rankings)', () => {
    useGame.setState({ showLeaderboard: true });
    ui = mount(<Leaderboard />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    click(ui.container.querySelector('.sbbtn'));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('navigation', () => {
  it('a plaque hop closes the current page and opens the destination — never both', () => {
    useGame.setState({ showCareer: true, careerOf: { userId: 'u-x', author: 'Mika', rating: 700, gamesPlayed: 3 } });
    ui = mount(<Career />);
    click([...ui.container.querySelectorAll('.sbbtn')].find((b) => b.textContent?.trim() === 'Hall of Champions'));
    expect(flagsOf()).toEqual({ ...PAGES_CLOSED, showLeaderboard: true });
    expect(useGame.getState().titleView).toBe('menu');
  });

  it('goTo closes every page flag (the stack) before opening the destination', () => {
    const { goTo } = useGame.getState();
    useGame.setState({ showRankings: true, showCareer: true, careerOf: { userId: 'u-x', author: 'Mika', rating: 700, gamesPlayed: 3 } });
    goTo('recent');
    expect(flagsOf()).toEqual({ ...PAGES_CLOSED, showRecentGames: true });
    goTo('rankings');
    expect(flagsOf()).toEqual({ ...PAGES_CLOSED, showRankings: true });
    goTo('career');
    expect(flagsOf()).toEqual({ ...PAGES_CLOSED, showCareer: true }); // your OWN career: careerOf cleared
    goTo('hall');
    expect(flagsOf()).toEqual({ ...PAGES_CLOSED, showLeaderboard: true });
  });

  it('the rail carries no Solo / Duo switch, and its Play opens the mode screen even with Duo picked (R-RANKED-DUOS-MODECARD-01)', () => {
    setPlayParty('duo');
    try {
      useGame.setState({ showRecentGames: true });
      ui = mount(<RecentGames />);
      expect(ui.container.querySelector('.msb .playparty')).toBeNull();
      click(ui.container.querySelector('.sbbtn'));
      expect(useGame.getState().titleView).toBe('modes');
      expect(flagsOf()).toEqual(PAGES_CLOSED);
    } finally { act(() => setPlayParty('solo')); }
  });

  it('Play opens the mode picker view with every page closed; Back on the picker returns to the main menu', () => {
    useGame.setState({ showRecentGames: true });
    ui = mount(<RecentGames />);
    click(ui.container.querySelector('.sbbtn'));
    expect(flagsOf()).toEqual(PAGES_CLOSED);
    expect(useGame.getState().titleView).toBe('modes');
    useGame.getState().goTo('menu');
    expect(useGame.getState().titleView).toBe('menu');
    expect(flagsOf()).toEqual(PAGES_CLOSED);
  });

  it('Home (the ASCENT mark) goes to the main menu with every page closed, even a Career stacked over the Leaderboard', () => {
    useGame.setState({ titleView: 'modes', showRankings: true, showCareer: true, careerOf: { userId: 'u-x', author: 'Mika', rating: 700, gamesPlayed: 3 } });
    ui = mount(<Career />);
    click(ui.container.querySelector('.msb .msb-home'));
    expect(flagsOf()).toEqual(PAGES_CLOSED);
    expect(useGame.getState().titleView).toBe('menu');
  });

  it('the Leaderboard is still one click from a Career opened over it (the rail replaces Back)', () => {
    useGame.setState({ showRankings: true, showCareer: true, careerOf: { userId: 'u-x', author: 'Mika', rating: 700, gamesPlayed: 3 } });
    ui = mount(<Career />);
    click([...ui.container.querySelectorAll('.sbbtn')].find((b) => b.textContent?.trim() === 'Leaderboard'));
    expect(flagsOf()).toEqual({ ...PAGES_CLOSED, showRankings: true });
  });

  it('Home pulses ONCE (it is the sidebar\'s own control now)', () => {
    const pulse = vi.spyOn(sfx, 'pulse').mockImplementation(() => {});
    useGame.setState({ showRankings: true });
    ui = mount(<Rankings />);
    click(ui.container.querySelector('.msb .msb-home'));
    expect(pulse).toHaveBeenCalledTimes(1);
    expect(flagsOf()).toEqual(PAGES_CLOSED);
  });

  it('a host mounted BY a sidebar hop wears .hop (no page fade — the sidebar stays put); one opened from the title does not', () => {
    // From the title: no fresh hop stamp → the page-level fade.
    useGame.setState({ showCareer: true });
    ui = mount(<Career />);
    expect(ui.container.querySelector('.lbpage')?.classList.contains('hop')).toBe(false);
    // A plaque hop from that page → the destination mounts within the hop window → `.hop`.
    click([...ui.container.querySelectorAll('.sbbtn')].find((b) => b.textContent?.trim() === 'Recent Games'));
    ui.unmount();
    ui = mount(<RecentGames />);
    expect(ui.container.querySelector('.lbpage')?.classList.contains('hop')).toBe(true);
    // The sidebar itself never wears it — the fade the class turns off is the host's; the content beside the
    // sidebar still fades (a CSS rule, not asserted here).
    expect(ui.container.querySelector('.msb')?.classList.contains('hop')).toBe(false);
  });

  it('the Settings page carries no leave button on the menus or in a game (R-ESC-SIDEBAR-01: it moved to the in-game sidebar)', () => {
    for (const st of [{ showRankings: true, showTitle: true }, { showTitle: true }, { showTitle: false }]) {
      useGame.setState({ ...PAGES_CLOSED, titleView: 'menu', replaying: false, ...st });
      ui = mount(<SettingsPanel />);
      expect(ui.container.querySelector('.escbtn-primary')).toBeNull();
      expect(ui.container.textContent).not.toMatch(/Save & Quit|Main menu|Resume/);
      ui.unmount(); ui = null;
    }
  });

  it('Settings is a page: the plaque opens it through goTo, closing the page it was pressed on', () => {
    useGame.setState({ showRankings: true });
    ui = mount(<Rankings />);
    click([...ui.container.querySelectorAll('.sbbtn')].find((b) => b.textContent?.trim() === 'Settings'));
    expect(useGame.getState().settingsOpen).toBe(true);
    expect(useGame.getState().showRankings).toBe(false);
    useGame.getState().goTo('career');
    expect(useGame.getState().settingsOpen, 'a hop away closes Settings like any page').toBe(false);
  });

  it('returning to the title (openTitle / cancelPracticeSetup) lands on the MAIN menu, never a sub-view — with every page closed', () => {
    // Settings can now be opened from a page, so Save & Quit / Leave replay ("back to the main menu") must
    // also close the page it was opened over.
    useGame.setState({ titleView: 'learn', showTitle: false, showRecentGames: true, showCareer: true, careerOf: { userId: 'u-x', author: 'Mika', rating: 700, gamesPlayed: 3 } });
    useGame.getState().openTitle();
    expect(useGame.getState().titleView).toBe('menu');
    expect(useGame.getState().showTitle).toBe(true);
    expect(flagsOf()).toEqual(PAGES_CLOSED);
    useGame.setState({ titleView: 'modes', practiceSetupOpen: true });
    useGame.getState().cancelPracticeSetup();
    expect(useGame.getState().titleView).toBe('menu');
  });

  it('the Play plaque carries the saved-run note as a data-tip on a wrapper, never as visible text or a title', () => {
    useGame.setState({ showCareer: true, savedRun: { wave: 4 } as never });
    ui = mount(<Career />);
    const wrap = ui.container.querySelector('.msb .msb-item[data-tip]');
    expect(wrap).not.toBeNull();
    expect(wrap!.querySelector('.sbbtn')?.textContent?.trim()).toBe('Play');
    expect(ui.container.querySelector('[title]')).toBeNull();
    expect(ui.container.querySelector('.msb')?.textContent).not.toMatch(/saved run/i);
  });
});

describe('the Live Games plaque (owner 2026-10-16: "glowing if there are any live games")', () => {
  it('glows with a count chip while ranked games are live, and is plain when none are', async () => {
    const { useGame } = await import('./store');
    live.n = 3;
    act(() => { useGame.setState({ showRankings: true }); });
    let m = mount(<Rankings />);
    const plaque = (): HTMLElement => [...m.container.querySelectorAll<HTMLElement>('.sbbtn')].find((b) => /Live Games/.test(b.textContent ?? ''))!;
    expect(plaque().classList.contains('sb-live')).toBe(true);
    expect(plaque().querySelector('.sb-livechip')?.textContent).toBe('3 live');
    m.unmount();
    live.n = 0;
    m = mount(<Rankings />);
    expect(plaque().classList.contains('sb-live')).toBe(false);
    expect(plaque().querySelector('.sb-livechip')).toBeNull();
    m.unmount();
  });
});
