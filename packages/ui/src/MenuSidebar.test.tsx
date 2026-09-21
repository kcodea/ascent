// @vitest-environment jsdom
/**
 * THE MENU SIDEBAR (owner ask 2026-09-21) — jsdom renders of the four ladder pages (backend disabled, so each
 * paints its designed "unavailable" state; the sidebar is the subject) plus the store's `goTo`. Pins: the
 * sidebar renders inside every page's `.lbpage` with Back first and the six plaques in the title's order;
 * the CURRENT page's plaque is the blue `.active` one and `aria-current="page"`; a plaque hop goes through
 * `goTo`, which closes EVERY page flag before opening the destination (the pages are z-470 siblings that
 * stack in DOM order, so a hop that only opened a flag would leave the current page painted on top); Back
 * keeps the page's own close (a Career over the Leaderboard backs out to the Leaderboard); Settings opens the
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

import { Career } from './Career';
import { Rankings } from './Rankings';
import { Leaderboard } from './Leaderboard';
import { RecentGames } from './RecentGames';
import { useGame } from './store';

const LABELS = ['Play', 'Career', 'Leaderboard', 'Hall of Champions', 'Recent Games', 'Settings'];
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
  useGame.setState({ ...PAGES_CLOSED, titleView: 'menu', settingsOpen: false, savedRun: null, account: { userId: 'me-1', email: null, anonymous: true, discriminator: '4821' } });
});
afterEach(() => { ui?.unmount(); ui = null; useGame.setState({ ...PAGES_CLOSED, titleView: 'menu', settingsOpen: false }); });

describe('the sidebar on each ladder page', () => {
  const cases: [string, () => JSX.Element, Partial<ReturnType<typeof flagsOf>>, string][] = [
    ['Career', () => <Career />, { showCareer: true }, 'Career'],
    ['Leaderboard (Rankings)', () => <Rankings />, { showRankings: true }, 'Leaderboard'],
    ['Hall of Champions', () => <Leaderboard />, { showLeaderboard: true }, 'Hall of Champions'],
    ['Recent Games', () => <RecentGames />, { showRecentGames: true }, 'Recent Games'],
  ];
  for (const [name, render, open, active] of cases) {
    it(`${name}: renders inside .lbpage with Back first, the six plaques in the title's order, and its own plaque current`, () => {
      useGame.setState(open);
      ui = mount(render());
      const page = ui.container.querySelector('.lbpage');
      expect(page).not.toBeNull();
      const sb = page!.querySelector('.msb');
      expect(sb, 'the sidebar lives inside the page shell').not.toBeNull();
      expect(sb!.firstElementChild?.classList.contains('lbback')).toBe(true);
      expect(labels(sb!)).toEqual(LABELS);
      expect(current(sb!)).toBe(active);
      expect(sb!.querySelectorAll('.sbbtn.active')).toHaveLength(1);
      expect(sb!.querySelector('.sbbtn.active')?.getAttribute('aria-current')).toBe('page');
      // The old top-bar Back is gone — Back lives in the sidebar only; the page title still leads the top bar.
      expect(page!.querySelectorAll('.lbback')).toHaveLength(1);
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

  it('Back keeps the page\'s own close: a Career opened over the Leaderboard backs out to the Leaderboard', () => {
    useGame.setState({ showRankings: true, showCareer: true, careerOf: { userId: 'u-x', author: 'Mika', rating: 700, gamesPlayed: 3 } });
    ui = mount(<Career />);
    click(ui.container.querySelector('.msb .lbback'));
    expect(flagsOf()).toEqual({ ...PAGES_CLOSED, showRankings: true });
  });

  it('Settings opens the store\'s modal flag from a page', () => {
    useGame.setState({ showRankings: true });
    ui = mount(<Rankings />);
    click([...ui.container.querySelectorAll('.sbbtn')].find((b) => b.textContent?.trim() === 'Settings'));
    expect(useGame.getState().settingsOpen).toBe(true);
    useGame.getState().closeSettings();
    expect(useGame.getState().settingsOpen).toBe(false);
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
